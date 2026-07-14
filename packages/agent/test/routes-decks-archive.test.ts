/**
 * Phase 15 Task 31-B/C:GET /api/decks/:id/export-archive + POST /api/decks/import 集成测。
 *
 * 走真路由 mount(不直接调 buildArchive / parseArchive)—— 测 ownership 校验 / header 正确 /
 * 通过 jszip 解包内 manifest 链路 / multipart 解析 + DB transaction 端到端。
 *
 * 覆盖(export):
 * - happy:owner → 200 + 正确 header + 包内 manifest.deck.originalDeckId 对
 * - 401 未登录 / 403 跨用户 / 404 不存在 deck / 非数字 :id 404
 * - title 含非法文件名字符 → Content-Disposition filename 已清洗
 * - title 含中文 → Content-Disposition filename* UTF-8 percent-encoded + ASCII fallback
 *
 * 覆盖(import):
 * - happy:user A export → user A 携 cookie POST import → 201 + 返 {deckId, title}
 *   + 新 deck title 含「(导入)」+ currentVersion.content rewrite + asset 行落库
 * - schemaVersion 不支持 → 400 code: schema-unsupported
 * - manifest 字段缺 → 400 code: manifest-invalid
 * - 损坏 zip → 400 code: not-a-zip
 * - 文件过大 → 413(用 vi.stubEnv 把 max 改小再 unstub)
 * - 未登录 → 401
 * - 缺 multipart file 字段 → 400
 * - 跨账号 import:user A export → user B 携 cookie POST → 201 + 新 deck 归属 user B
 * - Round-trip:export → 删原 deck → import → 校 title / templateId / asset bytes byte-equal
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import JSZip from 'jszip'
import { eq } from 'drizzle-orm'
import { decksArchiveRoute } from '../src/routes/decks-archive.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { createAsset } from '../src/db/deck-assets.js'
import { getDb, decks, deckVersions, deckAssets } from '../src/db/index.js'

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

// ─── import 部分 ──────────────────────────────────────────────────────────

/** 给 user 出一个真 .lumideck Buffer(含 N 张 asset),用于后续 import 测试。 */
async function exportArchiveFor(
  app: Hono<{ Variables: AuthVars }>,
  cookie: string,
  deckId: number,
): Promise<Buffer> {
  const res = await app.request(`/api/decks/${deckId}/export-archive`, {
    headers: { Cookie: cookie },
  })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

/** 构造 multipart Request(file 字段 = .lumideck 字节)。 */
function makeImportRequest(cookie: string | null, bytes: Buffer): Request {
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: 'application/zip' }), 'archive.lumideck')
  const headers: Record<string, string> = {}
  if (cookie) headers.Cookie = cookie
  return new Request('http://x/api/decks/import', { method: 'POST', headers, body: fd })
}

describe('routes/decks-archive — import', () => {
  afterEach(() => {
    // CLAUDE.md「testing seam afterEach 复位」:vi.stubEnv 必须显式 unstub
    // 避免「文件过大」case 改的 LUMIDECK_IMPORT_MAX_BYTES 跨用例污染
    vi.unstubAllEnvs()
  })

  it('happy:user A export → user A import → 201 + 新 deck + assets 落库 + content rewrite', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('import-ok@a.com')
    // 用真 asset id 嵌入 content,验证 rewrite
    const { deck } = await createDeckDirect(user.id, 'Import Deck', '# placeholder')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const { id: oldAssetId } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: png,
      purpose: 'anchor',
      style: 'soft watercolor',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      stylePrompt: 'soft translucent watercolor wash',
      imageWidth: 1280,
      imageHeight: 624,
    })
    // update content 用真 asset id 引用,以验证 rewrite
    const realContent = `# slide 1\n\n![img](/api/assets/${oldAssetId})`
    await getDb().insert(deckVersions).values({
      deckId: deck.id,
      content: realContent,
      message: 'with-asset',
      authorId: user.id,
    })
    // 取最新 version(MAX id)指给 currentVersionId,确保 buildArchive 拿到 realContent
    const allVers = await getDb()
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deck.id))
    const maxVerId = Math.max(...allVers.map((v) => v.id))
    await getDb()
      .update(decks)
      .set({ currentVersionId: maxVerId, anchorAssetId: oldAssetId, anchorSkipped: true })
      .where(eq(decks.id, deck.id))

    // export
    const buf = await exportArchiveFor(app, cookie, deck.id)

    // import 走同一 user
    const res = await app.fetch(makeImportRequest(cookie, buf))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { deckId: number; title: string }
    expect(typeof body.deckId).toBe('number')
    expect(body.deckId).not.toBe(deck.id)
    expect(body.title).toBe('Import Deck(导入)')

    // 校 DB:新 deck 归属 user A,templateId 一致
    const [newDeck] = await getDb().select().from(decks).where(eq(decks.id, body.deckId)).limit(1)
    expect(newDeck).toBeDefined()
    expect(newDeck!.userId).toBe(user.id)
    expect(newDeck!.templateId).toBe(deck.templateId)
    expect(newDeck!.currentVersionId).not.toBeNull()
    expect(newDeck!.anchorSkipped).toBe(true)
    expect(newDeck!.anchorAssetId).not.toBeNull()
    expect(newDeck!.anchorAssetId).not.toBe(oldAssetId)

    // 新 currentVersion.content 内 asset url 已 rewrite 成新 uuid(不再是 oldAssetId)
    const [newVer] = await getDb()
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, newDeck!.currentVersionId!))
      .limit(1)
    expect(newVer!.content).toContain('/api/assets/')
    expect(newVer!.content).not.toContain(oldAssetId)
    expect(newVer!.content).toContain('# slide 1')
    expect(newVer!.anchorAssetId).toBe(newDeck!.anchorAssetId)

    // 新 deck 下有 1 个 asset,bytes byte-equal 原图
    const newAssets = await getDb()
      .select()
      .from(deckAssets)
      .where(eq(deckAssets.deckId, body.deckId))
    expect(newAssets).toHaveLength(1)
    const newAsset = newAssets[0]!
    expect(newAsset.id).not.toBe(oldAssetId)
    expect(newAsset.userId).toBe(user.id)
    expect(newAsset.mimeType).toBe('image/png')
    expect(newAsset.bytesSize).toBe(png.length)
    expect(Buffer.from(newAsset.data).equals(png)).toBe(true)
    expect(newAsset.id).toBe(newDeck!.anchorAssetId)
    expect(newAsset.purpose).toBe('anchor')
    expect(newAsset.style).toBe('soft watercolor')
    expect(newAsset.styleSource).toBe('explore')
    expect(newAsset.styleSourceId).toBe(newAsset.id)
    expect(newAsset.stylePalettePolicy).toBe('reference')
    expect(newAsset.stylePrompt).toBe('soft translucent watercolor wash')
    expect(newAsset.imageWidth).toBe(1280)
    expect(newAsset.imageHeight).toBe(624)
    // rewrite 后的新 url 真指向新 asset id
    expect(newVer!.content).toContain(`/api/assets/${newAsset.id}`)
  })

  it('schemaVersion 不支持 → 400 + code: schema-unsupported', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('schema-bad@a.com')
    const { deck } = await createDeckDirect(user.id, 'X')
    const buf = await exportArchiveFor(app, cookie, deck.id)

    // 改 schemaVersion 为 99
    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    manifest.schemaVersion = 99
    zip.file('manifest.json', JSON.stringify(manifest))
    const bad = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

    const res = await app.fetch(makeImportRequest(cookie, bad))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('schema-unsupported')
    expect(body.error).toContain('99')
  })

  it('templateId 不在 registry → 400 + code: template-unknown', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('tpl-bad@a.com')
    const { deck } = await createDeckDirect(user.id, 'TplTest')
    const buf = await exportArchiveFor(app, cookie, deck.id)

    // 改 manifest.deck.templateId 为不存在的模板 id
    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    manifest.deck.templateId = 'non-existent-template'
    zip.file('manifest.json', JSON.stringify(manifest))
    const bad = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

    const res = await app.fetch(makeImportRequest(cookie, bad))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('template-unknown')
    expect(body.error).toContain('non-existent-template')
  })

  it('manifest 字段缺 → 400 + code: manifest-invalid', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('manifest-bad@a.com')
    const { deck } = await createDeckDirect(user.id, 'X')
    const buf = await exportArchiveFor(app, cookie, deck.id)

    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    delete manifest.deck.title
    zip.file('manifest.json', JSON.stringify(manifest))
    const bad = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })

    const res = await app.fetch(makeImportRequest(cookie, bad))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('manifest-invalid')
  })

  it('损坏 zip → 400 + code: not-a-zip', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('bad-zip@a.com')
    const garbage = Buffer.alloc(64, 0xff)

    const res = await app.fetch(makeImportRequest(cookie, garbage))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('not-a-zip')
  })

  it('文件过大 → 413(stubEnv 把 max 改成 100 字节)', async () => {
    vi.stubEnv('LUMIDECK_IMPORT_MAX_BYTES', '100')
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('big@a.com')
    const { deck } = await createDeckDirect(user.id, 'Big')
    // 即便不带 asset,buildArchive 出包 > 100 字节(manifest JSON 本身就远超)
    const buf = await exportArchiveFor(app, cookie, deck.id)
    expect(buf.length).toBeGreaterThan(100)

    const res = await app.fetch(makeImportRequest(cookie, buf))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('上限')
  })

  it('未登录 → 401', async () => {
    const app = makeApp()
    const garbage = Buffer.alloc(64, 0xff)
    const res = await app.fetch(makeImportRequest(null, garbage))
    expect(res.status).toBe(401)
  })

  it('缺 multipart file 字段 → 400', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('nofile@a.com')
    const fd = new FormData()
    fd.append('notfile', 'oops')
    const res = await app.fetch(
      new Request('http://x/api/decks/import', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: fd,
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('请上传 .lumideck 文件')
  })

  it('跨账号 import:user A export → user B 携 cookie POST → 201 + 新 deck 属于 user B', async () => {
    const app = makeApp()
    const { user: userA, cookie: aCookie } = await createLoggedInUser('crossA@a.com')
    const { deck: deckA } = await createDeckDirect(userA.id, 'A original', '# from A')
    await createAsset({
      deckId: deckA.id,
      userId: userA.id,
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3, 4]),
    })
    const buf = await exportArchiveFor(app, aCookie, deckA.id)

    const { user: userB, cookie: bCookie } = await createLoggedInUser('crossB@a.com')
    const res = await app.fetch(makeImportRequest(bCookie, buf))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { deckId: number; title: string }

    const [newDeck] = await getDb().select().from(decks).where(eq(decks.id, body.deckId)).limit(1)
    expect(newDeck).toBeDefined()
    expect(newDeck!.userId).toBe(userB.id) // 关键:归属 user B,不是 user A
    expect(newDeck!.userId).not.toBe(userA.id)

    // asset 也归属 user B
    const newAssets = await getDb()
      .select()
      .from(deckAssets)
      .where(eq(deckAssets.deckId, body.deckId))
    expect(newAssets).toHaveLength(1)
    expect(newAssets[0]!.userId).toBe(userB.id)
  })

  it('Round-trip:export → 删原 deck → import → title/templateId 还原 + assets byte-equal', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('roundtrip@a.com')

    // 2 张不同 mime 的 asset
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
    ])
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const { deck: original } = await createDeckDirect(user.id, 'RT Original', '# placeholder')
    const { id: pngId } = await createAsset({
      deckId: original.id,
      userId: user.id,
      mimeType: 'image/png',
      data: png,
      prompt: 'roundtrip png',
      model: 'gpt-image-1',
    })
    const { id: jpgId } = await createAsset({
      deckId: original.id,
      userId: user.id,
      mimeType: 'image/jpeg',
      data: jpg,
    })
    // 更新 content 引用 2 张 asset
    const originalContent = `# Slide A\n\n![png](/api/assets/${pngId})\n\n---\n\n# Slide B\n\n![jpg](/api/assets/${jpgId})`
    await getDb().insert(deckVersions).values({
      deckId: original.id,
      content: originalContent,
      message: 'roundtrip',
      authorId: user.id,
    })
    // 取最新 version(MAX id)指给 currentVersionId,确保 buildArchive 拿到 realContent
    const allVers = await getDb()
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, original.id))
    const maxVerId = Math.max(...allVers.map((v) => v.id))
    await getDb().update(decks).set({ currentVersionId: maxVerId }).where(eq(decks.id, original.id))

    const originalTitle = original.title
    const originalTemplateId = original.templateId
    const originalId = original.id

    // export
    const buf = await exportArchiveFor(app, cookie, original.id)

    // 删原 deck(及关联 versions/assets;FK cascade 会处理)
    // schema 用 onDelete: 'cascade',这里硬 DELETE 不走 soft-delete 路径
    await getDb().delete(decks).where(eq(decks.id, original.id))
    const [shouldBeGone] = await getDb()
      .select()
      .from(decks)
      .where(eq(decks.id, original.id))
      .limit(1)
    expect(shouldBeGone).toBeUndefined()

    // import 同 user
    const res = await app.fetch(makeImportRequest(cookie, buf))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { deckId: number; title: string }
    expect(body.deckId).not.toBe(originalId)
    expect(body.title).toBe(`${originalTitle}(导入)`)

    // 新 deck 字段断言
    const [newDeck] = await getDb().select().from(decks).where(eq(decks.id, body.deckId)).limit(1)
    expect(newDeck).toBeDefined()
    expect(newDeck!.userId).toBe(user.id)
    expect(newDeck!.templateId).toBe(originalTemplateId)
    expect(newDeck!.title).toBe(`${originalTitle}(导入)`)

    // 新 currentVersion content:asset url 已 rewrite,旧 id 不再出现
    const [newVer] = await getDb()
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, newDeck!.currentVersionId!))
      .limit(1)
    expect(newVer!.content).not.toContain(pngId)
    expect(newVer!.content).not.toContain(jpgId)
    // non-url 部分 byte-equal:把 url 替换掉再比
    const stripUrls = (s: string) => s.replace(/\/api\/assets\/[0-9a-f-]{36}/g, '/api/assets/XXX')
    expect(stripUrls(newVer!.content)).toBe(stripUrls(originalContent))

    // 新 deck 下 2 张 asset bytes byte-equal 原图
    const newAssets = await getDb()
      .select()
      .from(deckAssets)
      .where(eq(deckAssets.deckId, body.deckId))
    expect(newAssets).toHaveLength(2)
    const byMime = new Map(newAssets.map((a) => [a.mimeType, a]))
    const newPng = byMime.get('image/png')!
    const newJpg = byMime.get('image/jpeg')!
    expect(newPng).toBeDefined()
    expect(newJpg).toBeDefined()
    expect(newPng.bytesSize).toBe(png.length)
    expect(newJpg.bytesSize).toBe(jpg.length)
    expect(Buffer.from(newPng.data).equals(png)).toBe(true)
    expect(Buffer.from(newJpg.data).equals(jpg)).toBe(true)
    // prompt / model 也跟着 manifest 还原
    expect(newPng.prompt).toBe('roundtrip png')
    expect(newPng.model).toBe('gpt-image-1')
    expect(newJpg.prompt).toBeNull()
    expect(newJpg.model).toBeNull()
    expect(newPng.userId).toBe(user.id)
    // rewrite 后的 content 确实指向新 asset id
    expect(newVer!.content).toContain(`/api/assets/${newPng.id}`)
    expect(newVer!.content).toContain(`/api/assets/${newJpg.id}`)
    // 多步 round-trip(export→删→import)对远程 RDS 往返多,全量串行长跑时 5s 默认超时会抖
  }, 15_000)
})
