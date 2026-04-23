/**
 * Auth routes: register / login / logout / me / llm-settings
 */
import { Hono } from 'hono'
import bcrypt from 'bcrypt'
import * as cookie from 'cookie'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, users, sessions } from '../db/index.js'
import { SESSION_COOKIE, SESSION_TTL_MS, type AuthVars } from '../middleware/auth.js'
import { encryptApiKey, decryptApiKey } from '../crypto/apikey.js'

const BCRYPT_ROUNDS = 10

function sanitizeUser(u: { id: number; email: string; llmSettings: string | null }) {
  return {
    id: u.id,
    email: u.email,
    hasLlmSettings: !!u.llmSettings,
  }
}

function issueSessionCookie(sid: string, expiresAt: Date): string {
  const isProd = process.env.NODE_ENV === 'production'
  return cookie.serialize(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: expiresAt,
  })
}

function clearSessionCookie(): string {
  return cookie.serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  })
}

async function createSession(userId: number): Promise<{ sid: string; expiresAt: Date }> {
  const sid = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const db = getDb()
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt,
  })
  return { sid, expiresAt }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255
}

export const auth = new Hono<{ Variables: AuthVars }>()

type AuthBody = { email?: string; password?: string }
type LlmSettingsBody = { provider?: string; apiKey?: string; baseUrl?: string; model?: string }

auth.post('/register', async (c) => {
  const body = await c.req.json<AuthBody>().catch((): AuthBody => ({}))
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''

  if (!isValidEmail(email)) return c.json({ error: '邮箱格式不正确' }, 400)
  if (password.length < 6) return c.json({ error: '密码至少 6 位' }, 400)

  const db = getDb()
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing.length > 0) return c.json({ error: '该邮箱已注册' }, 409)

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  await db.insert(users).values({ email, passwordHash })

  // MySQL insert 不稳定返回 insertId（驱动/版本差异），用 email 回查拿用户
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!u) return c.json({ error: '注册失败（无法回查用户）' }, 500)

  const { sid, expiresAt } = await createSession(u.id)
  c.header('Set-Cookie', issueSessionCookie(sid, expiresAt))
  return c.json({ user: sanitizeUser(u) }, 201)
})

auth.post('/login', async (c) => {
  const body = await c.req.json<AuthBody>().catch((): AuthBody => ({}))
  const email = body.email?.trim().toLowerCase() ?? ''
  const password = body.password ?? ''

  if (!email || !password) return c.json({ error: '邮箱或密码为空' }, 400)

  const db = getDb()
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!u) return c.json({ error: '邮箱或密码错误' }, 401)

  const ok = await bcrypt.compare(password, u.passwordHash)
  if (!ok) return c.json({ error: '邮箱或密码错误' }, 401)

  const { sid, expiresAt } = await createSession(u.id)
  c.header('Set-Cookie', issueSessionCookie(sid, expiresAt))
  return c.json({ user: sanitizeUser(u) })
})

auth.post('/logout', async (c) => {
  const session = c.get('session')
  if (session) {
    const db = getDb()
    await db.delete(sessions).where(eq(sessions.id, session.id))
  }
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

auth.get('/me', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ user: sanitizeUser(user) })
})

auth.get('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.llmSettings) {
    return c.json({ provider: null, model: null, baseUrl: null, hasApiKey: false })
  }
  try {
    const parsed = JSON.parse(decryptApiKey(user.llmSettings)) as LlmSettingsBody
    return c.json({
      provider: parsed.provider ?? null,
      model: parsed.model ?? null,
      baseUrl: parsed.baseUrl ?? null,
      hasApiKey: !!parsed.apiKey,
    })
  } catch (err) {
    return c.json({ error: `解密失败：${(err as Error).message}` }, 500)
  }
})

auth.put('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json<LlmSettingsBody>().catch((): LlmSettingsBody => ({}))

  // 若未给 apiKey：要求已存在旧值，保留旧 apiKey 只更新其他字段
  let apiKey = body.apiKey?.trim() ?? ''
  if (!apiKey) {
    if (!user.llmSettings) return c.json({ error: 'apiKey 为空' }, 400)
    try {
      const prev = JSON.parse(decryptApiKey(user.llmSettings)) as LlmSettingsBody
      apiKey = prev.apiKey ?? ''
    } catch (err) {
      return c.json({ error: `旧配置解密失败：${(err as Error).message}` }, 500)
    }
    if (!apiKey) return c.json({ error: 'apiKey 为空' }, 400)
  }

  const provider = body.provider?.trim() || 'zhipu'
  const model = body.model?.trim() || undefined
  const baseUrl = body.baseUrl?.trim() || undefined

  const payload = JSON.stringify({ provider, apiKey, baseUrl, model })
  const encrypted = encryptApiKey(payload)

  const db = getDb()
  await db.update(users).set({ llmSettings: encrypted }).where(eq(users.id, user.id))

  return c.json({ ok: true })
})
