import { beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { auth } from '../src/routes/auth.js'
import { authOptional, SESSION_COOKIE, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting, decryptApiKey } from '../src/crypto/apikey.js'
import { getDb, users } from '../src/db/index.js'
import { eq } from 'drizzle-orm'

const FIXED_KEY = Buffer.alloc(32, 0xab)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api/auth', auth)
  return app
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null
  const m = setCookie.match(/lumideck_session=([^;]+)/)
  return m ? `${SESSION_COOKIE}=${m[1]}` : null
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
    const res = await postJson(app, '/api/auth/register', { email: 'not-an-email', password: 'pw123456' })
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
    const res = await postJson(app, '/api/auth/register', { email: 'dup@a.com', password: 'pw123456' })
    expect(res.status).toBe(409)
  })

  it('register: 成功 → 201 + Set-Cookie', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/auth/register', { email: 'new@a.com', password: 'pw123456' })
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
    const res = await postJson(app, '/api/auth/login', { email: 'login2@a.com', password: 'pw123456' })
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

    // 直接从 DB 读密文并 decrypt 回原值
    const db = getDb()
    const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(u?.llmSettings).toBeTruthy()
    const decrypted = JSON.parse(decryptApiKey(u!.llmSettings!))
    expect(decrypted).toMatchObject({ provider: 'zhipu', apiKey: 'sk-real-key', model: 'GLM-5.1' })
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
    expect(decrypted).toMatchObject({ provider: 'openai', apiKey: 'key-original', model: 'gpt-4o' })
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
    expect((await res.json()).error).toMatch(/旧配置解密失败/)
  })

  it('llm-settings GET: 未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/auth/llm-settings')
    expect(res.status).toBe(401)
  })

  it('llm-settings GET: 无设置 → hasApiKey=false', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-get-empty@a.com')
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      provider: null,
      model: null,
      baseUrl: null,
      hasApiKey: false,
    })
  })

  it('llm-settings GET: 有设置 → 返回 provider/model/baseUrl + hasApiKey=true，不泄漏 apiKey', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('llm-get@a.com')
    await app.request('/api/auth/llm-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        provider: 'openai',
        apiKey: 'sk-TOP-SECRET',
        model: 'gpt-4o',
        baseUrl: 'https://example.com/v1',
      }),
    })
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    const body = await res.json()
    expect(body).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://example.com/v1',
      hasApiKey: true,
    })
    expect(JSON.stringify(body)).not.toContain('sk-TOP-SECRET')
  })

  it('llm-settings GET: 密文损坏 → 500', async () => {
    const app = makeApp()
    const { cookie, user } = await createLoggedInUser('llm-get-corrupt@a.com')
    const db = getDb()
    await db.update(users).set({ llmSettings: 'garbage' }).where(eq(users.id, user.id))
    const res = await app.request('/api/auth/llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/解密失败/)
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
})
