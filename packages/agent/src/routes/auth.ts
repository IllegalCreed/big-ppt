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
import { encryptApiKey } from '../crypto/apikey.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { errorResponse } from '../utils/error-response.js'
import {
  ActiveProviderIdSchema,
  getActiveProviderConfig,
  migrateLegacySettings,
  type ActiveProviderId,
} from '../llm/settings.js'

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

// Phase 9-E（A04）：登录 / 注册 5 / 15min / IP 限速防暴力破解
const authLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  errorMessage: '请求过于频繁，请稍后再试',
})
auth.use('/login', authLimit)
auth.use('/register', authLimit)

type AuthBody = { email?: string; password?: string }
type LlmApiType = 'openai-compatible'
const SUPPORTED_API_TYPES: readonly LlmApiType[] = ['openai-compatible'] as const
type LlmSettingsBody = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  apiType?: string
}

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

/**
 * GET /api/auth/llm-settings:Settings UI 兼容期返回老 shape 给前端。
 *
 * Phase 12 Task F:DB 端 user.llmSettings 可能是老或新 shape(migration 跑前后)。
 * 通过 `getActiveProviderConfig` 归一化拿到 active provider 配置,再以**老 shape**
 * `{provider, model, baseUrl, apiType, hasApiKey}` 返回 —— Settings UI 在 Task J 才会
 * 改成读 activeProvider + providers 多家结构;现在保持兼容形态让 UI 零修改工作。
 *
 * apiType 字段在新 shape 中已废弃(只支持 'openai-compatible'),始终返常量。
 */
auth.get('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.llmSettings) {
    return c.json({ provider: null, model: null, baseUrl: null, apiType: null, hasApiKey: false })
  }
  const cfg = getActiveProviderConfig(user.llmSettings)
  if (!cfg) {
    // 解密 / parse 失败:跟之前一样走 errorResponse(prod 仅 generic + errorId)。
    // 自行构造 Error 让 errorResponse 走完日志 + 脱敏路径(message 不外泄到 frontend)。
    return errorResponse(c, new Error('llm_settings 解密或 parse 失败'), {
      publicMessage: 'LLM 配置读取失败',
    })
  }
  return c.json({
    provider: cfg.provider,
    model: cfg.model ?? null,
    baseUrl: cfg.baseUrl ?? null,
    apiType: 'openai-compatible',
    hasApiKey: true,
  })
})

/**
 * PUT /api/auth/llm-settings:Settings UI 兼容期接受老 shape body。
 *
 * Phase 12 Task F:内部把老 shape 通过 `migrateLegacySettings` 转成新 shape 再加密入库
 * —— 这样 migration script 跑过后 UI 仍能保存(下游 LLM 路由 + MCP 都读新 shape)。
 * Task J 改 UI 后,本路由可同时接受 newShape body(后向兼容)。
 *
 * provider 白名单:必须是 ActiveProviderIdSchema 的 7 个 id;Settings UI 后续应改成
 * 下拉而非 free-form 输入,但当前还允许用户输入任意串,这里加 400 校验防垃圾数据。
 */
auth.put('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json<LlmSettingsBody>().catch((): LlmSettingsBody => ({}))

  // 若未给 apiKey:要求已存在旧值,保留旧 apiKey 只更新其他字段
  let apiKey = body.apiKey?.trim() ?? ''
  if (!apiKey) {
    if (!user.llmSettings) return c.json({ error: 'apiKey 为空' }, 400)
    const prev = getActiveProviderConfig(user.llmSettings)
    if (!prev) {
      // 加密 / parse 失败(旧密文损坏),沿用 errorResponse generic 脱敏路径
      return errorResponse(c, new Error('旧 llm_settings 解密或 parse 失败'), {
        publicMessage: '旧 LLM 配置读取失败',
      })
    }
    apiKey = prev.apiKey
    if (!apiKey) return c.json({ error: 'apiKey 为空' }, 400)
  }

  // apiType 目前仅支持 'openai-compatible';留空时默认它,显式传不在白名单的值 → 400
  // (Phase 12 起 apiType 字段在新 shape 已不入库,但 PUT body 仍接受以保持向后兼容校验)
  // 顺序:apiType 校验先于 provider,跟 Phase 5 历史顺序保持一致(避免破老测试断言)。
  const rawApiType = body.apiType?.trim()
  if (rawApiType && !SUPPORTED_API_TYPES.includes(rawApiType as LlmApiType)) {
    return c.json({ error: `不支持的 apiType:${rawApiType}` }, 400)
  }

  const providerRaw = body.provider?.trim() || 'zhipu'
  const providerCheck = ActiveProviderIdSchema.safeParse(providerRaw)
  if (!providerCheck.success) {
    return c.json({ error: `不支持的 provider:${providerRaw}` }, 400)
  }
  const provider: ActiveProviderId = providerCheck.data

  const model = body.model?.trim() || undefined
  const baseUrl = body.baseUrl?.trim() || undefined

  // Phase 12 Task F:把入参的老 shape 经 migrateLegacySettings 转成新 shape 入库,
  // 这样 DB 永远是新 shape,下游 LLM 路由 + MCP 跑 getActiveProviderConfig 直接命中
  // 新 shape 分支。
  const nextSettings = migrateLegacySettings({ provider, apiKey, baseUrl, model })
  const encrypted = encryptApiKey(JSON.stringify(nextSettings))

  const db = getDb()
  await db.update(users).set({ llmSettings: encrypted }).where(eq(users.id, user.id))

  return c.json({ ok: true })
})
