import { Hono } from 'hono'
import type { LogPayload } from '@big-ppt/shared'
import { getLatestSession, handleLogEvent } from '../logger/index.js'

export const log = new Hono()

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
