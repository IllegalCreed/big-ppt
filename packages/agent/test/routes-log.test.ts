/**
 * Phase 9-B：/log-event + /log/latest 加 requireAuth 验证。
 *
 * 之前是公开端点 → A01 漏洞（任意人可写读日志，含 user prompt + LLM response）。
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { log } from '../src/routes/log.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', log)
  return app
}

describe('routes/log auth', () => {
  it('POST /log-event 未登录 → 401', async () => {
    const res = await makeApp().request('/api/log-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 's', kind: 'k', payload: {} }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /log/latest 未登录 → 401', async () => {
    const res = await makeApp().request('/api/log/latest')
    expect(res.status).toBe(401)
  })

  it('POST /log-event 登录后接受 payload', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await makeApp().request('/api/log-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ session: 'test-session', kind: 'user-input', payload: { x: 1 } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
