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
 * - title 含中文 → Content-Disposition filename* UTF-8 percent-encoded + ASCII fallback
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

  it('中文 title → RFC 6266 filename* UTF-8 percent-encoded + filename= ASCII fallback', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('zh@a.com')
    // 'Q1 业务汇报' —— 用 codepoint 拼避免源码字符渲染歧义
    const zhTitle = `Q1 ${String.fromCodePoint(0x4e1a, 0x52a1, 0x6c47, 0x62a5)}`
    const { deck } = await createDeckDirect(user.id, zhTitle)
    const res = await app.request(`/api/decks/${deck.id}/export-archive`, {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const cd = res.headers.get('content-disposition') ?? ''

    // filename*=UTF-8''<percent-encoded>:断 precise encoding
    // 'Q1 业务汇报' UTF-8 字节 → 'Q1%20%E4%B8%9A%E5%8A%A1%E6%B1%87%E6%8A%A5'
    const star = cd.match(/filename\*=UTF-8''([^;]+)/)
    expect(star).not.toBeNull()
    const encoded = star![1]
    expect(encoded).toContain('Q1%20%E4%B8%9A%E5%8A%A1%E6%B1%87%E6%8A%A5')
    expect(encoded.endsWith('.lumideck')).toBe(true)
    // decode 回原 title 字符串(带时间戳后缀)
    const decoded = decodeURIComponent(encoded)
    expect(decoded.startsWith(`${zhTitle}-`)).toBe(true)
    expect(decoded.endsWith('.lumideck')).toBe(true)

    // ASCII fallback (filename=) 不含非 ASCII —— 中文已替成 _
    const m = cd.match(/filename="([^"]+)"/)
    expect(m).not.toBeNull()
    const fallback = m![1]
    // 用 code point 校:每个 char 必须落 0x00-0x7F(ASCII range)
    for (const ch of fallback) {
      expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0x7f)
    }
    expect(fallback).toContain('Q1 ____')
    expect(fallback.endsWith('.lumideck')).toBe(true)
  })
})
