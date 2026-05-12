/**
 * Request context middleware（必须挂在 authOptional 之后）：
 * 把 ctx.user / ctx.session 包进 AsyncLocalStorage，下游 slides-store 能读到 activeDeckId。
 *
 * Phase 10.5：activeDeckId 来源优先级：
 *   1. 请求头 `X-Deck-Id`（前端编辑器场景每次显式带，编辑器不抢锁后此为主源）
 *   2. session.activeDeckId（向后兼容；Phase 10.5 起编辑器永不设置，仅 release 写 null）
 * 解析失败时取 null。
 */
import type { MiddlewareHandler } from 'hono'
import { runInRequest } from '../context.js'
import type { AuthVars } from './auth.js'

function parseDeckIdHeader(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export const requestContextMiddleware: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const user = c.get('user')
  const session = c.get('session')
  const headerDeckId = parseDeckIdHeader(c.req.header('x-deck-id'))
  await runInRequest(
    {
      userId: user?.id ?? null,
      sessionId: session?.id ?? null,
      activeDeckId: headerDeckId ?? session?.activeDeckId ?? null,
      turnId: null,
    },
    async () => {
      await next()
    },
  )
}
