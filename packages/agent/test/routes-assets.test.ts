/**
 * Phase 11.5 Task B：assets serving 路由集成测。
 *
 * 关键覆盖:
 * - 401 未登录
 * - 200 owner 拿到字节 + 正确头
 * - 404 跨用户(不泄露 asset id 是否存在)
 * - 404 不存在
 * - Cache-Control 含 private 防 CDN 缓存
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { assetsRoute } from '../src/routes/assets.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { createAsset } from '../src/db/deck-assets.js'

useTestDb()

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf00000003000100ff0a3a630000000049454e44ae426082',
  'hex',
)

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api', assetsRoute)
  return app
}

describe('routes/assets', () => {
  it('GET /api/assets/:id：未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/assets/some-id')
    expect(res.status).toBe(401)
  })

  it('GET /api/assets/:id：不存在的 id → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('404@a.com')
    const res = await app.request('/api/assets/00000000-0000-0000-0000-000000000000', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('GET /api/assets/:id：owner → 200 + 字节相等 + Content-Type/Length 正确', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ok@a.com')
    const { deck } = await createDeckDirect(user.id)
    const { id } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: TINY_PNG,
    })

    const res = await app.request(`/api/assets/${id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe(String(TINY_PNG.length))
    expect(res.headers.get('cache-control')).toContain('private')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(TINY_PNG)).toBe(true)
  })

  it('GET /api/assets/:id：跨用户 → 404,响应不含字节', async () => {
    const app = makeApp()
    const { user: a } = await createLoggedInUser('a@a.com')
    const { deck } = await createDeckDirect(a.id)
    const { id } = await createAsset({
      deckId: deck.id,
      userId: a.id,
      mimeType: 'image/png',
      data: TINY_PNG,
    })

    const { cookie: bCookie } = await createLoggedInUser('b@b.com')
    const res = await app.request(`/api/assets/${id}`, { headers: { Cookie: bCookie } })
    expect(res.status).toBe(404)
    // 响应应是 JSON {error},不带二进制字节
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('json')
    const body = await res.text()
    expect(body).not.toContain(TINY_PNG.toString('binary').slice(0, 8))
  })

  it('GET /api/assets/:id：缺 id 段 → 404(路由不匹配)', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('noid@a.com')
    const res = await app.request('/api/assets/', { headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
  })
})
