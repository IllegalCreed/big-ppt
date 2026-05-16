/**
 * Phase 13 Task C：extractor 集成测(真 lumideck_test DB)。
 *
 * 覆盖:
 *  1-5. PDF / DOCX / XLSX / MD / TXT 五种 mime 抽取 happy path
 *  6.  PDF 大文本 truncation(> 50K 字截断 + "(truncated" 标记)
 *  7.  image mime → runParser 直接抛 unsupported(上游 upload 路由理应跳过入队)
 *  8.  parser 失败 → extractStatus='failed' + extractErrorMsg 非空
 *  9.  TIMEOUT_MS / CONCURRENCY 常量值(代码约束断言)
 *  10. 并发上限:enqueue 多 job 时 active 数 ≤ 3
 *
 * fixtures 用 pdf-lib / docx / xlsx 三个库在 beforeAll 运行时生成(避免提交二进制
 * 到仓库 + 不依赖外部下载)。MD / TXT 直接 Buffer.from。
 *
 * Phase 13 三任务并行期曾有 "asset not found / 401 / FK violation" 偶发 flake,
 * 根因是 test-db.ts 的 `TRUNCATE TABLE` + mysql2 prepared statement(`pool.execute`)
 * 在 Aliyun RDS 上触发的 stale-plan 静默返空 bug。详见 `test/_setup/test-db.ts`
 * 注释。已改为 `DELETE FROM` 修复(600 跑 0 失败),seedAsset 防御性 verify 保留
 * 作为多层防护(开销可忽略)。
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import * as XLSX from 'xlsx'
import { useTestDb } from '../_setup/test-db.js'
import { createTestUser } from '../_setup/factories.js'
import { getDb, userAssets } from '../../src/db/index.js'
import { putAssetBytes } from '../../src/uploads/storage.js'
import {
  enqueueExtraction,
  waitForQueueIdle,
  runParser,
  __getActiveCountForTesting,
  __TIMEOUT_MS_FOR_TESTING,
  __CONCURRENCY_FOR_TESTING,
} from '../../src/uploads/extractor.js'

// 测试期 assets root 隔离到 tmp,避免污染 dev 数据
const ASSETS_DIR = path.join(process.cwd(), '.test-assets', randomUUID())
process.env.LUMIDECK_ASSETS_DIR = ASSETS_DIR

useTestDb()

// ---- fixture 生成器(beforeAll 一次,跨测试复用) ----
let pdfBuf: Buffer
let docxBuf: Buffer
let xlsxBuf: Buffer
let mdBuf: Buffer
let txtBuf: Buffer
/** 用于 truncation 测的超长 PDF(> 50K 字) */
let bigPdfBuf: Buffer

async function buildPdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  // pdf-lib 单页宽度有限,拆 chunks 多行写
  const chunks = text.match(/.{1,80}/g) ?? [text]
  let page = doc.addPage([600, 800])
  let y = 770
  for (const chunk of chunks) {
    if (y < 30) {
      page = doc.addPage([600, 800])
      y = 770
    }
    page.drawText(chunk, { x: 30, y, size: 12, font })
    y -= 16
  }
  return Buffer.from(await doc.save())
}

beforeAll(async () => {
  // PDF
  pdfBuf = await buildPdf('Hello Phase 13 PDF extraction test content.')

  // 超大 PDF(> 50K 字)用于 truncation 测
  const longText = 'Long PDF content. '.repeat(4000) // ~72K chars
  bigPdfBuf = await buildPdf(longText)

  // DOCX
  const docxDoc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun('Hello Phase 13 DOCX extraction test.')] }),
          new Paragraph({ children: [new TextRun('Second paragraph with 中文 content.')] }),
        ],
      },
    ],
  })
  docxBuf = await Packer.toBuffer(docxDoc)

  // XLSX
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Name', 'Score'],
    ['Alice', 95],
    ['Bob', 87],
  ])
  XLSX.utils.book_append_sheet(wb, ws1, 'Scores')
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Product', 'Price'],
    ['A', 10],
  ])
  XLSX.utils.book_append_sheet(wb, ws2, 'Products')
  xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  // MD / TXT
  mdBuf = Buffer.from('# Hello Phase 13\n\nThis is a **markdown** test fixture.', 'utf8')
  txtBuf = Buffer.from('Hello Phase 13 plain TXT content.\nSecond line.', 'utf8')
})

afterAll(async () => {
  // 清测试 assets 目录
  try {
    await fs.rm(ASSETS_DIR, { recursive: true, force: true })
  } catch {
    // 已删 / 不存在,忽略
  }
})

// ---- helper:插入 pending user_asset row + 写字节,返 assetId ----
async function seedAsset(opts: {
  userId: number
  mime: string
  bytes: Buffer
  filename: string
}): Promise<string> {
  const db = getDb()
  const assetId = randomUUID()
  const storagePath = await putAssetBytes(opts.userId, assetId, opts.bytes)
  await db.insert(userAssets).values({
    id: assetId,
    userId: opts.userId,
    filename: opts.filename,
    mime: opts.mime,
    sizeBytes: opts.bytes.length,
    sha256: 'test-sha-' + assetId.slice(0, 8),
    storagePath,
    extractStatus: 'pending',
  })
  // 防御性回读:确认 row 真在 DB 里。空 INSERT (drizzle 静默吞掉) 才会触发,
  // 不会拖累正常路径(只一条 SELECT)
  const [verify] = await db
    .select({ id: userAssets.id })
    .from(userAssets)
    .where(eq(userAssets.id, assetId))
    .limit(1)
  if (!verify) throw new Error(`seedAsset: INSERT 后立刻 SELECT 回查不到 ${assetId}`)
  return assetId
}

async function getAsset(
  assetId: string,
): Promise<{ extractStatus: string; extractedText: string | null; extractErrorMsg: string | null }> {
  const db = getDb()
  const [row] = await db
    .select({
      extractStatus: userAssets.extractStatus,
      extractedText: userAssets.extractedText,
      extractErrorMsg: userAssets.extractErrorMsg,
    })
    .from(userAssets)
    .where(eq(userAssets.id, assetId))
    .limit(1)
  if (!row) throw new Error(`asset ${assetId} not found`)
  return row
}

describe('extractor 集成（真 lumideck_test DB + 真 fs）', () => {
  let userId: number

  beforeEach(async () => {
    const { user } = await createTestUser(`extractor-${randomUUID().slice(0, 8)}@a.com`)
    userId = user.id
  })

  it('PDF 抽取 → status=done + 文本含关键词', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'application/pdf',
      bytes: pdfBuf,
      filename: 'sample.pdf',
    })
    enqueueExtraction({ assetId, userId, mime: 'application/pdf' })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toMatch(/Hello Phase 13/)
    expect(row.extractErrorMsg).toBeNull()
  })

  it('DOCX 抽取 → status=done + 包含两段', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: docxBuf,
      filename: 'sample.docx',
    })
    enqueueExtraction({
      assetId,
      userId,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toContain('Hello Phase 13 DOCX')
    expect(row.extractedText).toContain('中文')
  })

  it('XLSX 抽取 → JSON 含 sheet 名 + 行数据', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: xlsxBuf,
      filename: 'sample.xlsx',
    })
    enqueueExtraction({
      assetId,
      userId,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toContain('Scores')
    expect(row.extractedText).toContain('Products')
    expect(row.extractedText).toContain('Alice')
    expect(row.extractedText).toContain('95')
  })

  it('MD 抽取 → status=done + 原文保留', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'text/markdown',
      bytes: mdBuf,
      filename: 'sample.md',
    })
    enqueueExtraction({ assetId, userId, mime: 'text/markdown' })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toContain('# Hello Phase 13')
    expect(row.extractedText).toContain('**markdown**')
  })

  it('TXT 抽取 → status=done + 原文保留', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'text/plain',
      bytes: txtBuf,
      filename: 'sample.txt',
    })
    enqueueExtraction({ assetId, userId, mime: 'text/plain' })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toContain('Hello Phase 13 plain TXT')
    expect(row.extractedText).toContain('Second line')
  })

  it('PDF > 50K 字 → 截断 + ends with "... (truncated"', async () => {
    const assetId = await seedAsset({
      userId,
      mime: 'application/pdf',
      bytes: bigPdfBuf,
      filename: 'big.pdf',
    })
    enqueueExtraction({ assetId, userId, mime: 'application/pdf' })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('done')
    expect(row.extractedText).toMatch(/\.\.\. \(truncated/)
    // 不超过 50K + 截断尾巴 buffer(< 1KB)
    expect(row.extractedText!.length).toBeLessThan(51_000)
  })

  it('image mime → runParser 直接抛 unsupported(上游 upload 路由 mark skipped 不入队)', async () => {
    // runParser 是公开 fn,模拟意外调用 image 类型应明确抛错而不是 silently 返回空
    await expect(runParser('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).rejects.toThrow(
      /unsupported mime/i,
    )
  })

  it('坏 PDF 字节 → status=failed + extractErrorMsg 非空', async () => {
    const corrupt = Buffer.from('this is not a valid pdf at all')
    const assetId = await seedAsset({
      userId,
      mime: 'application/pdf',
      bytes: corrupt,
      filename: 'corrupt.pdf',
    })
    enqueueExtraction({ assetId, userId, mime: 'application/pdf' })
    await waitForQueueIdle()
    const row = await getAsset(assetId)
    expect(row.extractStatus).toBe('failed')
    expect(row.extractErrorMsg).toBeTruthy()
    expect(row.extractErrorMsg!.length).toBeGreaterThan(0)
  })

  it('TIMEOUT_MS=30s + CONCURRENCY=3 常量约束(防误改)', () => {
    expect(__TIMEOUT_MS_FOR_TESTING).toBe(30_000)
    expect(__CONCURRENCY_FOR_TESTING).toBe(3)
  })

  it('并发上限:enqueue 6 job 时 active ≤ 3,全部完成后 active=0', async () => {
    // 用 6 个 MD 文件(快速 parse 但仍有 await),概率高 capture 到 active=3 peak
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const id = await seedAsset({
        userId,
        mime: 'text/markdown',
        bytes: Buffer.from(`# concurrency test ${i}\n`, 'utf8'),
        filename: `c${i}.md`,
      })
      ids.push(id)
    }

    // 入队 + 立刻轮询 active 值,记录峰值
    let peak = 0
    for (const id of ids) enqueueExtraction({ assetId: id, userId, mime: 'text/markdown' })
    // 轮询 200ms 内的 active 数(队列处理够快但有 DB await 间隙)
    const pollStart = Date.now()
    while (Date.now() - pollStart < 200) {
      const a = __getActiveCountForTesting()
      if (a > peak) peak = a
      if (a === 0) break
      await new Promise((r) => setTimeout(r, 5))
    }
    await waitForQueueIdle()
    expect(peak).toBeLessThanOrEqual(__CONCURRENCY_FOR_TESTING)
    expect(__getActiveCountForTesting()).toBe(0)

    // 所有 job 都 done
    for (const id of ids) {
      const row = await getAsset(id)
      expect(row.extractStatus).toBe('done')
    }
  })
})
