// packages/agent/src/mcp-registry/registry.ts
import { eq } from 'drizzle-orm'
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'
import type { McpServerRepo } from '../mcp-server-repo/types.js'
import { registerForUser, unregisterForUser } from '../tools/registry.js'
import { McpSession } from './session.js'
import { getDb, users } from '../db/index.js'
import { decryptApiKey } from '../crypto/apikey.js'
import { UNSUPPORTED_SERVER_IDS } from '../mcp-server-repo/presets.js'

/**
 * 复用 LLM Key sentinel,必须和 packages/agent/src/routes/mcp.ts 一致。
 * activate() 在 connect 之前把 headers value 里的 `$LLM_KEY` 替换为用户当前 LLM apiKey,
 * 这样持久化的是 sentinel(语义),实际连接用的是当下的真 key(用户后续改 key 自动同步)。
 */
const LLM_KEY_SENTINEL = '$LLM_KEY'

/**
 * Phase 9-F：每个 user 一个 McpRegistry 实例（A01 修复）。
 * sessions Map 是该 user 的 server connections；
 * activate 把工具 register 到 user-scoped tool registry。
 */
export class McpRegistry {
  private sessions = new Map<string, McpSession>()
  private initPromise: Promise<void> | null = null

  constructor(
    private readonly repo: McpServerRepo,
    private readonly userId: number,
  ) {}

  async initialize(): Promise<void> {
    const all = await this.repo.list(this.userId)
    await Promise.all(
      all
        .filter((c) => c.enabled && !UNSUPPORTED_SERVER_IDS.has(c.id))
        .map((c) => this.activate(c)),
    )
  }

  /**
   * 幂等 lazy 初始化。getRegistry(userId) 创建实例后通过 `mcp-registry/index.ts`
   * 调用，确保第一次 GET /api/mcp/servers 或 /api/tools 之前 connect 完成。
   * 后续调用是 noop。
   */
  ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((err) => {
        console.warn(`[mcp-registry] init partial failure (user=${this.userId}):`, (err as Error).message)
      })
    }
    return this.initPromise
  }

  /** 配置变化后同步 session + 注册表 */
  async sync(config: McpServerConfig): Promise<void> {
    const existing = this.sessions.get(config.id)
    if (existing) {
      this.unregisterSessionTools(existing)
      await existing.close()
      this.sessions.delete(config.id)
    }
    if (config.enabled) {
      await this.activate(config)
    }
  }

  getStatus(id: string): McpServerStatus {
    return this.sessions.get(id)?.status ?? { state: 'disabled' }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.unregisterSessionTools(session)
      await session.close()
    }
    this.sessions.clear()
  }

  // ---- 内部 ----

  private async activate(config: McpServerConfig): Promise<void> {
    if (this.sessions.has(config.id)) {
      console.warn(`[mcp-registry] duplicate config.id: ${config.id}, skipping`)
      return
    }
    const resolved = await this.resolveSentinels(config)
    const session = new McpSession(resolved)
    this.sessions.set(config.id, session)
    await session.connect()
    if (session.status.state !== 'ok') return
    for (const t of session.tools) {
      registerForUser(this.userId, {
        name: `mcp__${config.id}__${t.name}`,
        description: t.description,
        parameters: { ...t.inputSchema, properties: t.inputSchema.properties ?? {} },
        exec: async (args) => session.callTool(t.name, args),
      })
    }
  }

  /**
   * 把 headers 里的 `$LLM_KEY` sentinel 替换为用户当前 LLM apiKey。
   * 没设过 LLM apiKey → 留原样,connect 必失败,session.status='error',UI 显示错误,
   * 比悄悄连不上更好排查。
   */
  private async resolveSentinels(config: McpServerConfig): Promise<McpServerConfig> {
    const headers = config.headers ?? {}
    let needsResolve = false
    for (const v of Object.values(headers)) {
      if (typeof v === 'string' && v.includes(LLM_KEY_SENTINEL)) {
        needsResolve = true
        break
      }
    }
    if (!needsResolve) return config
    const llmKey = await this.fetchLlmKey()
    if (!llmKey) return config
    const resolved: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      resolved[k] = typeof v === 'string' ? v.replaceAll(LLM_KEY_SENTINEL, llmKey) : v
    }
    return { ...config, headers: resolved }
  }

  private async fetchLlmKey(): Promise<string | null> {
    const db = getDb()
    const [u] = await db
      .select({ llmSettings: users.llmSettings })
      .from(users)
      .where(eq(users.id, this.userId))
      .limit(1)
    if (!u || !u.llmSettings) return null
    try {
      const parsed = JSON.parse(decryptApiKey(u.llmSettings)) as { apiKey?: string }
      return parsed.apiKey?.trim() || null
    } catch {
      return null
    }
  }

  private unregisterSessionTools(session: McpSession): void {
    for (const t of session.tools) {
      unregisterForUser(this.userId, `mcp__${session.config.id}__${t.name}`)
    }
  }
}
