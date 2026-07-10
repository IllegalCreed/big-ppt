import { Hono } from 'hono'
import type { LogPayload } from '@big-ppt/shared'
import { getLatestSession, handleLogEvent } from '../logger/index.js'
import { requireAuth, type AuthVars } from '../middleware/auth.js'
import { createRateLimit, userOrIpKey } from '../middleware/rate-limit.js'
import { getRequestContext } from '../context.js'

export const log = new Hono<{ Variables: AuthVars }>()

// Phase 9-B（A01）：日志含 user prompt / response，仅登录用户能写读
log.use('/log-event', requireAuth)
log.use('/log/latest', requireAuth)

// Phase 9-E（A04）：log-event 写入 10 / min / user，防灌日志
const logEventLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60/min/user，给前端 errorHandler 自动上报留余量
  keyResolver: userOrIpKey,
  errorMessage: '日志上报频率超限',
})
log.use('/log-event', logEventLimit)

log.post('/log-event', async (c) => {
  try {
    const raw = (await c.req.json()) as LogPayload
    // requireAuth 已挂在前面,user 必非空;deckId 由可选 X-Deck-Id 注入 ALS。
    const user = c.get('user')!
    const result = handleLogEvent(raw, {
      userId: user.id,
      deckId: getRequestContext().activeDeckId,
    })
    return c.json(result)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

log.get('/log/latest', (c) => {
  try {
    const result = getLatestSession()
    return c.json(result)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
