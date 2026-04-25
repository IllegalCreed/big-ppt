import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { authorizeSlidevAccess } from '../src/slidev-proxy-auth.js'
import { tryAcquire, getHolder, __resetForTesting as resetLock } from '../src/slidev-lock.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { SESSION_COOKIE } from '../src/middleware/auth.js'
import { getDb, sessions, decks } from '../src/db/index.js'

useTestDb()

describe('slidev-proxy authorize', () => {
  it('无 cookie → 401', async () => {
    const result = await authorizeSlidevAccess(undefined)
    expect(result).toEqual({ ok: false, status: 401, message: 'unauthorized' })
  })

  it('Cookie 头不含 lumideck_session → 401', async () => {
    const result = await authorizeSlidevAccess('other=foo; bar=baz')
    expect(result).toMatchObject({ ok: false, status: 401 })
  })

  it('有效 session 但不是当前锁持有者 → 403', async () => {
    const { cookie } = await createLoggedInUser('not-holder@a.com')
    // 别人占着锁
    tryAcquire({
      sessionId: 'someone-else-session-id',
      userId: 999,
      userEmail: 'other@a.com',
      deckId: 1,
      deckTitle: 'other deck',
    })
    const result = await authorizeSlidevAccess(cookie)
    expect(result).toMatchObject({ ok: false, status: 403 })
  })

  it('有效 session + 自己持有锁 → ok', async () => {
    const { user, sid, cookie } = await createLoggedInUser('holder@a.com')
    tryAcquire({
      sessionId: sid,
      userId: user.id,
      userEmail: user.email,
      deckId: 99,
      deckTitle: 'mine',
    })
    const result = await authorizeSlidevAccess(cookie)
    expect(result).toEqual({ ok: true })

    // cookie 里包含其他 kv 也能正确识别 session
    const mixedCookie = `theme=dark; ${SESSION_COOKIE}=${sid}; lang=zh`
    const result2 = await authorizeSlidevAccess(mixedCookie)
    expect(result2).toEqual({ ok: true })
  })
})

describe('slidev-proxy authorize · agent 重启自动复位（Phase 7D fix）', () => {
  beforeEach(() => {
    resetLock()
  })

  it('锁为空 + session.activeDeckId 已设 + deck 属于自己 → 自动 reacquire 通过', async () => {
    const { user, sid, cookie } = await createLoggedInUser('restart@a.com')
    const { deck } = await createDeckDirect(user.id, 'My Active Deck')
    // 模拟用户之前 activate 过 deck（sessions.activeDeckId 已写入）
    await getDb().update(sessions).set({ activeDeckId: deck.id }).where(eq(sessions.id, sid))

    // 锁为空（模拟 agent 重启清零）
    expect(getHolder()).toBeNull()

    const result = await authorizeSlidevAccess(cookie)
    expect(result).toEqual({ ok: true })

    // 锁已自动复位到当前 session
    const holder = getHolder()
    expect(holder?.sessionId).toBe(sid)
    expect(holder?.deckId).toBe(deck.id)
  })

  it('锁被别人持有 + 自己 session 已激活 → 不抢，仍 403', async () => {
    const { user, sid, cookie } = await createLoggedInUser('me@a.com')
    const { deck } = await createDeckDirect(user.id, 'Mine')
    await getDb().update(sessions).set({ activeDeckId: deck.id }).where(eq(sessions.id, sid))

    // 别人占着
    tryAcquire({
      sessionId: 'other-session-id',
      userId: 999,
      userEmail: 'other@a.com',
      deckId: 1,
      deckTitle: 'other',
    })

    const result = await authorizeSlidevAccess(cookie)
    expect(result).toMatchObject({ ok: false, status: 403 })
    // 锁仍是别人的，没被错误覆盖
    expect(getHolder()?.sessionId).toBe('other-session-id')
  })

  it('锁为空 + session 从未 activate → 仍 403（用户走正常 activate 流）', async () => {
    const { cookie } = await createLoggedInUser('never-activated@a.com')
    expect(getHolder()).toBeNull()

    const result = await authorizeSlidevAccess(cookie)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(getHolder()).toBeNull() // 没自动 acquire
  })

  it('锁为空 + session.activeDeckId 指向已被软删的 deck → 仍 403，不复位', async () => {
    const { user, sid, cookie } = await createLoggedInUser('deleted-deck@a.com')
    const { deck } = await createDeckDirect(user.id, 'GoneSoon')
    await getDb().update(sessions).set({ activeDeckId: deck.id }).where(eq(sessions.id, sid))
    await getDb().update(decks).set({ status: 'deleted' }).where(eq(decks.id, deck.id))

    const result = await authorizeSlidevAccess(cookie)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(getHolder()).toBeNull()
  })
})
