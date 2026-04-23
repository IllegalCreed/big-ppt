import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  authOptional,
  requireAuth,
  validateSessionFromCookie,
  SESSION_COOKIE,
  type AuthVars,
} from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createSessionFor, createTestUser } from './_setup/factories.js'
import { getDb, sessions } from '../src/db/index.js'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.get('/pub', (c) => c.json({ user: c.get('user')?.email ?? null }))
  const protectedRoute = new Hono<{ Variables: AuthVars }>()
  protectedRoute.use('*', requireAuth)
  protectedRoute.get('/me', (c) => c.json({ user: c.get('user')!.email }))
  app.route('/protected', protectedRoute)
  return app
}

describe('middleware/auth', () => {
  it('无 Cookie: user=null，requireAuth 返 401', async () => {
    const app = makeApp()
    const pub = await app.request('/pub')
    expect(pub.status).toBe(200)
    expect(await pub.json()).toEqual({ user: null })

    const prot = await app.request('/protected/me')
    expect(prot.status).toBe(401)
    expect(await prot.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('Cookie 里 sid 不在 DB: user=null', async () => {
    const app = makeApp()
    const res = await app.request('/pub', {
      headers: { Cookie: `${SESSION_COOKIE}=ghost-session-id` },
    })
    expect(await res.json()).toEqual({ user: null })
  })

  it('会话已过期: user=null', async () => {
    const { user } = await createTestUser('expired@a.com')
    const db = getDb()
    const sid = randomBytes(16).toString('hex')
    await db.insert(sessions).values({
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() - 1000),
    })
    const app = makeApp()
    const res = await app.request('/pub', { headers: { Cookie: `${SESSION_COOKIE}=${sid}` } })
    expect(await res.json()).toEqual({ user: null })
  })

  it('有效会话: user/session 注入，requireAuth 放行', async () => {
    const { user, cookie } = await createLoggedInUser('valid@a.com')

    const app = makeApp()
    const pub = await app.request('/pub', { headers: { Cookie: cookie } })
    expect(await pub.json()).toEqual({ user: user.email })

    const prot = await app.request('/protected/me', { headers: { Cookie: cookie } })
    expect(prot.status).toBe(200)
    expect(await prot.json()).toEqual({ user: user.email })
  })

  it('validateSessionFromCookie: undefined 返 null', async () => {
    expect(await validateSessionFromCookie(undefined)).toBeNull()
  })

  it('validateSessionFromCookie: Cookie 头不含 lumideck_session 返 null', async () => {
    expect(await validateSessionFromCookie('foo=bar; baz=qux')).toBeNull()
  })

  it('validateSessionFromCookie: 有效会话返回 { user, session }', async () => {
    const { user } = await createTestUser('v2@a.com')
    const { sid, cookie } = await createSessionFor(user.id)

    const result = await validateSessionFromCookie(cookie)
    expect(result).not.toBeNull()
    expect(result?.user.email).toBe('v2@a.com')
    expect(result?.session.id).toBe(sid)

    // 过期会话走同一接口应返 null（单独补 boundary）
    const db = getDb()
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 500) }).where(eq(sessions.id, sid))
    expect(await validateSessionFromCookie(cookie)).toBeNull()
  })
})
