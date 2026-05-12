import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

// mirror 会写真实 slides.md，测试里替换成 noop，避免污染 packages/slidev/slides.md
vi.mock('../src/deck/mirror.js', () => ({
  mirrorSlidesContent: vi.fn(),
}))

import { lockRoute } from '../src/routes/lock.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { getDb, sessions, decks } from '../src/db/index.js'
import { eq } from 'drizzle-orm'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', lockRoute)
  return app
}

async function post(app: Hono, path: string, cookie?: string) {
  return app.request(path, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  })
}

describe('routes/lock', () => {
  // Phase 10.5 Task 25-D-2 起 activate-deck 路由已删；release / heartbeat /
  // lock-status 通过 present 路由 setup 锁后测试。

  it('release-deck: 持有者释放（present 抢锁版）', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    await post(app, `/api/present/${deck.id}`, cookie)

    const res = await post(app, '/api/release-deck', cookie)
    expect(res.status).toBe(200)

    // 释放后 lock-status 该是 unlocked
    const status = await app.request('/api/lock-status', { headers: { Cookie: cookie } })
    expect((await status.json()).locked).toBe(false)
  })

  it('release-deck: 非持有者调用 → 幂等 200，不动他人锁', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('x@a.com')
    const b = await createLoggedInUser('y@a.com')
    const { deck: aDeck } = await createDeckDirect(a.user.id)
    await post(app, `/api/present/${aDeck.id}`, a.cookie)

    const res = await post(app, '/api/release-deck', b.cookie)
    expect(res.status).toBe(200)

    const status = await app.request('/api/lock-status', { headers: { Cookie: a.cookie } })
    const body = await status.json()
    expect(body.locked).toBe(true)
    expect(body.isMe).toBe(true)
  })

  it('heartbeat: 持有者 → heldByMe=true；非持有者 → false', async () => {
    const app = makeApp()
    const a = await createLoggedInUser()
    const b = await createLoggedInUser('other@a.com')
    const { deck } = await createDeckDirect(a.user.id)
    await post(app, `/api/present/${deck.id}`, a.cookie)

    const hA = await post(app, '/api/heartbeat', a.cookie)
    expect((await hA.json()).heldByMe).toBe(true)

    const hB = await post(app, '/api/heartbeat', b.cookie)
    expect((await hB.json()).heldByMe).toBe(false)
  })

  it('lock-status 未登录 → 401（Phase 9-B 防 holder.email 枚举）', async () => {
    const app = makeApp()
    const res = await app.request('/api/lock-status')
    expect(res.status).toBe(401)
  })

  // ── Phase 10.5：present 路由 — 演讲放映抢锁 ──────────────────────
  it('present: owner 抢锁成功，但 session.activeDeckId 保持 null（不再写）', async () => {
    const app = makeApp()
    const { user, cookie, sid } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    const res = await post(app, `/api/present/${deck.id}`, cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deckId: deck.id })

    const db2 = getDb()
    const [s] = await db2.select().from(sessions).where(eq(sessions.id, sid)).limit(1)
    // 跟 activate-deck 不同：present 不写 activeDeckId
    expect(s?.activeDeckId).toBeNull()
  })

  it('present: 已被他人占用 → 409 + holder', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('p-a@a.com')
    const b = await createLoggedInUser('p-b@a.com')
    const { deck: aDeck } = await createDeckDirect(a.user.id, 'A deck')
    const { deck: bDeck } = await createDeckDirect(b.user.id, 'B deck')

    const ok = await post(app, `/api/present/${aDeck.id}`, a.cookie)
    expect(ok.status).toBe(200)

    const conflict = await post(app, `/api/present/${bDeck.id}`, b.cookie)
    expect(conflict.status).toBe(409)
    const body = await conflict.json()
    expect(body.holder.email).toBe('p-a@a.com')
    expect(body.holder.deckId).toBe(aDeck.id)
  })

  it('present: 跨用户访问别人的 deck → 403', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('owner@a.com')
    const b = await createLoggedInUser('intruder@a.com')
    const { deck } = await createDeckDirect(a.user.id)

    const res = await post(app, `/api/present/${deck.id}`, b.cookie)
    expect(res.status).toBe(403)
  })

  it('present: 未登录 → 401', async () => {
    const app = makeApp()
    const res = await post(app, '/api/present/1')
    expect(res.status).toBe(401)
  })

  it('lock-status: 空锁 / 他人持有 / 自己持有 三态', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('la@a.com')
    const b = await createLoggedInUser('lb@a.com')

    // 1. 空锁
    const empty = await app.request('/api/lock-status', { headers: { Cookie: a.cookie } })
    expect((await empty.json()).locked).toBe(false)

    // 2. A 持有，B 看
    const { deck } = await createDeckDirect(a.user.id)
    await post(app, `/api/present/${deck.id}`, a.cookie)
    const viewedByB = await app.request('/api/lock-status', { headers: { Cookie: b.cookie } })
    const bodyB = await viewedByB.json()
    expect(bodyB).toMatchObject({ locked: true, isMe: false })
    expect(bodyB.holder.email).toBe('la@a.com')

    // 3. A 自己看
    const viewedByA = await app.request('/api/lock-status', { headers: { Cookie: a.cookie } })
    const bodyA = await viewedByA.json()
    expect(bodyA).toMatchObject({ locked: true, isMe: true })
  })
})
