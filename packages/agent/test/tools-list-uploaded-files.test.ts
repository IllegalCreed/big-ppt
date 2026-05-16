/**
 * Phase 13 Task D：list_uploaded_files 工具集成测。
 *
 * 关键覆盖:
 * - 未登录 → 失败
 * - 空 inventory → success + files:[]
 * - 多 asset 按 uploadedAt desc + summary 截到 200 字
 * - 跨用户隔离:仅返当前 user 的 asset
 */
import { describe, expect, it } from 'vitest'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { listUploadedFilesTool } from '../src/tools/local/list-uploaded-files.js'
import { runInRequest } from '../src/context.js'
import { getDb, userAssets } from '../src/db/index.js'
import { randomUUID } from 'node:crypto'

useTestDb()

const runTool = listUploadedFilesTool.exec.bind(listUploadedFilesTool)

async function insertAsset(
  userId: number,
  opts: {
    filename: string
    mime?: string
    sizeBytes?: number
    extractedText?: string | null
    extractStatus?: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
    uploadedAt?: Date
  },
): Promise<string> {
  const id = randomUUID()
  await getDb().insert(userAssets).values({
    id,
    userId,
    filename: opts.filename,
    mime: opts.mime ?? 'application/pdf',
    sizeBytes: opts.sizeBytes ?? 1024,
    sha256: 'a'.repeat(64),
    storagePath: `${userId}/${id}`,
    extractedText: opts.extractedText ?? null,
    extractStatus: opts.extractStatus ?? 'done',
    ...(opts.uploadedAt ? { uploadedAt: opts.uploadedAt } : {}),
  })
  return id
}

describe('list_uploaded_files 工具', () => {
  it('未登录 → 失败', async () => {
    const result = await runTool({})
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/未登录/)
  })

  it('空 inventory → success + files: []', async () => {
    const { user } = await createLoggedInUser('empty@a.com')
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({}),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(Array.isArray(json.files)).toBe(true)
    expect(json.files).toHaveLength(0)
  })

  it('多 asset 按 uploadedAt desc + summary 截到 200 字', async () => {
    const { user } = await createLoggedInUser('multi@a.com')
    const longText = '中文'.repeat(150) // 远超 200 字符
    const t0 = new Date(Date.now() - 60_000)
    const t1 = new Date()
    // 先插旧的(t0),再插新的(t1):desc 排序新的应该排第一
    const oldId = await insertAsset(user.id, {
      filename: 'old.pdf',
      extractedText: 'old short text',
      uploadedAt: t0,
    })
    const newId = await insertAsset(user.id, {
      filename: 'new.pdf',
      mime: 'application/pdf',
      extractedText: longText,
      uploadedAt: t1,
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({}),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.files).toHaveLength(2)
    // desc:新的排第一
    expect(json.files[0].id).toBe(newId)
    expect(json.files[1].id).toBe(oldId)
    // summary 截到 200 字
    expect(json.files[0].summary.length).toBe(200)
    expect(json.files[0].summary).toBe(longText.slice(0, 200))
    // 短文本不变
    expect(json.files[1].summary).toBe('old short text')
    // 必要字段都在
    expect(json.files[0]).toMatchObject({
      filename: 'new.pdf',
      mime: 'application/pdf',
      sizeBytes: 1024,
      extractStatus: 'done',
    })
  })

  it('跨用户隔离:仅返当前 user 的 asset', async () => {
    const { user: a } = await createLoggedInUser('iso-a@a.com')
    const { user: b } = await createLoggedInUser('iso-b@a.com')
    await insertAsset(a.id, { filename: 'a-1.pdf' })
    await insertAsset(a.id, { filename: 'a-2.pdf' })
    await insertAsset(b.id, { filename: 'b-1.pdf' })

    const aResult = await runInRequest(
      { userId: a.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({}),
    )
    const aJson = JSON.parse(aResult)
    expect(aJson.success).toBe(true)
    expect(aJson.files).toHaveLength(2)
    expect(aJson.files.every((f: { filename: string }) => f.filename.startsWith('a-'))).toBe(true)

    const bResult = await runInRequest(
      { userId: b.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({}),
    )
    const bJson = JSON.parse(bResult)
    expect(bJson.success).toBe(true)
    expect(bJson.files).toHaveLength(1)
    expect(bJson.files[0].filename).toBe('b-1.pdf')
  })
})
