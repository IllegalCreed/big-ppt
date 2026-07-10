/** Phase 13 Task B: /api/uploads 集成测(12 case,真 lumideck_test DB + tmpdir fs)。 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { useTestDb } from '../_setup/test-db.js'
import { createLoggedInUser } from '../_setup/factories.js'
import { getDb, userAssets } from '../../src/db/index.js'
import { uploads } from '../../src/routes/uploads.js'
import { authOptional, type AuthVars } from '../../src/middleware/auth.js'
import { __resetQuotaLocksForTesting } from '../../src/uploads/quota.js'

useTestDb()

// 用 tmpdir 隔离 fs root,避免污染本地 dev assets。test env 显式收紧 quota:
// per-user 100KB / per-file 10KB,让 "超 quota / 超单文件" 用例不必真造 11MB 字节。
let tmpDir: string
const prevEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  prevEnv.assets = process.env.LUMIDECK_ASSETS_DIR
  prevEnv.perUser = process.env.LUMIDECK_QUOTA_PER_USER_BYTES
  prevEnv.perFile = process.env.LUMIDECK_QUOTA_PER_FILE_BYTES
})

beforeEach(async () => {
  __resetQuotaLocksForTesting()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumideck-uploads-test-'))
  process.env.LUMIDECK_ASSETS_DIR = tmpDir
  process.env.LUMIDECK_QUOTA_PER_USER_BYTES = String(100 * 1024) // 100KB
  process.env.LUMIDECK_QUOTA_PER_FILE_BYTES = String(10 * 1024) // 10KB
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

afterAll(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    const envKey =
      k === 'assets'
        ? 'LUMIDECK_ASSETS_DIR'
        : k === 'perUser'
          ? 'LUMIDECK_QUOTA_PER_USER_BYTES'
          : 'LUMIDECK_QUOTA_PER_FILE_BYTES'
    if (v === undefined) delete process.env[envKey]
    else process.env[envKey] = v
  }
})

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api/uploads', uploads)
  return app
}

/** 最小合法 PDF magic header — file-type 据此识别 application/pdf。 */
function makePdfBytes(payload = 'hello'): Buffer {
  // PDF magic: %PDF-1.4\n + arbitrary body + trailing %%EOF
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(payload),
    Buffer.from('\n%%EOF\n'),
  ])
}

/** 最小 1x1 透明 PNG — magic bytes 跟 task A 单测一致。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG sig
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

/** MZ header — Windows .exe / DLL,file-type 会识别成 application/x-msdownload。 */
const EXE_BYTES = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
])

function makeRequest(
  cookie: string | null,
  filename: string,
  bytes: Buffer,
  contentType: string,
): Request {
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: contentType }), filename)
  const headers: Record<string, string> = {}
  if (cookie) headers.Cookie = cookie
  return new Request('http://x/api/uploads', { method: 'POST', headers, body: fd })
}

describe('POST /api/uploads', () => {
  it('未登录 → 401', async () => {
    const res = await buildApp().fetch(makeRequest(null, 'a.pdf', makePdfBytes(), 'application/pdf'))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('unauthorized')
  })

  it('上传合法 PDF → 200 + asset/quota shape 正确', async () => {
    const { cookie, user } = await createLoggedInUser('pdf@a.com')
    const pdf = makePdfBytes('lumideck-test')
    const res = await buildApp().fetch(makeRequest(cookie, 'doc.pdf', pdf, 'application/pdf'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      asset: {
        id: string
        filename: string
        mime: string
        sizeBytes: number
        extractStatus: string
        uploadedAt: string
      }
      quota: { usedBytes: number; limitBytes: number }
    }
    expect(body.asset.filename).toBe('doc.pdf')
    expect(body.asset.mime).toBe('application/pdf')
    expect(body.asset.sizeBytes).toBe(pdf.length)
    expect(body.asset.extractStatus).toBe('pending')
    expect(body.asset.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.quota.usedBytes).toBe(pdf.length)
    expect(body.quota.limitBytes).toBe(100 * 1024)

    // DB row 落对了
    const [row] = await getDb()
      .select()
      .from(userAssets)
      .where(eq(userAssets.userId, user.id))
      .limit(1)
    expect(row?.filename).toBe('doc.pdf')
    expect(row?.mime).toBe('application/pdf')
    // Phase 13 Task G:enqueueExtraction 在 response 写完后异步跑,这里读 DB 时
    // 可能 status 已经从 pending 走到 failed(stub PDF magic header 字节走不通
    // pdfjs 解析)或 done。断言 status 在合法值集合内,避免 race
    expect(['pending', 'running', 'failed', 'done']).toContain(row?.extractStatus)
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/)

    // fs 字节也写入了
    const fsBytes = await fs.readFile(path.join(tmpDir, String(user.id), row!.id))
    expect(fsBytes.equals(pdf)).toBe(true)
  })

  it('PNG image → extractStatus=skipped(图片不需要文本抽取)', async () => {
    const { cookie } = await createLoggedInUser('png@a.com')
    const res = await buildApp().fetch(makeRequest(cookie, 'pic.png', PNG_BYTES, 'image/png'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { asset: { extractStatus: string; mime: string } }
    expect(body.asset.mime).toBe('image/png')
    expect(body.asset.extractStatus).toBe('skipped')
  })

  it('超单文件上限 → 413 file-too-large', async () => {
    const { cookie } = await createLoggedInUser('big@a.com')
    // per-file=10KB,造 11KB PDF
    const big = makePdfBytes('x'.repeat(11 * 1024))
    const res = await buildApp().fetch(makeRequest(cookie, 'big.pdf', big, 'application/pdf'))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('file-too-large')
    expect(body.error.message).toBe('单文件超过 10MB 上限')
  })

  it('累计超 user quota → 413 quota-exceeded', async () => {
    const { cookie, user } = await createLoggedInUser('quota@a.com')
    // per-user=100KB,先写 95KB 元数据占用,再传 8KB → 超 100KB
    // 直接 SQL 占满 quota,bypass route 走 mock fs(此 row 仅占 sizeBytes 计数用)
    await getDb().insert(userAssets).values({
      id: '11111111-1111-1111-1111-111111111111',
      userId: user.id,
      filename: 'precooked.pdf',
      mime: 'application/pdf',
      sizeBytes: 95 * 1024,
      sha256: 'a'.repeat(64),
      storagePath: `${user.id}/11111111-1111-1111-1111-111111111111`,
      extractStatus: 'done',
    })

    const fresh = makePdfBytes('y'.repeat(8 * 1024))
    const res = await buildApp().fetch(makeRequest(cookie, 'q.pdf', fresh, 'application/pdf'))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('quota-exceeded')
    expect(body.error.message).toMatch(/已用.*请先在「我的素材」清理/)
  })

  it('并发上传在 quota 锁内串行复查,只能放行一个临界文件', async () => {
    const { cookie, user } = await createLoggedInUser('quota-race@a.com')
    await getDb().insert(userAssets).values({
      id: '22222222-2222-2222-2222-222222222222',
      userId: user.id,
      filename: 'precooked.pdf',
      mime: 'application/pdf',
      sizeBytes: 90 * 1024,
      sha256: 'b'.repeat(64),
      storagePath: `${user.id}/22222222-2222-2222-2222-222222222222`,
      extractStatus: 'done',
    })

    const fresh = makePdfBytes('z'.repeat(6 * 1024))
    const [a, b] = await Promise.all([
      buildApp().fetch(makeRequest(cookie, 'a.pdf', fresh, 'application/pdf')),
      buildApp().fetch(makeRequest(cookie, 'b.pdf', fresh, 'application/pdf')),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 413])

    const rows = await getDb().select().from(userAssets).where(eq(userAssets.userId, user.id))
    expect(rows.filter((r) => r.filename === 'a.pdf' || r.filename === 'b.pdf')).toHaveLength(1)
  })

  it('不支持的 mime(.exe MZ header) → 415 unsupported-mime', async () => {
    const { cookie } = await createLoggedInUser('exe@a.com')
    const res = await buildApp().fetch(
      makeRequest(cookie, 'evil.exe', EXE_BYTES, 'application/octet-stream'),
    )
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unsupported-mime')
  })

  it('magic-bytes 跟扩展名不符(.exe 改名 .pdf) → 415(magic 优先)', async () => {
    const { cookie } = await createLoggedInUser('fake-pdf@a.com')
    // 字节内容是 MZ 但 filename / claimed mime 都假装 PDF
    const res = await buildApp().fetch(
      makeRequest(cookie, 'innocent.pdf', EXE_BYTES, 'application/pdf'),
    )
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unsupported-mime')
  })

  it('.md 文件(file-type 不识别)走 filename 后缀 fallback → text/markdown', async () => {
    const { cookie } = await createLoggedInUser('md@a.com')
    const md = Buffer.from('# Hello\n\nLumideck Phase 13.')
    const res = await buildApp().fetch(makeRequest(cookie, 'notes.md', md, 'text/markdown'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { asset: { mime: string; extractStatus: string } }
    expect(body.asset.mime).toBe('text/markdown')
    expect(body.asset.extractStatus).toBe('pending')
  })
})

describe('GET /api/uploads', () => {
  it('返当前 user 全部 asset(按 uploadedAt desc)+ quota,不串其他 user', async () => {
    const { cookie: cookieA, user: userA } = await createLoggedInUser('listA@a.com')
    const { user: userB } = await createLoggedInUser('listB@a.com')

    // 给 A 写 2 条,B 写 1 条;显式 uploadedAt 避免 MySQL TIMESTAMP 秒级精度造成同秒并列
    const t1 = new Date('2026-05-01T10:00:00Z')
    const t2 = new Date('2026-05-01T10:00:05Z')
    const t3 = new Date('2026-05-01T10:00:10Z')
    await getDb().insert(userAssets).values([
      {
        id: '22222222-2222-2222-2222-222222222222',
        userId: userA.id,
        filename: 'first.pdf',
        mime: 'application/pdf',
        sizeBytes: 100,
        sha256: 'b'.repeat(64),
        storagePath: `${userA.id}/22222222-2222-2222-2222-222222222222`,
        extractStatus: 'done',
        uploadedAt: t1,
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        userId: userA.id,
        filename: 'second.pdf',
        mime: 'application/pdf',
        sizeBytes: 200,
        sha256: 'c'.repeat(64),
        storagePath: `${userA.id}/33333333-3333-3333-3333-333333333333`,
        extractStatus: 'pending',
        uploadedAt: t3, // 更新,desc 排在最前
      },
      {
        id: '44444444-4444-4444-4444-444444444444',
        userId: userB.id,
        filename: 'b-only.pdf',
        mime: 'application/pdf',
        sizeBytes: 50,
        sha256: 'd'.repeat(64),
        storagePath: `${userB.id}/44444444-4444-4444-4444-444444444444`,
        extractStatus: 'done',
        uploadedAt: t2,
      },
    ])

    const res = await buildApp().fetch(
      new Request('http://x/api/uploads', { headers: { Cookie: cookieA } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      assets: { id: string; filename: string }[]
      quota: { usedBytes: number; limitBytes: number }
    }
    expect(body.assets).toHaveLength(2)
    expect(body.assets[0]?.filename).toBe('second.pdf') // desc by uploadedAt
    expect(body.assets[1]?.filename).toBe('first.pdf')
    expect(body.quota.usedBytes).toBe(300)
    expect(body.quota.limitBytes).toBe(100 * 1024)
  })
})

describe('GET /api/uploads/:id', () => {
  it('返字节流 + Content-Type 正确', async () => {
    const { cookie } = await createLoggedInUser('get-bytes@a.com')
    const pdf = makePdfBytes('stream-me')
    const postRes = await buildApp().fetch(makeRequest(cookie, '报告.pdf', pdf, 'application/pdf'))
    const { asset } = (await postRes.json()) as { asset: { id: string } }

    const getRes = await buildApp().fetch(
      new Request(`http://x/api/uploads/${asset.id}`, { headers: { Cookie: cookie } }),
    )
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('content-type')).toBe('application/pdf')
    expect(getRes.headers.get('content-length')).toBe(String(pdf.length))
    expect(getRes.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf",
    )
    expect(getRes.headers.get('x-content-type-options')).toBe('nosniff')

    const buf = Buffer.from(await getRes.arrayBuffer())
    expect(buf.equals(pdf)).toBe(true)
  })

  it('跨用户访问 → 404(不暴露存在性)', async () => {
    const { cookie: cookieA } = await createLoggedInUser('crossA@a.com')
    const { cookie: cookieB } = await createLoggedInUser('crossB@a.com')

    // A 上传一份
    const postRes = await buildApp().fetch(
      makeRequest(cookieA, 'a.pdf', makePdfBytes(), 'application/pdf'),
    )
    const { asset } = (await postRes.json()) as { asset: { id: string } }

    // B 用自己的 cookie 访问 A 的 asset → 404
    const getRes = await buildApp().fetch(
      new Request(`http://x/api/uploads/${asset.id}`, { headers: { Cookie: cookieB } }),
    )
    expect(getRes.status).toBe(404)
  })
})

describe('DELETE /api/uploads/:id', () => {
  it('删 fs + DB + 返新 quota', async () => {
    const { cookie, user } = await createLoggedInUser('del@a.com')
    const pdf = makePdfBytes('byebye')
    const postRes = await buildApp().fetch(makeRequest(cookie, 'rm.pdf', pdf, 'application/pdf'))
    const { asset } = (await postRes.json()) as { asset: { id: string } }
    const fsPath = path.join(tmpDir, String(user.id), asset.id)
    expect((await fs.stat(fsPath)).isFile()).toBe(true)

    const delRes = await buildApp().fetch(
      new Request(`http://x/api/uploads/${asset.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      }),
    )
    expect(delRes.status).toBe(200)
    const body = (await delRes.json()) as { quota: { usedBytes: number; limitBytes: number } }
    expect(body.quota.usedBytes).toBe(0)

    // DB 行没了
    const rows = await getDb().select().from(userAssets).where(eq(userAssets.id, asset.id))
    expect(rows).toHaveLength(0)
    // fs 字节也没了
    await expect(fs.stat(fsPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('跨用户 DELETE → 404 不泄漏 + 真实 owner 数据不动', async () => {
    const { cookie: cookieA, user: userA } = await createLoggedInUser('delA@a.com')
    const { cookie: cookieB } = await createLoggedInUser('delB@a.com')
    const postRes = await buildApp().fetch(
      makeRequest(cookieA, 'keep.pdf', makePdfBytes(), 'application/pdf'),
    )
    const { asset } = (await postRes.json()) as { asset: { id: string } }

    const delRes = await buildApp().fetch(
      new Request(`http://x/api/uploads/${asset.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookieB },
      }),
    )
    expect(delRes.status).toBe(404)

    // A 的 row 仍在
    const rows = await getDb()
      .select()
      .from(userAssets)
      .where(eq(userAssets.userId, userA.id))
    expect(rows).toHaveLength(1)
  })

  it('fs 字节缺失(手动 rm)→ DELETE 仍幂等返 200', async () => {
    const { cookie, user } = await createLoggedInUser('missing-fs@a.com')
    const postRes = await buildApp().fetch(
      makeRequest(cookie, 'ghost.pdf', makePdfBytes(), 'application/pdf'),
    )
    const { asset } = (await postRes.json()) as { asset: { id: string } }
    // 手动 rm fs 文件,模拟磁盘错位
    await fs.unlink(path.join(tmpDir, String(user.id), asset.id))

    const delRes = await buildApp().fetch(
      new Request(`http://x/api/uploads/${asset.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      }),
    )
    expect(delRes.status).toBe(200)
    const rows = await getDb().select().from(userAssets).where(eq(userAssets.id, asset.id))
    expect(rows).toHaveLength(0)
  })
})
