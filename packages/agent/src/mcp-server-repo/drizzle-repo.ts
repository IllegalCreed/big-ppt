// packages/agent/src/mcp-server-repo/drizzle-repo.ts
/**
 * Phase 9-F：MCP per-user DB 实现（A01 修复）。
 *
 * 替代旧 JsonFileRepo（全用户共享单文件）。
 * - 落库的 headers 是 JSON object：{[key]: 'v1:...'}（value 经 AES-256-GCM 加密）
 * - 内存返回的 headers 是明文（交给 mcp-registry 连 HTTP 用）
 * - 首次 list(userId) 时如该 user 无任何 server，自动 seed PRESET_MCP_SERVERS（每用户独立 4 条）
 * - 跨用户隔离：所有方法按 userId 过滤；preset 不可删但可禁用
 */
import { and, eq } from 'drizzle-orm'
import type { McpServerConfig } from '@big-ppt/shared'
import type { McpServerRepo, McpServerPatch } from './types.js'
import { McpRepoNotFoundError } from './types.js'
import { PRESET_MCP_SERVERS } from './presets.js'
import { getDb, userMcpServers, type UserMcpServer } from '../db/index.js'
import { decryptApiKey, encryptApiKey, isEncryptedBlob } from '../crypto/apikey.js'

function encryptHeaders(headers: Record<string, string>): string {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== 'string' || v === '') {
      out[k] = v
      continue
    }
    out[k] = isEncryptedBlob(v) ? v : encryptApiKey(v)
  }
  return JSON.stringify(out)
}

function decryptHeaders(headersJson: string): Record<string, string> {
  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(headersJson) as Record<string, string>
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string' || v === '' || !isEncryptedBlob(v)) {
      out[k] = typeof v === 'string' ? v : ''
      continue
    }
    try {
      out[k] = decryptApiKey(v)
    } catch (err) {
      console.warn(`[mcp-drizzle] header "${k}" 解密失败，降级为空串：${(err as Error).message}`)
      out[k] = ''
    }
  }
  return out
}

function rowToConfig(row: UserMcpServer): McpServerConfig {
  return {
    id: row.serverId,
    displayName: row.displayName,
    description: row.description ?? '',
    url: row.url,
    headers: decryptHeaders(row.headers),
    enabled: row.enabled,
    preset: row.preset,
    badge: row.badge ?? undefined,
  }
}

/** sentinel value(必须和 routes/mcp.ts:LLM_KEY_SENTINEL / registry.ts:LLM_KEY_SENTINEL 保持一致) */
const LLM_KEY_SENTINEL = '$LLM_KEY'

/** row 的解密 headers 是否含 `$LLM_KEY` sentinel(任意 value) */
function headersHaveSentinel(headers: Record<string, string>): boolean {
  for (const v of Object.values(headers)) {
    if (typeof v === 'string' && v.includes(LLM_KEY_SENTINEL)) return true
  }
  return false
}

export class DrizzleRepo implements McpServerRepo {
  /** 串行化每个 user 的写入，避免并发 patch 相互覆盖（不同 user 间允许并行） */
  private writeQueues = new Map<number, Promise<void>>()

  async list(userId: number): Promise<McpServerConfig[]> {
    const db = getDb()
    const rows = await db.select().from(userMcpServers).where(eq(userMcpServers.userId, userId))
    if (rows.length === 0) {
      // 首次：seed PRESET 进 DB，再返回
      await this.seedPresets(userId)
      const seeded = await db.select().from(userMcpServers).where(eq(userMcpServers.userId, userId))
      return seeded.map(rowToConfig)
    }

    // Phase 12.5 hotfix:auto-heal preset 行的 headers 缺 sentinel 的情况。
    // 老用户 dev DB 已 seed 的 preset 行 headers 是 `{}`(改 presets.ts 默认 sentinel
    // 之前 seed 的),自动 patch update 补默认 sentinel,避免 enable 后撞智谱 1001 auth 错。
    // 仅作用 preset 行;用户已加的非 auth header 通过 merge 保留(不动)。
    // best-effort:写失败 console.warn 但不阻塞 list 返回(返回 in-memory healed config)。
    await this.autoHealPresetHeaders(userId, rows)

    return rows.map(rowToConfig)
  }

  private async autoHealPresetHeaders(userId: number, rows: UserMcpServer[]): Promise<void> {
    for (const row of rows) {
      if (!row.preset) continue
      const preset = PRESET_MCP_SERVERS.find((p) => p.id === row.serverId)
      if (!preset) continue
      const presetHeaders = preset.headers ?? {}
      if (Object.keys(presetHeaders).length === 0) continue
      const currentHeaders = decryptHeaders(row.headers)
      if (headersHaveSentinel(currentHeaders)) continue
      // 不覆盖用户已设的 header key:current 优先,preset 仅补 user 没设的 key。
      // 例如 user 在 Authorization 写了自己的 'Bearer real-xxx' → 保留;
      // user 只设了 X-Custom 没设 Authorization → preset 补 Authorization sentinel。
      // 注意:user 把 Authorization 显式清空(headers={})也会被 heal 补回。这是预期:
      // preset zhipu MCP 没 auth 就 100% 报 1001 错,清空没有实际用途。
      const merged = { ...presetHeaders, ...currentHeaders }
      const encrypted = encryptHeaders(merged)
      try {
        await getDb()
          .update(userMcpServers)
          .set({ headers: encrypted })
          .where(
            and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, row.serverId)),
          )
        // 同步更新 in-memory row 让本次 return 的 config 是 healed 后的
        row.headers = encrypted
      } catch (err) {
        console.warn(
          `[mcp-drizzle] auto-heal preset headers 失败 user=${userId} server=${row.serverId}: ${(err as Error).message}`,
        )
      }
    }
  }

  async get(userId: number, serverId: string): Promise<McpServerConfig | undefined> {
    const db = getDb()
    const [row] = await db
      .select()
      .from(userMcpServers)
      .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
      .limit(1)
    return row ? rowToConfig(row) : undefined
  }

  async create(userId: number, config: McpServerConfig): Promise<void> {
    await this.enqueueWrite(userId, async () => {
      const db = getDb()
      const existing = await db
        .select({ id: userMcpServers.id })
        .from(userMcpServers)
        .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, config.id)))
        .limit(1)
      if (existing.length > 0) {
        throw new Error(`MCP server ${config.id} already exists`)
      }
      await db.insert(userMcpServers).values({
        userId,
        serverId: config.id,
        displayName: config.displayName,
        description: config.description ?? '',
        url: config.url,
        headers: encryptHeaders(config.headers ?? {}),
        enabled: config.enabled,
        preset: config.preset,
        badge: config.badge ?? null,
      })
    })
  }

  async update(userId: number, serverId: string, patch: McpServerPatch): Promise<McpServerConfig> {
    let result!: McpServerConfig
    await this.enqueueWrite(userId, async () => {
      const db = getDb()
      const [row] = await db
        .select()
        .from(userMcpServers)
        .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
        .limit(1)
      if (!row) throw new McpRepoNotFoundError(serverId)
      const next: Partial<typeof userMcpServers.$inferInsert> = {}
      if (patch.displayName !== undefined) next.displayName = patch.displayName
      if (patch.description !== undefined) next.description = patch.description
      if (patch.url !== undefined) next.url = patch.url
      if (patch.enabled !== undefined) next.enabled = patch.enabled
      if (patch.badge !== undefined) next.badge = patch.badge ?? null
      if (patch.headers !== undefined) next.headers = encryptHeaders(patch.headers)
      if (Object.keys(next).length > 0) {
        await db
          .update(userMcpServers)
          .set(next)
          .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
      }
      const [updated] = await db
        .select()
        .from(userMcpServers)
        .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
        .limit(1)
      result = rowToConfig(updated!)
    })
    return result
  }

  async delete(userId: number, serverId: string): Promise<void> {
    await this.enqueueWrite(userId, async () => {
      const db = getDb()
      const [row] = await db
        .select({ preset: userMcpServers.preset })
        .from(userMcpServers)
        .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
        .limit(1)
      if (!row) return
      if (row.preset) throw new Error('cannot delete preset MCP server')
      await db
        .delete(userMcpServers)
        .where(and(eq(userMcpServers.userId, userId), eq(userMcpServers.serverId, serverId)))
    })
  }

  // ---- 内部 ----

  private async seedPresets(userId: number): Promise<void> {
    const db = getDb()
    const rows = PRESET_MCP_SERVERS.map((cfg) => ({
      userId,
      serverId: cfg.id,
      displayName: cfg.displayName,
      description: cfg.description ?? '',
      url: cfg.url,
      headers: encryptHeaders(cfg.headers ?? {}),
      enabled: cfg.enabled,
      preset: true,
      badge: cfg.badge ?? null,
    }))
    // 用 INSERT IGNORE 语义：(userId, serverId) 唯一索引重复时跳过，
    // 防并发首次 list 同一 user 双 seed 撞 unique constraint
    try {
      await db.insert(userMcpServers).values(rows)
    } catch (err) {
      // unique 冲突视为另一并发已经 seed 过，忽略；其他错误抛出
      const msg = (err as Error).message
      if (!/Duplicate entry|ER_DUP_ENTRY|unique/i.test(msg)) throw err
    }
  }

  private async enqueueWrite(userId: number, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(userId) ?? Promise.resolve()
    const next = prev.then(fn)
    this.writeQueues.set(
      userId,
      next.catch(() => undefined),
    )
    return next
  }
}
