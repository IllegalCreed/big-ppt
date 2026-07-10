/**
 * Request context middleware（必须挂在 authOptional 之后）：
 * 把 ctx.user / ctx.session 包进 AsyncLocalStorage，下游 slides-store 能读到 activeDeckId。
 *
 * activeDeckId 只来自显式请求头 `X-Deck-Id`。解析失败时取 null；session 中的
 * 旧字段不再参与 deck 选择，避免跨标签页隐式共享状态。
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
      activeDeckId: headerDeckId,
      turnId: null,
    },
    async () => {
      await next()
    },
  )
}
