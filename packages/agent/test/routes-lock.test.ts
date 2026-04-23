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
  it('activate-deck: 成功返回 ok，session.activeDeckId 被更新', async () => {
    const app = makeApp()
    const { user, cookie, sid } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    const res = await post(app, `/api/activate-deck/${deck.id}`, cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deckId: deck.id })

    const db = getDb()
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1)
    expect(s?.activeDeckId).toBe(deck.id)
  })

  it('activate-deck: 跨用户访问 → 403', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(a.user.id)
    const res = await post(app, `/api/activate-deck/${deck.id}`, b.cookie)
    expect(res.status).toBe(403)
  })

  it('activate-deck: 已软删 deck → 404', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    const db = getDb()
    await db.update(decks).set({ status: 'deleted' }).where(eq(decks.id, deck.id))

    const res = await post(app, `/api/activate-deck/${deck.id}`, cookie)
    expect(res.status).toBe(404)
  })

  it('activate-deck: 已被他人占用 → 409 + holder 邮箱', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('holder@a.com')
    const b = await createLoggedInUser('waiter@a.com')
    const { deck: aDeck } = await createDeckDirect(a.user.id, 'A deck')
    const { deck: bDeck } = await createDeckDirect(b.user.id, 'B deck')

    // A 占用
    const ok = await post(app, `/api/activate-deck/${aDeck.id}`, a.cookie)
    expect(ok.status).toBe(200)

    // B 尝试占自己的 deck（全局单锁，应 409）
    const conflict = await post(app, `/api/activate-deck/${bDeck.id}`, b.cookie)
    expect(conflict.status).toBe(409)
    const body = await conflict.json()
    expect(body.holder.email).toBe('holder@a.com')
    expect(body.holder.deckId).toBe(aDeck.id)
  })

  it('release-deck: 持有者释放 → session.activeDeckId 置 null', async () => {
    const app = makeApp()
    const { user, cookie, sid } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    await post(app, `/api/activate-deck/${deck.id}`, cookie)

    const res = await post(app, '/api/release-deck', cookie)
    expect(res.status).toBe(200)

    const db = getDb()
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1)
    expect(s?.activeDeckId).toBeNull()
  })

  it('release-deck: 非持有者调用 → 幂等 200，不动他人锁', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('x@a.com')
    const b = await createLoggedInUser('y@a.com')
    const { deck: aDeck } = await createDeckDirect(a.user.id)
    await post(app, `/api/activate-deck/${aDeck.id}`, a.cookie)

    const res = await post(app, '/api/release-deck', b.cookie)
    expect(res.status).toBe(200)

    // A 的锁还在
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
    await post(app, `/api/activate-deck/${deck.id}`, a.cookie)

    const hA = await post(app, '/api/heartbeat', a.cookie)
    expect((await hA.json()).heldByMe).toBe(true)

    const hB = await post(app, '/api/heartbeat', b.cookie)
    expect((await hB.json()).heldByMe).toBe(false)
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
    await post(app, `/api/activate-deck/${deck.id}`, a.cookie)
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
