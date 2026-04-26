/**
 * Phase 9-D（A05 Misconfiguration）：Origin / Referer 校验中间件。
 *
 * 主防线是 session cookie 的 `sameSite=lax`（auth.ts:23-31）—— 跨站 POST 默认带不上
 * cookie 一击即败。本中间件是**second-line defense**：state-changing 方法
 * （POST / PUT / DELETE / PATCH）必须带 Origin（或 Referer）且与 `PUBLIC_ORIGIN`
 * env 配置的允许源同源；GET / HEAD / OPTIONS 跳过。
 *
 * 例外清单：
 *   - /api/auth/login + /api/auth/register：登录前用户尚无 session，但传统跨域提交
 *     登录表单本身不是 CSRF（CSRF 攻击需要受害者已登录），且部分 browser/工具会省略 Origin
 *   - /api/auth/logout：无副作用幂等
 *
 * 配置：
 *   - PUBLIC_ORIGIN 不设：dev 兜底允许 localhost/127.0.0.1 任意端口；生产应**显式设置**
 *   - PUBLIC_ORIGIN_EXTRA：可选额外允许的 origin（CSV，预留 staging / preview 域名场景）
 */
import type { MiddlewareHandler } from 'hono'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/** 路径前缀豁免清单：登录前 / 幂等的 auth 端点 */
const EXEMPT_PATH_PREFIXES = ['/api/auth/login', '/api/auth/register', '/api/auth/logout']

function parseAllowedOrigins(): string[] | null {
  const main = process.env.PUBLIC_ORIGIN?.trim()
  const extra = process.env.PUBLIC_ORIGIN_EXTRA?.trim()
  if (!main && !extra) return null // dev 兜底模式
  const list: string[] = []
  if (main) list.push(main)
  if (extra) {
    for (const o of extra.split(',')) {
      const trimmed = o.trim()
      if (trimmed) list.push(trimmed)
    }
  }
  return list.length > 0 ? list : null
}

/** 严格匹配 origin（包含 protocol + host + port） */
function isAllowedStrict(candidate: string, allowed: string[]): boolean {
  return allowed.includes(candidate)
}

/** dev 兜底：允许 localhost / 127.0.0.1 任意端口 + 同 host 任意端口 */
function isLocalDevOrigin(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/** 提取 Referer 的 origin 部分（protocol + host + port） */
function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null
  try {
    const url = new URL(referer)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export const originCheck: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (!STATE_CHANGING_METHODS.has(method)) {
    await next()
    return
  }

  const path = new URL(c.req.url).pathname
  if (EXEMPT_PATH_PREFIXES.some((p) => path.startsWith(p))) {
    await next()
    return
  }

  const origin = c.req.header('Origin')
  const referer = c.req.header('Referer')
  const candidate = origin ?? refererOrigin(referer)

  // 完全没 Origin / Referer 的写请求一律拒绝（正经浏览器不该走到这里）
  if (!candidate) {
    return c.json({ error: 'forbidden: missing Origin/Referer' }, 403)
  }

  const allowed = parseAllowedOrigins()
  const ok = allowed
    ? isAllowedStrict(candidate, allowed)
    : isLocalDevOrigin(candidate) // dev 兜底
  if (!ok) {
    return c.json({ error: 'forbidden: origin not allowed' }, 403)
  }
  await next()
}
