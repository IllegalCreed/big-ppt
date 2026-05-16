/** Phase 13 Task E：buildUserAssetsInventory 集成测(真 DB)。 */
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser } from './_setup/factories.js'
import { getDb, userAssets } from '../src/db/index.js'
import { buildUserAssetsInventory } from '../src/prompts/buildSystemPrompt.js'

useTestDb()

async function insertAsset(
  userId: number,
  opts: {
    filename: string
    mime?: string
    sizeBytes?: number
    extractedText?: string | null
    extractStatus?: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
    extractErrorMsg?: string | null
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
    extractErrorMsg: opts.extractErrorMsg ?? null,
    ...(opts.uploadedAt ? { uploadedAt: opts.uploadedAt } : {}),
  })
  return id
}

describe('buildUserAssetsInventory', () => {
  it('无 asset → 返空字符串(不附冗余段)', async () => {
    const { user } = await createTestUser('empty@a.com')
    const inv = await buildUserAssetsInventory(user.id, 'anthropic', 'claude-opus-4-7')
    expect(inv).toBe('')
  })

  it('支持图片的 LLM(claude-opus-4-7) + 有 asset → 含 ✓ 支持图片', async () => {
    const { user } = await createTestUser('mm@a.com')
    await insertAsset(user.id, {
      filename: 'spec.pdf',
      mime: 'application/pdf',
      sizeBytes: 2048,
      extractedText: '一'.repeat(200),
      extractStatus: 'done',
    })
    const inv = await buildUserAssetsInventory(user.id, 'anthropic', 'claude-opus-4-7')
    expect(inv).toContain('用户已上传的参考素材')
    expect(inv).toContain('spec.pdf')
    expect(inv).toContain('list_uploaded_files')
    expect(inv).toContain('read_uploaded_file')
    expect(inv).toContain('✓ 支持图片')
    expect(inv).toContain('anthropic/claude-opus-4-7')
  })

  it('非多模态 LLM(zhipu/glm-5.1) + 有 asset → 含 ✗ 不支持图片 + 切换提示', async () => {
    const { user } = await createTestUser('nm@a.com')
    await insertAsset(user.id, {
      filename: 'pic.png',
      mime: 'image/png',
      sizeBytes: 5120,
      extractStatus: 'skipped',
    })
    const inv = await buildUserAssetsInventory(user.id, 'zhipu', 'glm-5.1')
    expect(inv).toContain('✗ 不支持图片')
    expect(inv).toContain('图片类,需 multi-modal LLM')
    // 切换提示来自 getSupportedMultiModalHint(),含 "Claude" / "Gemini" 等
    expect(inv).toMatch(/Claude|Gemini|GPT-4o/)
  })

  it('inventory 含 filename / mime / size / extract status hint', async () => {
    const { user } = await createTestUser('detail@a.com')
    await insertAsset(user.id, {
      filename: 'pending.pdf',
      mime: 'application/pdf',
      sizeBytes: 1024 * 1024 * 2,
      extractStatus: 'pending',
    })
    await insertAsset(user.id, {
      filename: 'failed.pdf',
      mime: 'application/pdf',
      sizeBytes: 800,
      extractStatus: 'failed',
      extractErrorMsg: 'parser crashed',
    })
    const inv = await buildUserAssetsInventory(user.id, 'openai', 'gpt-4o')
    expect(inv).toContain('pending.pdf')
    expect(inv).toContain('failed.pdf')
    expect(inv).toContain('2.00MB')
    expect(inv).toContain('800B')
    expect(inv).toContain('抽取中')
    expect(inv).toContain('抽取失败:parser crashed')
  })

  it('超过 20 个 asset → 仅显示前 20 + "+N more" 尾标', async () => {
    const { user } = await createTestUser('many@a.com')
    // 注:helper 用 limit(MAX+1=21) 只为「检测是否有 more」,因此实际 fetched=21,
    // 「共 21 个」+「+1 more」——这是有意的 token 控制(让 LLM 调 list_uploaded_files
    // 拿全列表,而非把 25 条全塞进 system prompt)。25 个用 insertAsset helper 沿用
    // 既有 fixture 模式,filename desc 顺序由 uploadedAt 控制。
    const baseTime = Date.now()
    for (let i = 0; i < 25; i++) {
      await insertAsset(user.id, {
        filename: `file-${String(i).padStart(2, '0')}.pdf`,
        sizeBytes: 100,
        extractedText: 'x',
        extractStatus: 'done',
        uploadedAt: new Date(baseTime - i * 1000),
      })
    }
    const inv = await buildUserAssetsInventory(user.id, 'openai', 'gpt-4o')
    expect(inv).toContain('file-00.pdf') // 最新
    expect(inv).toContain('file-19.pdf') // 第 20 条仍展示
    expect(inv).not.toContain('file-20.pdf') // 超过截断窗口
    expect(inv).toMatch(/\+\d+ more/) // 有 more 尾标
    expect(inv).toContain('list_uploaded_files 拿全列表')
  })
})
