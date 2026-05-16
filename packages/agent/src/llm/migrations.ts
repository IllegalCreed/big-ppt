/**
 * Phase 12 Task F:LLM 配置 + deck_chats 一次性迁移核心逻辑。
 *
 * Why 抽出独立 module:
 * - `scripts/migrate-llm-settings.mjs` / `scripts/migrate-deck-chats.mjs` 是 thin
 *   wrapper(读 process.env DATABASE_URL → 调本 module → 输出统计)。
 * - 集成测可以直接 import 本 module 函数对真 lumideck_test DB 跑,无需 spawn 子进程。
 *
 * 设计:
 * - 输入参数 `conn: mysql2/promise.Connection` —— caller 自己开连接(脚本 / 测试都自管),
 *   本 module 不依赖 drizzle / 不持久化 connection。
 * - 返回 `{ migrated, skipped, failed }` 统计供 caller 决定退出码 / 输出格式。
 * - `failed[].reason` 是 Error.message;script 打印,测试断言其内容。
 *
 * 加密 contract:caller 提供 `encrypt(plaintext) → ciphertext` / `decrypt(ciphertext)
 * → plaintext`,本 module 不直接 import crypto/apikey 避免循环依赖(脚本是 .mjs,
 * 不能 import .ts;测试可直接传 src 的 encryptApiKey / decryptApiKey)。
 */

import type { Connection, RowDataPacket } from 'mysql2/promise'
import { migrateLegacySettings, normalizeThinkingFields, parseLlmSettings } from './settings.js'
import { legacyRowToCanonical } from './chat-row.js'

export type MigrationStats = {
  migrated: number
  skipped: number
  failed: Array<{ id: number; reason: string; meta?: Record<string, unknown> }>
}

export type CryptoIO = {
  encrypt(plaintext: string): string
  decrypt(ciphertext: string): string
}

interface UserRow extends RowDataPacket {
  id: number
  email: string
  llm_settings: string | null
}

/**
 * users.llm_settings 老 shape `{provider, apiKey, ...}` → 新 shape
 * `{activeProvider, providers: {...}}`。
 *
 * 逻辑:
 * - 解密 → JSON.parse
 * - 如果已有 activeProvider → skip(已是新 shape)
 * - 否则跑 migrateLegacySettings → parseLlmSettings 验证 → 加密回写
 * - 任何 step 抛错 → 记 failed,继续下一条
 *
 * 不开事务:每条独立 UPDATE,失败一条不影响其他;批量 prod 跑时希望最大化 success
 * 数而非"全或无"。
 */
export async function migrateLlmSettings(
  conn: Connection,
  crypto: CryptoIO,
): Promise<MigrationStats> {
  const stats: MigrationStats = { migrated: 0, skipped: 0, failed: [] }

  const [rows] = await conn.execute<UserRow[]>(
    'SELECT id, email, llm_settings FROM users WHERE llm_settings IS NOT NULL',
  )

  for (const u of rows) {
    try {
      if (!u.llm_settings) {
        // race(SELECT 后 UPDATE 前被清空):跳过
        stats.skipped++
        continue
      }
      const plain = crypto.decrypt(u.llm_settings)
      let parsed: unknown
      try {
        parsed = JSON.parse(plain)
      } catch (e) {
        stats.failed.push({
          id: u.id,
          reason: `JSON.parse 失败:${(e as Error).message}`,
          meta: { email: u.email },
        })
        continue
      }
      // 已经是新 shape(含 activeProvider 字段)→ skip
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'activeProvider' in (parsed as Record<string, unknown>)
      ) {
        // 顺便 validate:已是新 shape 但若不通过 zod,记 failed 让 op 人工排查
        try {
          parseLlmSettings(parsed)
          stats.skipped++
        } catch (e) {
          stats.failed.push({
            id: u.id,
            reason: `已是新 shape 但 zod 校验失败:${(e as Error).message}`,
            meta: { email: u.email },
          })
        }
        continue
      }
      // 老 shape:必须有 provider + apiKey
      const legacy = parsed as { provider?: string; apiKey?: string; baseUrl?: string; model?: string }
      if (!legacy.provider || !legacy.apiKey) {
        stats.failed.push({
          id: u.id,
          reason: '老 shape 缺 provider 或 apiKey',
          meta: { email: u.email, keys: Object.keys(legacy ?? {}) },
        })
        continue
      }
      const next = migrateLegacySettings({
        provider: legacy.provider,
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl,
        model: legacy.model,
      })
      // 把转换后的 settings 跑一遍 zod,失败说明老 provider 不在白名单 → failed
      try {
        parseLlmSettings(next)
      } catch (e) {
        stats.failed.push({
          id: u.id,
          reason: `迁移后 zod 校验失败:${(e as Error).message}`,
          meta: { email: u.email, legacyProvider: legacy.provider },
        })
        continue
      }
      const encrypted = crypto.encrypt(JSON.stringify(next))
      await conn.execute('UPDATE users SET llm_settings = ? WHERE id = ?', [encrypted, u.id])
      stats.migrated++
    } catch (e) {
      stats.failed.push({
        id: u.id,
        reason: (e as Error).message,
        meta: { email: u.email },
      })
    }
  }

  return stats
}

interface DeckChatRow extends RowDataPacket {
  id: number
  role: string
  content: string
  tool_call_id: string | null
}

/**
 * deck_chats 老 row(canonical_content IS NULL)→ 重组 Block[] 写入 canonical_content。
 *
 * 批处理 100 row 一组:
 * - 单 conn 顺序 UPDATE 避免开事务的复杂性(MySQL 默认 autocommit,本来也是逐条提交);
 *   失败一条不影响下一条(每条独立 try/catch)。
 * - 大表(prod 几十万 chat row)需要分批 SELECT,避免一次性把全表拉内存 OOM。
 *
 * Why 写 canonical_content 而非整行 rewrite:老字段 content + tool_call_id 保留供老
 * reader 兼容(且 backup 用);只补 canonical_content,无数据损耗风险。
 */
export async function migrateDeckChats(
  conn: Connection,
  options: { batchSize?: number } = {},
): Promise<MigrationStats> {
  const batchSize = options.batchSize ?? 100
  const stats: MigrationStats = { migrated: 0, skipped: 0, failed: [] }

  // mysql2 prepared-statement 对 LIMIT 参数支持有 quirk(传 Number 会变 string,
   // 部分 MySQL 版本会 ER_PARSE_ERROR)。简单方案:LIMIT 拼字符串(batchSize 是内部
   // 整型常量,不来自用户输入,无 SQL injection 风险)。其余 user-supplied 值仍走 ?
   // 占位绑定。
  const safeLimit = Math.max(1, Math.floor(batchSize))
  while (true) {
    const [rows] = await conn.execute<DeckChatRow[]>(
      `SELECT id, role, content, tool_call_id FROM deck_chats
       WHERE canonical_content IS NULL
       ORDER BY id ASC
       LIMIT ${safeLimit}`,
    )
    if (rows.length === 0) break

    for (const row of rows) {
      try {
        const canonical = legacyRowToCanonical({
          role: row.role,
          content: row.content,
          toolCallId: row.tool_call_id,
        })
        const json = JSON.stringify(canonical.content)
        await conn.execute('UPDATE deck_chats SET canonical_content = ? WHERE id = ?', [json, row.id])
        stats.migrated++
      } catch (e) {
        stats.failed.push({ id: row.id, reason: (e as Error).message, meta: { role: row.role } })
      }
    }

    // 如果本批拉到的少于 batchSize,说明已经到末尾,避免空 SELECT 多绕一圈
    if (rows.length < batchSize) break
  }

  return stats
}

/**
 * Phase 12.7 Task E:把 advanced.<scope>.thinkingEnabled(boolean)→ thinkingLevel(enum)。
 *
 * 复用 normalizeThinkingFields(单测口径相同),返回新对象不修改原 input。判定原则:
 * - input 含 thinkingEnabled 字段且 boolean → 转
 * - 已含 thinkingLevel(无论是否同时有 thinkingEnabled)→ 优先用 thinkingLevel,
 *   thinkingEnabled 删掉(避免老字段残留 echo 回响应)
 * - 三个子区都没 thinkingEnabled → 原样返回(脚本 idempotent 跑不动 DB)
 */
export function migrateThinkingEnabledToLevel(legacy: unknown): unknown {
  return normalizeThinkingFields(legacy)
}

interface ThinkingSettingsRow extends RowDataPacket {
  id: number
  email: string
  llm_settings: string | null
}

/**
 * Phase 12.7 Task E:遍历 users.llm_settings,对 advanced.<scope>.thinkingEnabled
 * 入库的 row → 转 thinkingLevel + 加密回写。
 *
 * - 已是新 shape 但无 thinkingEnabled 字段 → skip(noop,DB 不动)
 * - decrypt / parse 失败 → failed
 * - 转完跑 parseLlmSettings 验证 → 加密回写
 *
 * Idempotent:第二次跑全部 skip,不出错。
 */
export async function migrateThinkingLevel(
  conn: Connection,
  crypto: CryptoIO,
): Promise<MigrationStats> {
  const stats: MigrationStats = { migrated: 0, skipped: 0, failed: [] }

  const [rows] = await conn.execute<ThinkingSettingsRow[]>(
    'SELECT id, email, llm_settings FROM users WHERE llm_settings IS NOT NULL',
  )

  for (const u of rows) {
    try {
      if (!u.llm_settings) {
        stats.skipped++
        continue
      }
      const plain = crypto.decrypt(u.llm_settings)
      let parsed: unknown
      try {
        parsed = JSON.parse(plain)
      } catch (e) {
        stats.failed.push({
          id: u.id,
          reason: `JSON.parse 失败:${(e as Error).message}`,
          meta: { email: u.email },
        })
        continue
      }
      // 判断是否需要转:扫 advanced.{anthropic,gemini,common}.thinkingEnabled
      if (!needsThinkingMigration(parsed)) {
        stats.skipped++
        continue
      }
      const normalized = migrateThinkingEnabledToLevel(parsed)
      // 跑 zod 验证(新 shape;若 row 是老 `{provider,apiKey}` shape 这里就拒,
      // 但这些 row 应该在 migrate-llm-settings 跑过后不存在,真撞到也归 failed)
      try {
        parseLlmSettings(normalized)
      } catch (e) {
        stats.failed.push({
          id: u.id,
          reason: `转换后 zod 校验失败:${(e as Error).message}`,
          meta: { email: u.email },
        })
        continue
      }
      const encrypted = crypto.encrypt(JSON.stringify(normalized))
      await conn.execute('UPDATE users SET llm_settings = ? WHERE id = ?', [encrypted, u.id])
      stats.migrated++
    } catch (e) {
      stats.failed.push({
        id: u.id,
        reason: (e as Error).message,
        meta: { email: u.email },
      })
    }
  }

  return stats
}

/** 检测 raw settings 是否任一 advanced.<scope> 含 thinkingEnabled 字段。 */
function needsThinkingMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const advanced = (raw as Record<string, unknown>).advanced
  if (!advanced || typeof advanced !== 'object') return false
  const advancedObj = advanced as Record<string, unknown>
  for (const scope of ['anthropic', 'gemini', 'common'] as const) {
    const sub = advancedObj[scope]
    if (sub && typeof sub === 'object' && 'thinkingEnabled' in (sub as Record<string, unknown>)) {
      return true
    }
  }
  return false
}
