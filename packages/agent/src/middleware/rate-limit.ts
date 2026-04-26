/**
 * Phase 9-E（A04 Insecure Design）：自撸内存 token-bucket rate limit。
 *
 * 用途：登录 / 注册 / LLM 代理 / log-event 等敏感端点防暴力破解 / 滥用 / 烧 token。
 * 设计：单进程内存 Map<key, Bucket>，key 由 keyResolver 决定（IP / userId）；
 * 不引 Redis（Phase 10 单实例够用，Phase 11 多实例时迁集中式）。
 *
 * 测试 / E2E 跑测时设 `RATE_LIMIT_ENABLED=false` 全局禁用，避免误伤。
 */
import type { MiddlewareHandler } from 'hono'

interface Bucket {
  /** 当前 window 已用次数 */
  count: number
  /** 当前 window 起始时间戳（ms） */
  windowStart: number
}

export interface RateLimitOptions {
  /** 时间窗口（ms） */
  windowMs: number
  /** 同一 key 在窗口内允许的最大次数 */
  max: number
  /**
   * key 解析器，决定按什么聚合限速。常用：
   *   - per-IP：从 X-Forwarded-For 或 socket address 取
   *   - per-user：从 ctx.var.user.id 取（要求 authOptional 已挂）
   * 默认走 X-Forwarded-For 头第一个 IP（Phase 10 反代场景）+ 兜底 'anon'
   */
  keyResolver?: (c: Parameters<MiddlewareHandler>[0]) => string
  /** 命中限速时返回的错误信息 */
  errorMessage?: string
}

/** 全局共享 Map：避免每个 middleware 实例独立计数（同 key 跨 middleware 不共享会错）。
 *  以 `${scope}:${key}` 索引；scope 由 createRateLimit 的 windowMs+max 自动生成。 */
const buckets = new Map<string, Bucket>()

/** 周期性清理过期 bucket，避免长跑 OOM */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let lastSweep = Date.now()
function sweepIfDue(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [k, b] of buckets) {
    if (now - b.windowStart > windowMs * 2) buckets.delete(k)
  }
}

function defaultKey(c: Parameters<MiddlewareHandler>[0]): string {
  const xff = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
  if (xff) return xff
  const xri = c.req.header('X-Real-IP')?.trim()
  if (xri) return xri
  return 'anon'
}

export function createRateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max } = opts
  const resolver = opts.keyResolver ?? defaultKey
  const errorMessage = opts.errorMessage ?? 'Too many requests'
  const scope = `w${windowMs}m${max}` // 每组 (windowMs, max) 独立 namespace

  return async (c, next) => {
    if (process.env.RATE_LIMIT_ENABLED === 'false') {
      await next()
      return
    }
    const key = resolver(c)
    const now = Date.now()
    const fullKey = `${scope}:${key}`
    let bucket = buckets.get(fullKey)
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now }
      buckets.set(fullKey, bucket)
    }
    bucket.count++
    sweepIfDue(now, windowMs)
    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.windowStart + windowMs - now) / 1000)
      c.header('Retry-After', String(Math.max(1, retryAfterSec)))
      return c.json({ error: errorMessage }, 429)
    }
    await next()
  }
}

/** 解析 user.id 作 key（user 维度限速）；未登录走默认 IP key，由 fallback 兜底 */
export function userOrIpKey(c: Parameters<MiddlewareHandler>[0]): string {
  // 注意：此 key 解析器要求路由前已挂 authOptional 中间件
  const u = c.get('user') as { id?: number } | null | undefined
  if (u?.id != null) return `u:${u.id}`
  return defaultKey(c)
}

/** 测试用：清空所有 bucket（避免跨 case 污染） */
export function __resetRateLimitForTesting(): void {
  buckets.clear()
  lastSweep = Date.now()
}
