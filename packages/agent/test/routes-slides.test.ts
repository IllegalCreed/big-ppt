/**
 * Phase 9-B:/read-slides + /restore-slides + /redo-slides 加 requireAuth + 持锁守卫。
 * P0 fix(2026-05-18):底层 slides-store 改 DB-based;/read-slides 仍读 slides.md 文件 mirror
 * (给 Slidev SPA 用),/restore-slides + /redo-slides 走 DB-based undo/redo,deckId 从锁拿。
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
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'

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
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# locked mirror content\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  __resetPathsForTesting()
  forceRelease()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
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
    expect(json.error).toMatch(/全屏放映/)
  })

  it('登录但持锁是别人的 → 403', async () => {
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const acq = tryAcquire({ sessionId: a.sid, userId: a.user.id, userEmail: a.user.email, deckId: 1, deckTitle: 't' })
    expect(acq.ok).toBe(true)
    const res = await makeApp().request('/api/read-slides', { headers: { Cookie: b.cookie } })
    expect(res.status).toBe(403)
  })

  it('登录且持锁 GET /read-slides → 200 + slides.md mirror 原文', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    const acq = tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: 1, deckTitle: 't' })
    expect(acq.ok).toBe(true)
    const res = await makeApp().request('/api/read-slides', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('# locked mirror content\n')
  })

  it('登录且持锁 POST /restore-slides → 无历史时 404', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D', 'only-version')
    tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: deck.id, deckTitle: 't' })
    const res = await makeApp().request('/api/restore-slides', { method: 'POST', headers: { Cookie: cookie } })
    expect(res.status).toBe(404) // 只有 initial version,无可 undo
  })

  it('登录且持锁 POST /redo-slides → 无 redo 栈时 404', async () => {
    const { user, sid, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D', 'only-version')
    tryAcquire({ sessionId: sid, userId: user.id, userEmail: user.email, deckId: deck.id, deckTitle: 't' })
    const res = await makeApp().request('/api/redo-slides', { method: 'POST', headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
  })
})
