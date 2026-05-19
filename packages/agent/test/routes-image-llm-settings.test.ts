/**
 * Phase 11.5 Task 0：image-llm-settings 路由集成测。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { imageLlmSettingsRoute } from '../src/routes/image-llm-settings.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting } from '../src/crypto/apikey.js'
import { getDb, users } from '../src/db/index.js'
import { eq } from 'drizzle-orm'
import { decryptApiKey } from '../src/crypto/apikey.js'

const FIXED_KEY = Buffer.alloc(32, 0xef)

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
  app.route('/api', imageLlmSettingsRoute)
  return app
}

async function putJson(app: Hono, body: unknown, cookie?: string) {
  return app.request('/api/image-llm-settings', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('routes/image-llm-settings', () => {
  it('GET：未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/image-llm-settings')
    expect(res.status).toBe(401)
  })

  it('PUT：未登录 → 401', async () => {
    const app = makeApp()
    const res = await putJson(app, { provider: 'openai', apiKey: 'sk-x' })
    expect(res.status).toBe(401)
  })

  it('GET：未配置用户 → hasApiKey=false', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('first@a.com')
    const res = await app.request('/api/image-llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ provider: null, baseUrl: null, model: null, hasApiKey: false })
  })

  it('PUT：首次必须给 apiKey，加密落库后 decrypt 能恢复原值', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('first-put@a.com')

    // 空 apiKey + 无旧值 → 400
    const empty = await putJson(app, { provider: 'openai' }, cookie)
    expect(empty.status).toBe(400)

    const res = await putJson(
      app,
      { provider: 'openai', apiKey: 'sk-image-test-001', baseUrl: 'https://proxy/v1', model: 'gpt-image-2' },
      cookie,
    )
    expect(res.status).toBe(200)

    const [u] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1)
    expect(u?.imageLlmSettings).toBeTruthy()
    const decrypted = JSON.parse(decryptApiKey(u!.imageLlmSettings!))
    expect(decrypted).toEqual({
      provider: 'openai',
      apiKey: 'sk-image-test-001',
      baseUrl: 'https://proxy/v1',
      model: 'gpt-image-2',
    })
  })

  it('PUT：空 apiKey + 已有旧值 → 200,保留旧 apiKey 仅替换 baseUrl/model', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('keep-key@a.com')
    await putJson(
      app,
      { provider: 'openai', apiKey: 'sk-original', model: 'gpt-5.5' },
      cookie,
    )

    const res = await putJson(
      app,
      { provider: 'openai', baseUrl: 'https://new-proxy/v1', model: 'gpt-image-2' },
      cookie,
    )
    expect(res.status).toBe(200)

    const [u] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.imageLlmSettings!))
    expect(decrypted.apiKey).toBe('sk-original')
    expect(decrypted.baseUrl).toBe('https://new-proxy/v1')
    expect(decrypted.model).toBe('gpt-image-2')
  })

  it('PUT：不支持的 provider → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('bad-provider@a.com')
    const res = await putJson(app, { provider: 'midjourney', apiKey: 'mj-x' }, cookie)
    expect(res.status).toBe(400)
  })

  it('GET：有设置 → 返回 provider/baseUrl/model + hasApiKey=true,不泄漏 apiKey', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('view@a.com')
    await putJson(
      app,
      { provider: 'openai', apiKey: 'sk-secret-view', baseUrl: 'https://x/v1', model: 'gpt-5.5' },
      cookie,
    )

    const res = await app.request('/api/image-llm-settings', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      provider: 'openai',
      baseUrl: 'https://x/v1',
      model: 'gpt-5.5',
      hasApiKey: true,
    })
    // 关键:apiKey 字段不应出现在 GET 响应里
    expect(JSON.stringify(json)).not.toContain('sk-secret-view')
  })

  it('PUT：默认 provider=openai(空字符串)且填了 apiKey 也接受', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('default-provider@a.com')
    const res = await putJson(app, { apiKey: 'sk-default' }, cookie)
    expect(res.status).toBe(200)
    const [u] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1)
    const decrypted = JSON.parse(decryptApiKey(u!.imageLlmSettings!))
    expect(decrypted.provider).toBe('openai')
  })
})
