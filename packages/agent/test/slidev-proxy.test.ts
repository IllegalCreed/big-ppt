import { describe, expect, it } from 'vitest'
import { authorizeSlidevAccess } from '../src/slidev-proxy-auth.js'
import { tryAcquire } from '../src/slidev-lock.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { SESSION_COOKIE } from '../src/middleware/auth.js'

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
