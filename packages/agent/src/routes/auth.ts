/**
 * Auth routes: register / login / logout / me / llm-settings
 */
import { Hono, type Context } from 'hono'
import bcrypt from 'bcrypt'
import * as cookie from 'cookie'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb, users, sessions } from '../db/index.js'
import { SESSION_COOKIE, SESSION_TTL_MS, type AuthVars } from '../middleware/auth.js'
import { encryptApiKey, decryptApiKey } from '../crypto/apikey.js'
import { createRateLimit } from '../middleware/rate-limit.js'
import { errorResponse } from '../utils/error-response.js'
import { validatePublicHttpUrl } from '../utils/url-safety.js'
import {
  ActiveProviderIdSchema,
  getActiveProviderConfig,
  LlmSettingsSchema,
  migrateLegacySettings,
  normalizeThinkingFields,
  type ActiveProviderId,
  type LlmSettings,
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
type LegacyLlmSettingsBody = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  apiType?: string
}
/**
 * Phase 12 Task J:PUT body 接受两种 shape:
 * - **新 shape**(主路径,UI 升级后):`{activeProvider, providers, advanced?}`,直接 zod parse + 加密入库
 * - **老 shape**(兼容期 fallback):`{provider, apiKey, baseUrl?, model?, apiType?}`,
 *   走 `migrateLegacySettings` → 加密入库(Task F 已实现的兼容路径继续工作)。
 *
 * 判别:body 含 `activeProvider` 字段(string)+ `providers` 字段(object)→ 新 shape;否则老 shape。
 */
type NewLlmSettingsBody = {
  activeProvider?: string
  providers?: Record<string, unknown>
  advanced?: unknown
}
type LlmSettingsBody = LegacyLlmSettingsBody & NewLlmSettingsBody

/** PUT 入参辨别:含 activeProvider 字段判定为新 shape。 */
function isNewShapeBody(body: LlmSettingsBody): boolean {
  return typeof body.activeProvider === 'string' && typeof body.providers === 'object' && body.providers !== null
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
  const u = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]
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
 * GET /api/auth/llm-settings:Phase 12 Task J 起返回新 shape 给前端 Settings UI 用。
 *
 * 返回 shape:
 *   {
 *     activeProvider: string | null,
 *     providers: { [id]: { hasApiKey: boolean, model?: string, baseUrl?: string } },
 *     advanced?: {...},
 *     // 兼容老消费者(MCPCatalogItem + useAIChat.loadSettingsOnce):
 *     provider: string | null,        // alias of activeProvider
 *     model: string | null,           // active provider 的 model
 *     baseUrl: string | null,         // active provider 的 baseUrl
 *     apiType: 'openai-compatible',   // 兼容字段(已废弃)
 *     hasApiKey: boolean,             // active provider 是否配 key
 *   }
 *
 * **apiKey 永远不回传**(安全)。前端用 `providers[id].hasApiKey` 显示「已配置 / 未配置」徽章,
 * 用户重新填 key 才覆盖。
 *
 * Why "新 shape + 老 shape 字段共存":Task J 后 Settings UI 改成读 `activeProvider`/`providers`,
 * 但 MCPCatalogItem 还用 `provider/model/hasApiKey`,useAIChat 还用 `provider/model/baseUrl/hasApiKey`,
 * 这些消费者后续 Task 才会迁;混合返回让一次升级不破多个组件。
 *
 * DB shape 兼容:
 * - 新 shape 入库 → 直接读 `activeProvider` + `providers`
 * - 老 shape 入库(migration 没跑全)→ `getActiveProviderConfig` 归一化,生成单 entry `providers`
 *
 * 失败语义:解密 / parse 失败 → 500 errorResponse(脱敏)。
 */
auth.get('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.llmSettings) {
    return c.json({
      activeProvider: null,
      providers: {},
      advanced: undefined,
      // 老消费者兼容
      provider: null,
      model: null,
      baseUrl: null,
      apiType: null,
      hasApiKey: false,
    })
  }
  // 先尝试 parse 成完整新 shape;失败再回落到 getActiveProviderConfig 兼容读法
  let raw: unknown
  try {
    raw = JSON.parse(decryptApiKey(user.llmSettings))
  } catch (e) {
    return errorResponse(c, e as Error, {
      publicMessage: 'LLM 配置读取失败',
    })
  }

  const newShape = LlmSettingsSchema.safeParse(normalizeThinkingFields(raw))
  if (newShape.success) {
    const s = newShape.data
    // 把每个 provider entry 转 hasApiKey 视图(永远不回传 apiKey)
    const providersView: Record<string, { hasApiKey: boolean; model?: string; baseUrl?: string }> = {}
    for (const [id, cfg] of Object.entries(s.providers)) {
      if (!cfg) continue
      providersView[id] = {
        hasApiKey: !!cfg.apiKey,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        ...(cfg.baseUrl !== undefined ? { baseUrl: cfg.baseUrl } : {}),
      }
    }
    const active = s.providers[s.activeProvider]
    return c.json({
      activeProvider: s.activeProvider,
      providers: providersView,
      ...(s.advanced ? { advanced: s.advanced } : {}),
      // 老消费者兼容
      provider: s.activeProvider,
      model: active?.model ?? null,
      baseUrl: active?.baseUrl ?? null,
      apiType: 'openai-compatible',
      hasApiKey: !!active?.apiKey,
    })
  }

  // 老 shape 兜底:用 getActiveProviderConfig 归一化,生成单 entry providers view
  const cfg = getActiveProviderConfig(user.llmSettings)
  if (!cfg) {
    return errorResponse(c, new Error('llm_settings 解密或 parse 失败'), {
      publicMessage: 'LLM 配置读取失败',
    })
  }
  const providersView: Record<string, { hasApiKey: boolean; model?: string; baseUrl?: string }> = {
    [cfg.provider]: {
      hasApiKey: !!cfg.apiKey,
      ...(cfg.model !== undefined ? { model: cfg.model } : {}),
      ...(cfg.baseUrl !== undefined ? { baseUrl: cfg.baseUrl } : {}),
    },
  }
  return c.json({
    activeProvider: cfg.provider,
    providers: providersView,
    // 老消费者兼容
    provider: cfg.provider,
    model: cfg.model ?? null,
    baseUrl: cfg.baseUrl ?? null,
    apiType: 'openai-compatible',
    hasApiKey: !!cfg.apiKey,
  })
})

/**
 * PUT /api/auth/llm-settings:Phase 12 Task J 起接受**新 shape**(主路径)+ 兼容老 shape。
 *
 * 新 shape body:
 *   {
 *     activeProvider: 'openai' | 'anthropic' | 'gemini' | 'zhipu' | 'deepseek' | 'moonshot' | 'qwen',
 *     providers: {
 *       [id]: { apiKey: string, model?: string, baseUrl?: string }
 *     },
 *     advanced?: { common?: {...}, anthropic?: {...}, gemini?: {...} }
 *   }
 *
 * 老 shape body(兼容期,Task L 部署后清理):
 *   { provider, apiKey, baseUrl?, model?, apiType? }
 *
 * **apiKey "留空保留旧值"语义**:
 * - 新 shape:某 provider entry 传 `apiKey: ''` 且已有旧密文 → 从旧密文里抽该 provider 的 apiKey
 *   合并(只更新 model / baseUrl);若该 provider 旧密文里没记录 → 400
 *   入库不允许 `apiKey: ''` 的 entry(zod 报 min(1) 失败),所以空 key entry **在合并阶段必须解决**。
 * - 老 shape:同 Task F 行为,空 apiKey + 已有旧值 → 复用旧 apiKey;空 apiKey + 无旧值 → 400
 *
 * Why "新 shape 不强制每个 provider 都有 apiKey":用户在 UI 可以先填 OpenAI 把 key 存上,
 * 之后想加 Anthropic 时来回切配;UI 保证 active provider 必有 key,其它 provider 留空属
 * "未配置" —— 不向 backend 发空 entry,backend 收到时把"空 apiKey 的 provider entry"原样剔除。
 */
auth.put('/llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json<LlmSettingsBody>().catch((): LlmSettingsBody => ({}))

  // 加载旧密文(若有),用于「留空保留旧 apiKey」合并语义
  let oldSettings: LlmSettings | null = null
  if (user.llmSettings) {
    try {
      const oldRaw = JSON.parse(decryptApiKey(user.llmSettings))
      const oldParsed = LlmSettingsSchema.safeParse(normalizeThinkingFields(oldRaw))
      if (oldParsed.success) {
        oldSettings = oldParsed.data
      } else {
        // 老 shape 兼容:经 getActiveProviderConfig 抽出来构造单 entry 旧 settings
        const legacy = getActiveProviderConfig(user.llmSettings)
        if (legacy) {
          oldSettings = migrateLegacySettings({
            provider: legacy.provider,
            apiKey: legacy.apiKey,
            ...(legacy.baseUrl !== undefined ? { baseUrl: legacy.baseUrl } : {}),
            ...(legacy.model !== undefined ? { model: legacy.model } : {}),
          })
        }
      }
    } catch (e) {
      return errorResponse(c, e as Error, {
        publicMessage: '旧 LLM 配置读取失败',
      })
    }
  }

  if (isNewShapeBody(body)) {
    return saveNewShape(c, user, body, oldSettings)
  }
  return saveLegacyShape(c, user, body, oldSettings)
})

type AuthContext = Context<{ Variables: AuthVars }>
type AuthUser = NonNullable<AuthVars['user']>

async function saveNewShape(
  c: AuthContext,
  user: AuthUser,
  body: LlmSettingsBody,
  oldSettings: LlmSettings | null,
) {
  // 用 zod 在 merge 之前预校验 activeProvider 白名单(给出友好的中文错误)
  const activeCheck = ActiveProviderIdSchema.safeParse(body.activeProvider)
  if (!activeCheck.success) {
    return c.json({ error: `不支持的 provider:${String(body.activeProvider)}` }, 400)
  }
  const activeProvider = activeCheck.data

  // 合并 providers:对每个 entry,如果 apiKey 为空且旧密文里有该 provider 的 key 则复用
  const incomingProviders = (body.providers ?? {}) as Record<
    string,
    { apiKey?: string; model?: string; baseUrl?: string } | undefined
  >
  const merged: Record<string, { apiKey: string; model?: string; baseUrl?: string }> = {}
  for (const [pid, entry] of Object.entries(incomingProviders)) {
    if (!entry || typeof entry !== 'object') continue
    const idCheck = ActiveProviderIdSchema.safeParse(pid)
    if (!idCheck.success) {
      return c.json({ error: `不支持的 provider:${pid}` }, 400)
    }
    const incomingKey = (entry.apiKey ?? '').trim()
    const oldKey = oldSettings?.providers[idCheck.data]?.apiKey ?? ''
    const resolvedKey = incomingKey || oldKey
    if (!resolvedKey) {
      // 空 apiKey + 旧密文里也没记录 → 视为"未配置"剔除该 entry,而非报错(便于 UI 一次性发整张表)
      continue
    }
    const item: { apiKey: string; model?: string; baseUrl?: string } = { apiKey: resolvedKey }
    if (entry.model !== undefined) item.model = entry.model.trim() || undefined
    if (entry.baseUrl !== undefined) {
      const baseUrl = entry.baseUrl.trim()
      if (baseUrl) {
        const urlCheck = await validatePublicHttpUrl(baseUrl, { label: `${idCheck.data} baseUrl` })
        if (!urlCheck.ok) return c.json({ error: urlCheck.error }, 400)
        item.baseUrl = urlCheck.url
      }
    }
    merged[idCheck.data] = item
  }

  // 校验 active provider 在 merged 里有 entry(否则没办法发 LLM 请求)
  if (!merged[activeProvider]) {
    return c.json({ error: `active provider "${activeProvider}" 未配置 apiKey` }, 400)
  }

  // **跨 provider 切换 advanced 不丢失**(Code review fix):body.advanced 是 active provider
  // 视角的 partial 视图(active=openai 时 UI 不发 anthropic / gemini 专有子区),
  // 直接覆盖 oldSettings.advanced 会让另一 provider 之前调好的 promptCaching /
  // thinkingLevel 等配置静默丢失。改成「子区粒度 merge 旧+新」,再 prune 全空子区
  // 防 `{anthropic: undefined}` 触发 zod typed-shape 不匹配。
  //
  // Phase 12.7 Task E:body 可能来自老 UI 传 thinkingEnabled(boolean),先经
  // normalizeThinkingFields 转 thinkingLevel(enum)再 merge,避免老 UI 升级前
  // 提交触发 zod 报错。
  const normalizedBody = normalizeThinkingFields(body) as LlmSettingsBody
  const incomingAdvanced =
    normalizedBody.advanced && typeof normalizedBody.advanced === 'object'
      ? (normalizedBody.advanced as LlmSettings['advanced'])
      : undefined
  const mergedAdvanced = mergeAdvanced(oldSettings?.advanced, incomingAdvanced)

  const candidate: LlmSettings = {
    activeProvider,
    providers: merged as LlmSettings['providers'],
    ...(mergedAdvanced ? { advanced: mergedAdvanced } : {}),
  }

  // 最终 zod 校验:advanced 子区数值范围 + provider entry baseUrl URL 合法性等
  const finalCheck = LlmSettingsSchema.safeParse(candidate)
  if (!finalCheck.success) {
    return c.json({ error: `LLM 配置参数非法:${finalCheck.error.issues[0]?.message ?? ''}` }, 400)
  }

  const encrypted = encryptApiKey(JSON.stringify(finalCheck.data))
  const db = getDb()
  await db.update(users).set({ llmSettings: encrypted }).where(eq(users.id, user.id))
  return c.json({ ok: true })
}

/**
 * 合并新旧 `advanced`:子区粒度逐字段覆盖,prune 全空子区。
 *
 * 设计:
 * - **sub-block 粒度合并**:不直接 `{...old, ...new}` 顶层 spread —— 那样会让
 *   `new.common` 整个子对象覆盖 `old.common`(若 UI 只发 partial common 也会丢)。
 *   改成 common / anthropic / gemini 三个子区各自 spread 旧+新。
 * - **prune 语义**:UI 取消勾选(如 promptCaching: false)时,代码上层把该字段
 *   从 payload 里直接拿掉(只发 truthy 字段);因此 backend merge 默认是「相加」不「相减」,
 *   要清字段需 UI 显式发 `{promptCaching: false}` 或 `null`。Phase 12 Task J 起 UI 不
 *   发 false(buildPayload 跳过 falsy),所以 backend 不主动删字段,与 UI 行为一致。
 * - **prune 全空子区**:三个子区如果合并后是 `{}`(没任何字段),整个删掉。否则
 *   zod 看到 `{anthropic: {}}` 会通过但语义噪声;删掉更干净。
 * - 全空 advanced(三个子区都没字段)→ 返 undefined,让 caller `if (mergedAdvanced)` 跳过 advanced。
 *
 * 入参 `old` / `incoming` 任一可为 undefined。
 */
function mergeAdvanced(
  old: LlmSettings['advanced'],
  incoming: LlmSettings['advanced'],
): LlmSettings['advanced'] {
  if (!old && !incoming) return undefined

  const common = { ...(old?.common ?? {}), ...(incoming?.common ?? {}) }
  const anthropic = { ...(old?.anthropic ?? {}), ...(incoming?.anthropic ?? {}) }
  const gemini = { ...(old?.gemini ?? {}), ...(incoming?.gemini ?? {}) }

  const result: NonNullable<LlmSettings['advanced']> = {}
  if (Object.keys(common).length > 0) result.common = common
  if (Object.keys(anthropic).length > 0) result.anthropic = anthropic
  if (Object.keys(gemini).length > 0) result.gemini = gemini

  return Object.keys(result).length > 0 ? result : undefined
}

async function saveLegacyShape(
  c: AuthContext,
  user: AuthUser,
  body: LlmSettingsBody,
  oldSettings: LlmSettings | null,
) {
  // 若未给 apiKey:要求已存在旧值,保留旧 apiKey 只更新其他字段
  let apiKey = body.apiKey?.trim() ?? ''
  if (!apiKey) {
    if (!oldSettings) return c.json({ error: 'apiKey 为空' }, 400)
    // 老 shape 复用旧 apiKey:用 getActiveProviderConfig 走 active provider 的 key
    const prev = user.llmSettings ? getActiveProviderConfig(user.llmSettings) : null
    if (!prev) {
      return errorResponse(c, new Error('旧 llm_settings 解密或 parse 失败'), {
        publicMessage: '旧 LLM 配置读取失败',
      })
    }
    apiKey = prev.apiKey
    if (!apiKey) return c.json({ error: 'apiKey 为空' }, 400)
  }

  // apiType 顺序:跟 Phase 5 历史保持(先校 apiType 再校 provider),避免破老测试断言。
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
  let baseUrl = body.baseUrl?.trim() || undefined
  if (baseUrl) {
    const urlCheck = await validatePublicHttpUrl(baseUrl, { label: `${provider} baseUrl` })
    if (!urlCheck.ok) return c.json({ error: urlCheck.error }, 400)
    baseUrl = urlCheck.url
  }

  const nextSettings = migrateLegacySettings({ provider, apiKey, baseUrl, model })
  const encrypted = encryptApiKey(JSON.stringify(nextSettings))

  const db = getDb()
  await db.update(users).set({ llmSettings: encrypted }).where(eq(users.id, user.id))

  return c.json({ ok: true })
}
