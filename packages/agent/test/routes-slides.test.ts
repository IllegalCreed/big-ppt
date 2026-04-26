/**
 * Phase 9-B：/read-slides + /restore-slides + /redo-slides 加 requireAuth + 持锁守卫。
 *
 * 之前公开端点 → A01 漏洞（任意人可读 lock holder 的 slides.md / 触发 undo/redo）。
 *
 * 守卫策略：
 *   - 未登录 → 401
 *   - 登录但未持锁 → 403
 *   - 登录且持锁 → 通过
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { slides } from '../src/routes/slides.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { forceRelease, tryAcquire } from '../src/slidev-lock.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', slides)
  return app
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-slides-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(slidevDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# locked content\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_HISTORY_DIR = path.join(tmpRoot, 'slides-history')
  __resetPathsForTesting()
  forceRelease()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_HISTORY_DIR
  __resetPathsForTesting()
  forceRelease()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('routes/slides 持锁守卫', () => {
  it('未登录 GET /read-slides → 401', async () => {
    const res = await makeApp().request('/api/read-slides')
    expect(res.status).toBe(401)
  })

  it('未登录 POST /restore-slides → 401', async () => {
    const res = await makeApp().request('/api/restore-slides', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('登录但未持锁 → 403', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await makeApp().request('/api/read-slides', { headers: { Cookie: cookie } })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/activate-deck/)
  })

  it('登录但持锁是别人的 → 403', async () => {
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const acq = tryAcquire({ sessionId: a.sid, userId: a.user.id, userEmail: a.user.email, deckId: 1, deckTitle: 't' })
    expect(acq.ok).toBe(true)
    const res = await makeApp().request('/api/read-slides', { headers: { Cookie: b.cookie } })
    expect(res.status).toBe(403)
  })

  it('登录且持锁 GET /read-slides → 200 + slides.md 原文', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    const acq = tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: 1, deckTitle: 't' })
    expect(acq.ok).toBe(true)
    const res = await makeApp().request('/api/read-slides', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('# locked content\n')
  })

  it('登录且持锁 POST /restore-slides → 走 slides-store（无历史时 404）', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: 1, deckTitle: 't' })
    const res = await makeApp().request('/api/restore-slides', { method: 'POST', headers: { Cookie: cookie } })
    // 没历史 → restoreSlides 返 404
    expect(res.status).toBe(404)
  })

  it('登录且持锁 POST /redo-slides → 走 slides-store（无历史时 404）', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: 1, deckTitle: 't' })
    const res = await makeApp().request('/api/redo-slides', { method: 'POST', headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
  })
})
