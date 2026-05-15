/**
 * Phase 12.5 Task D：`GET /api/llm/models` 集成测。
 *
 * 直接走 pi-ai 真实 `getModels()` 内置 MODELS 表（编译进 SDK，单测不需 mock）。
 * 测点：
 * - 未登录 → 401
 * - 未知 provider id → 400
 * - happy path：openai 返非空 list，含 `id`/`name` 字段
 * - id 翻译：`gemini` 入参 → pi-ai `google` key → 列表里至少一条 `id` 含 `gemini`
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { useTestDb } from '../_setup/test-db.js'
import { createLoggedInUser } from '../_setup/factories.js'
import { llmModels } from '../../src/routes/llm-models.js'
import { authOptional, type AuthVars } from '../../src/middleware/auth.js'

useTestDb()

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  // mount path 必须与 prod app.ts 一致(`app.route('/api/llm/models', llmModels)`)
  app.route('/api/llm/models', llmModels)
  return app
}

describe('GET /api/llm/models', () => {
  it('未登录 → 401', async () => {
    const res = await buildApp().fetch(
      new Request('http://x/api/llm/models?provider=openai'),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('unauthorized')
  })

  it('未知 provider → 400', async () => {
    const { cookie } = await createLoggedInUser('unknown-prov@a.com')
    const res = await buildApp().fetch(
      new Request('http://x/api/llm/models?provider=unknown-foo', {
        headers: { Cookie: cookie },
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('unknown-foo')
  })

  it('openai → 返非空 model list（含 id + name 字段）', async () => {
    const { cookie } = await createLoggedInUser('openai-list@a.com')
    const res = await buildApp().fetch(
      new Request('http://x/api/llm/models?provider=openai', {
        headers: { Cookie: cookie },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string; name: string }> }
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.models[0]).toHaveProperty('id')
    expect(body.models[0]).toHaveProperty('name')
    expect(typeof body.models[0]!.id).toBe('string')
  })

  it('id 翻译：gemini → pi-ai google → 列表里含 gemini-* model', async () => {
    const { cookie } = await createLoggedInUser('gemini-trans@a.com')
    const res = await buildApp().fetch(
      new Request('http://x/api/llm/models?provider=gemini', {
        headers: { Cookie: cookie },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string; name: string }> }
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.models.some((m) => m.id.toLowerCase().includes('gemini'))).toBe(true)
  })
})
