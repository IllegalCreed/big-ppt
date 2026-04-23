/**
 * Auth 中间件：从 Cookie 解析 session id，查表后把 user 注入 Hono Context。
 *
 * - `authOptional`: 挂全局，有 session 就注入，没有也不拦截
 * - `requireAuth`:  需要登录的路由链式调用，没登录返回 401
 */
import type { MiddlewareHandler } from 'hono'
import * as cookie from 'cookie'
import { eq } from 'drizzle-orm'
import { getDb, sessions, users, type User, type Session } from '../db/index.js'

export const SESSION_COOKIE = 'lumideck_session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000 // 30 天

export type AuthVars = {
  user: User | null
  session: Session | null
}

export const authOptional: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  c.set('user', null)
  c.set('session', null)

  const header = c.req.header('Cookie')
  if (header) {
    const parsed = cookie.parse(header)
    const sid = parsed[SESSION_COOKIE]
    if (sid) {
      const db = getDb()
      const rows = await db
        .select({
          session: sessions,
          user: users,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, sid))
        .limit(1)

      const row = rows[0]
      if (row && row.session.expiresAt.getTime() > Date.now()) {
        c.set('user', row.user)
        c.set('session', row.session)
      }
    }
  }

  await next()
}

export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await next()
}

/**
 * 给原生 http upgrade 事件 / 非 Hono 路径用的 session 验证 helper。
 * 返回 (user, session) 或 null；不依赖 Hono Context。
 */
export async function validateSessionFromCookie(cookieHeader: string | undefined): Promise<{
  user: User
  session: Session
} | null> {
  if (!cookieHeader) return null
  const parsed = cookie.parse(cookieHeader)
  const sid = parsed[SESSION_COOKIE]
  if (!sid) return null

  const db = getDb()
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sid))
    .limit(1)
  const row = rows[0]
  if (!row || row.session.expiresAt.getTime() <= Date.now()) return null
  return row
}

