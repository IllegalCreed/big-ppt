import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { auth } from '../src/routes/auth.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import {
  __setMasterKeyGetterForTesting,
  decryptApiKey,
  encryptApiKey,
} from '../src/crypto/apikey.js'
import { getDb, users } from '../src/db/index.js'
import { eq } from 'drizzle-orm'

const FIXED_KEY = Buffer.alloc(32, 0xab)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  __setMasterKeyGetterForTesting(null)
})

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api/auth', auth)
  return app
}

async function postJson(app: Hono, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('routes/auth', () => {
  it('register: 非法 JSON body → 走 catch 回退到 {} → 400（邮箱空）', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid-json',
    })
    expect(res.status).toBe(400)
  })

  it('logout: 未登录（无 session）也返回 200，仅清 cookie', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/logout', {})
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/lumideck_session=/)
  })

  it('register: 邮箱格式非法 → 400', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/register', {
      email: 'not-an-email',
      password: 'pw123456',
    })
    expect(res.status).toBe(400)
  })

  it('register: 密码 < 6 位 → 400', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/register', { email: 'a@a.com', password: 'abc' })
    expect(res.status).toBe(400)
  })

  it('register: 邮箱重复 → 409', async () => {
    const app = makeApp()
    await postJson(app, '/api/auth/register', { email: 'dup@a.com', password: 'pw123456' })
    const res = await postJson(app, '/api/auth/register', {
      email: 'dup@a.com',
      password: 'pw123456',
    })
    expect(res.status).toBe(409)
  })

  it('register: 成功 → 201 + Set-Cookie', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/register', {
      email: 'new@a.com',
      password: 'pw123456',
    })
    expect(res.status).toBe(201)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('lumideck_session=')
    expect(setCookie).toContain('HttpOnly')
  })

  it('login: 字段为空 → 400', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/login', { email: '', password: '' })
    expect(res.status).toBe(400)
  })

  it('login: 密码错误 → 401', async () => {
    const app = makeApp()
    await postJson(app, '/api/auth/register', { email: 'login@a.com', password: 'pw123456' })
    const res = await postJson(app, '/api/auth/login', { email: 'login@a.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('login: 成功 → 200 + Set-Cookie', async () => {
    const app = makeApp()
    await postJson(app, '/api/auth/register', { email: 'login2@a.com', password: 'pw123456' })
    const res = await postJson(app, '/api/auth/login', {
      email: 'login2@a.com',
      password: 'pw123456',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('lumideck_session=')
  })

  it('logout: 带 cookie → 删 DB session + Set-Cookie 过期', async () => {
    const app = makeApp()
    const { cookie, sid } = await createLoggedInUser('logout@a.com')
    const res = await postJson(app, '/api/auth/logout', {}, cookie)
    expect(res.status).toBe(200)
    // Cookie 被清（Expires 是 Epoch）
    expect(res.headers.get('set-cookie')).toMatch(/Expires=Thu, 01 Jan 1970/i)
    // DB 里 session 被删
    const db = getDb()
    const { sessions } = await import('../src/db/index.js')
    const rows = await db.select().from(sessions).where(eq(sessions.id, sid))
    expect(rows.length).toBe(0)
  })

  it('me: 无 cookie → 401；有 cookie → 200 + 返 sanitized user', async () => {
    const app = makeApp()
    const unauth = await app.request('/api/auth/me')
    expect(unauth.status).toBe(401)

    const { cookie, user } = await createLoggedInUser('me@a.com')
    const res = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.user).toMatchObject({ id: user.id, email: 'me@a.com', hasLlmSettings: false })
  })

  it('llm-settings PUT: 首次必须给 apiKey，成功加密后 decrypt 能恢复原值', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm@a.com')

    // 空 apiKey 应拒绝
    const empty = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'zhipu', apiKey: '' }),
    })
    expect(empty.status).toBe(400)

    // 合法 apiKey
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'sk-real-key', model: 'GLM-5.1' }),
    })
    expect(res.status).toBe(200)

    // 直接从 DB 读密文并 decrypt:Phase 12 Task F 起入库是新 shape
    // {activeProvider, providers: { [id]: { apiKey, model?, baseUrl? } }}
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(u?.llmSettings).toBeTruthy()
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    expect(decrypted).toEqual({
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'sk-real-key', model: 'GLM-5.1' } },
    })
  })

  it('llm-settings PUT: 空 apiKey + 无旧值 → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-empty@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'openai', apiKey: '', model: 'gpt-4o' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'apiKey 为空' })
  })

  it('llm-settings PUT: 空 apiKey + 已有旧值 → 200 + 保留旧 apiKey 只换 provider/model', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-keep@a.com')
    // 先存一组
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'key-original', model: 'GLM-5.1' }),
    })
    // 第二次空 apiKey，期望复用旧 apiKey + 新 provider/model
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'openai', apiKey: '', model: 'gpt-4o' }),
    })
    expect(res.status).toBe(200)

    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    // Task F 起入库新 shape;复用旧 apiKey + 新 provider/model 后只有 openai entry
    expect(decrypted).toEqual({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'key-original', model: 'gpt-4o' } },
    })
  })

  it('llm-settings PUT: 旧 shape 密文迁移，并忽略未配置的非活跃 provider', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-legacy-migrate@a.com')
    const db = getDb()
    await db
      .update(users)
      .set({
        llmSettings: encryptApiKey(
          JSON.stringify({
            provider: 'openai',
            apiKey: 'legacy-key',
            model: 'gpt-4o',
          }),
        ),
      })
      .where(eq(users.id, user.id))

    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: '', model: 'gpt-5.5' },
          anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
        },
      }),
    })

    expect(res.status).toBe(200)
    const [storedUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(JSON.parse(decryptApiKey(storedUser!.llmSettings!))).toEqual({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'legacy-key', model: 'gpt-5.5' } },
    })
  })

  it('llm-settings PUT: 旧 llm_settings 是畸形密文 → 500', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-corrupt@a.com')
    // 直接写一个非法密文进 DB
    const db = getDb()
    await db.update(users).set({ llmSettings: 'not-a-v1-ciphertext' }).where(eq(users.id, user.id))
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'openai', apiKey: '' }),
    })
    expect(res.status).toBe(500)
    // Phase 9-E：errorResponse dev 模式返完整 message + errorId，prod 仅 generic
    const body = (await res.json()) as { error: string; errorId: string }
    expect(body.errorId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('llm-settings GET: 未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/llm-settings')
    expect(res.status).toBe(401)
  })

  it('llm-settings GET: 无设置 → hasApiKey=false + providers={}', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-get-empty@a.com')
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    // Phase 12 Task J:GET 返回新 shape(activeProvider + providers)+ 老消费者兼容字段。
    // apiKey 永远不回传(只暴露 hasApiKey 布尔)。
    expect(await res.json()).toEqual({
      activeProvider: null,
      providers: {},
      provider: null,
      model: null,
      baseUrl: null,
      apiType: null,
      hasApiKey: false,
    })
  })

  it('llm-settings GET: 有设置 → 返回新 shape + 老消费者兼容字段,不泄漏 apiKey', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-get@a.com')
    // 用老 shape PUT,验证 GET 输出新 shape(兼容期 backend 双向 bridge)
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-TOP-SECRET',
        model: 'gpt-5.5',
        baseUrl: 'https://example.com/v1',
        apiType: 'openai-compatible',
      }),
    })
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    const body = await res.json()
    expect(body).toEqual({
      activeProvider: 'openai',
      providers: {
        openai: {
          hasApiKey: true,
          model: 'gpt-5.5',
          baseUrl: 'https://example.com/v1',
        },
      },
      // 老消费者兼容字段
      provider: 'openai',
      model: 'gpt-5.5',
      baseUrl: 'https://example.com/v1',
      apiType: 'openai-compatible',
      hasApiKey: true,
    })
    expect(JSON.stringify(body)).not.toContain('sk-TOP-SECRET')
  })

  it('llm-settings PUT: 不传 apiType → 入库不带 apiType 字段(新 shape 已废弃 apiType)', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-default-apitype@a.com')
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'sk-x', model: 'GLM-5.1' }),
    })
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    // Task F+:新 shape 不入库 apiType。GET 路由始终返常量 'openai-compatible'。
    expect(decrypted).not.toHaveProperty('apiType')
    expect(decrypted).toMatchObject({
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'sk-x', model: 'GLM-5.1' } },
    })
  })

  it('llm-settings PUT: 不支持的 apiType → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-bad-apitype@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-x',
        baseUrl: 'https://example.com/v1',
        apiType: 'anthropic-native',
      }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('不支持的 apiType') })
  })

  it('llm-settings PUT: 不支持的 provider(白名单外)→ 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-bad-provider@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'custom', apiKey: 'sk-x' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('不支持的 provider') })
  })

  it('llm-settings PUT: 拒绝内网 baseUrl', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-local-base-url@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-x',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('内网') })
  })

  it('llm-settings PUT: 接受老 shape body → 入库新 shape;同次 GET 返回新 shape + 老兼容字段', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-shape-bridge@a.com')
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-1', model: 'claude-4' }),
    })

    // DB:新 shape
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    expect(decrypted).toEqual({
      activeProvider: 'anthropic',
      providers: { anthropic: { apiKey: 'sk-ant-1', model: 'claude-4' } },
    })

    // GET 返回新 shape JSON
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    const body = await res.json()
    expect(body).toEqual({
      activeProvider: 'anthropic',
      providers: {
        anthropic: { hasApiKey: true, model: 'claude-4' },
      },
      provider: 'anthropic',
      model: 'claude-4',
      baseUrl: null,
      apiType: 'openai-compatible',
      hasApiKey: true,
    })
  })

  it('llm-settings GET: DB 已是新 shape → 返新 shape + 老兼容字段', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-new-shape-db@a.com')
    // 直接绕过 PUT,DB 写入新 shape(模拟 migration 跑过后的状态)
    const db = getDb()
    const newShape = JSON.stringify({
      activeProvider: 'gemini',
      providers: { gemini: { apiKey: 'gem-1', model: 'gemini-2.5', baseUrl: 'https://x.com/v1' } },
    })
    await db
      .update(users)
      .set({ llmSettings: encryptApiKey(newShape) })
      .where(eq(users.id, user.id))

    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    const body = await res.json()
    expect(body).toEqual({
      activeProvider: 'gemini',
      providers: {
        gemini: { hasApiKey: true, model: 'gemini-2.5', baseUrl: 'https://x.com/v1' },
      },
      provider: 'gemini',
      model: 'gemini-2.5',
      baseUrl: 'https://x.com/v1',
      apiType: 'openai-compatible',
      hasApiKey: true,
    })
  })

  it('llm-settings GET: 密文损坏 → 500', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-get-corrupt@a.com')
    const db = getDb()
    await db.update(users).set({ llmSettings: 'garbage' }).where(eq(users.id, user.id))
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; errorId: string }
    expect(body.errorId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('llm-settings GET（经 me）: hasLlmSettings 反映 DB 状态', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm3@a.com')

    const before = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect((await before.json()).user.hasLlmSettings).toBe(false)

    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ provider: 'zhipu', apiKey: 'sk-1' }),
    })

    const after = await app.request('/api/auth/me', { headers: { Cookie: cookie } })
    expect((await after.json()).user.hasLlmSettings).toBe(true)
  })

  // === Phase 12 Task J:PUT 接受新 shape body 测试 ===

  it('llm-settings PUT: 新 shape body → 直接入库 + GET 回显', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-new-shape-put@a.com')

    const newShape = {
      activeProvider: 'anthropic',
      providers: {
        openai: { apiKey: 'sk-openai-1', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
        anthropic: { apiKey: 'sk-ant-1', model: 'claude-sonnet-4-6' },
      },
      advanced: {
        anthropic: { promptCaching: true, thinkingLevel: 'high', thinkingBudgetTokens: 5000 },
        common: { temperature: 0.7 },
      },
    }
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify(newShape),
    })
    expect(res.status).toBe(200)

    // DB:原样入库新 shape
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    expect(decrypted).toEqual(newShape)

    // GET 回显新 shape view(apiKey 脱敏成 hasApiKey 布尔)
    const getRes = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    const getBody = await getRes.json()
    expect(getBody.activeProvider).toBe('anthropic')
    expect(getBody.providers.openai).toEqual({
      hasApiKey: true,
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    })
    expect(getBody.providers.anthropic).toEqual({
      hasApiKey: true,
      model: 'claude-sonnet-4-6',
    })
    expect(getBody.advanced).toEqual(newShape.advanced)
    expect(JSON.stringify(getBody)).not.toContain('sk-openai-1')
    expect(JSON.stringify(getBody)).not.toContain('sk-ant-1')
  })

  it('llm-settings PUT: 新 shape body 缺 active provider 配置 → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-new-shape-no-active@a.com')

    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'gemini',
        providers: {
          openai: { apiKey: 'sk-openai-1', model: 'gpt-4o' },
          // 没配 gemini 的 key
        },
      }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('gemini')
  })

  it('llm-settings PUT: 新 shape body 含未知 provider id → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-new-shape-bad-id@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: 'sk-1' },
          cohere: { apiKey: 'sk-2' }, // 不在白名单（Phase 12.5 后 mistral 已在白名单，换用 cohere）
        },
      }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('cohere')
  })

  it('llm-settings PUT: 新 shape body activeProvider 不在白名单 → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-new-shape-bad-active@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'unknown',
        providers: { openai: { apiKey: 'sk-1' } },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('llm-settings PUT: 新 shape body 留空 apiKey + 旧密文里有该 provider key → 复用旧 key', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-new-shape-keep@a.com')

    // 先存一份
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: 'sk-original', model: 'gpt-4o' },
        },
      }),
    })

    // 再发一次:openai 留空 apiKey,只换 model;同时加 anthropic
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: {
          openai: { apiKey: '', model: 'gpt-5.5' },
          anthropic: { apiKey: 'sk-ant-fresh', model: 'claude-4' },
        },
      }),
    })
    expect(res.status).toBe(200)

    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    // openai apiKey 复用旧值,model 换新;anthropic 新增
    expect(decrypted.providers.openai).toEqual({ apiKey: 'sk-original', model: 'gpt-5.5' })
    expect(decrypted.providers.anthropic).toEqual({ apiKey: 'sk-ant-fresh', model: 'claude-4' })
  })

  it('llm-settings PUT: 新 shape advanced 参数越界 → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-new-shape-bad-adv@a.com')
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: { openai: { apiKey: 'sk-1' } },
        advanced: { common: { temperature: 5.0 } }, // temperature 范围 [0, 2]
      }),
    })
    expect(res.status).toBe(400)
  })

  // === Phase 12 Task J code-review fix:跨 provider 切换 advanced 不丢失 ===

  it('PUT new shape 跨 provider 切换不丢失另一 provider 的 advanced 配置', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-advanced-cross-provider@a.com')

    // 1. active=anthropic + advanced.anthropic.promptCaching=true + advanced.common.temperature=0.7
    const res1 = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'anthropic',
        providers: {
          anthropic: { apiKey: 'sk-ant-1', model: 'claude-sonnet-4-6' },
          openai: { apiKey: 'sk-openai-1', model: 'gpt-4o' },
        },
        advanced: {
          anthropic: { promptCaching: true, thinkingLevel: 'high', thinkingBudgetTokens: 5000 },
          common: { temperature: 0.7 },
        },
      }),
    })
    expect(res1.status).toBe(200)

    // 2. 切 active=openai 保存 —— 模拟 UI 实际行为:body.advanced 只含 common(active=openai 时
    //    UI 的 buildPayload 不发 anthropic 子区,因为它属于另一 provider 视角)
    const res2 = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: {
          anthropic: { apiKey: '', model: 'claude-sonnet-4-6' }, // 留空保留旧 apiKey
          openai: { apiKey: '', model: 'gpt-4o' }, // 留空保留旧 apiKey
        },
        advanced: {
          common: { temperature: 0.9 }, // 用户改 temperature
        },
      }),
    })
    expect(res2.status).toBe(200)

    // 3. SELECT users → 解密 → 验 anthropic advanced 仍在(没被 partial body 覆盖丢失)
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    expect(decrypted.activeProvider).toBe('openai')
    // anthropic 子区原样保留(没在 res2 body 里发,但 merge 从 oldSettings 拿)
    expect(decrypted.advanced.anthropic).toEqual({
      promptCaching: true,
      thinkingLevel: 'high',
      thinkingBudgetTokens: 5000,
    })
    // common 走最新值(0.9 覆盖 0.7)
    expect(decrypted.advanced.common).toEqual({ temperature: 0.9 })
    // providers 也都在(留空 apiKey 复用语义触发)
    expect(decrypted.providers.anthropic.apiKey).toBe('sk-ant-1')
    expect(decrypted.providers.openai.apiKey).toBe('sk-openai-1')
  })

  it('PUT new shape body 无 advanced 字段 → 完整保留旧 advanced', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-advanced-keep-untouched@a.com')

    // 先存:gemini 配置 + advanced.gemini.jsonMode=true + advanced.common.maxTokens=2048
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: 'gem-1' } },
        advanced: {
          gemini: { jsonMode: true, longContextStrategy: 'segment' },
          common: { maxTokens: 2048 },
        },
      }),
    })

    // 第二次 PUT 完全不发 advanced 字段(UI 没展开 advanced 时的常见 case)
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: '', model: 'gemini-2.5-flash' } },
        // 故意不发 advanced
      }),
    })
    expect(res.status).toBe(200)

    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    // advanced 完整保留
    expect(decrypted.advanced).toEqual({
      gemini: { jsonMode: true, longContextStrategy: 'segment' },
      common: { maxTokens: 2048 },
    })
  })

  it('PUT new shape advanced 单子区内字段粒度 merge:partial common 不覆盖旧 common 其它字段', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-advanced-subfield-merge@a.com')

    // 先存:common.temperature=0.5 + common.maxTokens=4096
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: { openai: { apiKey: 'sk-1' } },
        advanced: { common: { temperature: 0.5, maxTokens: 4096 } },
      }),
    })

    // 只改 temperature(常见 UI 操作:slider 一拉,maxTokens 没改)
    const res = await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeProvider: 'openai',
        providers: { openai: { apiKey: '' } },
        advanced: { common: { temperature: 1.5 } },
      }),
    })
    expect(res.status).toBe(200)

    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    // temperature 覆盖,maxTokens 保留
    expect(decrypted.advanced.common).toEqual({ temperature: 1.5, maxTokens: 4096 })
  })
})
