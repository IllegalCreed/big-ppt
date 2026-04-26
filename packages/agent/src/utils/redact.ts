/**
 * Phase 9-E（A09 Logging Failures）：日志脱敏 helper。
 *
 * 写盘前 deep-clone + 递归过滤 password / apiKey / authorization / cookie / token / secret 等
 * 字段（不分大小写），值替换为 `[REDACTED]`。同时大 payload 截断防 logger 撑爆。
 *
 * **双重防线**——单纯依赖业务方"不要 log 敏感字段"靠不住，logger 写盘前再扫一遍。
 *
 * 业务方仍应避免主动 log 敏感字段；redact 是"漏网之鱼"兜底。
 */

/**
 * 默认 redact 字段。**注意刻意不含 `session`** —— logger 用 `session` 字段作为日志事件的
 * 关联 ID，不是凭据；redact 它会破坏日志可读性 / 排查能力。Cookie / token 等真正敏感的
 * 单独列出，子串匹配能覆盖 sessionToken / sessionCookie 等组合字段。
 */
const DEFAULT_REDACT_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'apikey',
  'api_key',
  'apikeys',
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'master_key',
  'masterkey',
] as const

const REDACTED = '[REDACTED]'

function getRedactKeys(): Set<string> {
  const fromEnv = process.env.LOG_REDACT_FIELDS
  const list: string[] = [...DEFAULT_REDACT_KEYS]
  if (fromEnv) {
    for (const k of fromEnv.split(',')) {
      const trimmed = k.trim().toLowerCase()
      if (trimmed) list.push(trimmed)
    }
  }
  return new Set(list)
}

/** 字段名命中（不分大小写 + 子串匹配，方便覆盖 *_token / *Authorization 等变体） */
function shouldRedactKey(key: string, redactKeys: Set<string>): boolean {
  const lower = key.toLowerCase()
  if (redactKeys.has(lower)) return true
  for (const k of redactKeys) {
    if (lower.includes(k)) return true
  }
  return false
}

/**
 * 深度递归 clone + 脱敏。返回新对象，不 mutate 输入。
 * 循环引用：用 WeakSet 跟踪，遇到环返回字符串 `[Circular]`。
 */
export function redact(value: unknown): unknown {
  const redactKeys = getRedactKeys()
  const seen = new WeakSet<object>()

  function walk(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) return '[Circular]'
    seen.add(v as object)

    if (Array.isArray(v)) {
      return v.map((item) => walk(item))
    }
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (shouldRedactKey(k, redactKeys)) {
        out[k] = REDACTED
      } else {
        out[k] = walk(val)
      }
    }
    return out
  }

  return walk(value)
}

/**
 * 截断超大 payload（JSON.stringify 后超 maxBytes 则截断 + 标记 truncated）。
 * 默认 64KB 上限，防 logger 写盘撑爆。
 */
export function truncate(value: unknown, maxBytes = 64 * 1024): unknown {
  const json = JSON.stringify(value)
  if (json.length <= maxBytes) return value
  return {
    __truncated: true,
    __originalBytes: json.length,
    preview: json.slice(0, maxBytes),
  }
}

/** 一站式：先 redact 再 truncate */
export function safeForLog(value: unknown, maxBytes?: number): unknown {
  return truncate(redact(value), maxBytes)
}
