/**
 * Request context middleware（必须挂在 authOptional 之后）：
 * 把 ctx.user / ctx.session 包进 AsyncLocalStorage，下游 slides-store 能读到 activeDeckId。
 */
import type { MiddlewareHandler } from 'hono'
import { runInRequest } from '../context.js'
import type { AuthVars } from './auth.js'

export const requestContextMiddleware: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const user = c.get('user')
  const session = c.get('session')
  await runInRequest(
    {
      userId: user?.id ?? null,
      sessionId: session?.id ?? null,
      activeDeckId: session?.activeDeckId ?? null,
      turnId: null,
    },
    async () => {
      await next()
    },
  )
}
