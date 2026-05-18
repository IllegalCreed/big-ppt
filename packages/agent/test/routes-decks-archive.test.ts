/**
 * Phase 15 Task 31-B:GET /api/decks/:id/export-archive 集成测。
 *
 * 走真路由 mount(不直接调 buildArchive)—— 测 ownership 校验 / header 正确 /
 * 通过 jszip 解包内 manifest 链路。
 *
 * 覆盖:
 * - happy:owner → 200 + 正确 header + 包内 manifest.deck.originalDeckId 对
 * - 401 未登录
 * - 403 跨用户
 * - 404 不存在 deck
 * - 非数字 :id(路由 regex `[0-9]+` 兜底 404)
 * - title 含非法文件名字符 → Content-Disposition filename 已清洗
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import JSZip from 'jszip'
import { decksArchiveRoute } from '../src/routes/decks-archive.js'
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
  app.route('/api', decksArchiveRoute)
  return app
}

describe('routes/decks-archive — export', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/decks/1/export-archive')
    expect(res.status).toBe(401)
  })

  it('owner → 200 + 头正确 + 包内 manifest 正确', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ok@a.com')
    const { deck } = await createDeckDirect(user.id, 'My Pres', '# slide 1')
    await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: TINY_PNG,
    })

    const res = await app.request(`/api/decks/${deck.id}/export-archive`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('attachment')
    expect(cd).toContain('.lumideck')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBe(Number(res.headers.get('content-length')))
    expect(buf.length).toBeGreaterThan(0)

    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.deck.originalDeckId).toBe(deck.id)
    expect(manifest.deck.title).toBe('My Pres')
    expect(manifest.assets).toHaveLength(1)
    const content = await zip.file('content.md')!.async('string')
    expect(content).toBe('# slide 1')
  })

  it('跨用户 → 403', async () => {
    const app = makeApp()
    const { user: a } = await createLoggedInUser('a@a.com')
    const { deck } = await createDeckDirect(a.id, 'A deck')
    const { cookie: bCookie } = await createLoggedInUser('b@b.com')

    const res = await app.request(`/api/decks/${deck.id}/export-archive`, {
      headers: { Cookie: bCookie },
    })
    expect(res.status).toBe(403)
  })

  it('不存在的 deck → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('ghost@a.com')
    const res = await app.request('/api/decks/999999/export-archive', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('非数字 :id(路由不匹配)→ 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('foo@a.com')
    const res = await app.request('/api/decks/abc/export-archive', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('title 含非法文件名字符 → filename 已清洗', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('weird@a.com')
    // 用 `/` `:` `?` 等 Win/Mac 禁字符
    const { deck } = await createDeckDirect(user.id, 'a/b:c?d*e"f<g>h|i')
    const res = await app.request(`/api/decks/${deck.id}/export-archive`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const cd = res.headers.get('content-disposition') ?? ''
    // 抽出 filename="<...>" 中间的内容做断言(整 header 本身含包裹双引号会假阳)
    const m = cd.match(/filename="([^"]+)"/)
    expect(m).not.toBeNull()
    const fname = m![1]
    // filename 内不应原样含任何被禁字符 —— 全部替成 _
    expect(fname).not.toMatch(/[\\/:*?"<>|]/)
    expect(fname).toContain('a_b_c_d_e_f_g_h_i')
    expect(fname.endsWith('.lumideck')).toBe(true)
  })
})
