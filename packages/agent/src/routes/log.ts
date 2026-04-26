import { Hono } from 'hono'
import type { LogPayload } from '@big-ppt/shared'
import { getLatestSession, handleLogEvent } from '../logger/index.js'
import { requireAuth, type AuthVars } from '../middleware/auth.js'

export const log = new Hono<{ Variables: AuthVars }>()

// Phase 9-B（A01）：日志含 user prompt / response，仅登录用户能写读
log.use('/log-event', requireAuth)
log.use('/log/latest', requireAuth)

log.post('/log-event', async (c) => {
  try {
    const raw = (await c.req.json()) as LogPayload
    const result = handleLogEvent(raw)
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
