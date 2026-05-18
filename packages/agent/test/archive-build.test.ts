/**
 * Phase 15 Task 31-B:buildArchive 单测。
 *
 * 用真 DB + 真 jszip,不 mock —— 测的就是「DB + zip 序列化 + manifest 字段」端到端正确。
 *
 * 覆盖:
 * - 2 PNG asset → manifest.assets / content.md / assets/<id>.png 字节都对
 * - 无 currentVersion 的 deck → content.md = 空串,manifest 合法
 * - 跨用户 → 抛 'deck-not-found-or-forbidden'
 */
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  CURRENT_SCHEMA_VERSION,
  type ArchiveManifest,
} from '@big-ppt/shared'
import { getDb, decks } from '../src/db/index.js'
import { eq } from 'drizzle-orm'
import { buildArchive } from '../src/archive/build-archive.js'
import { createAsset } from '../src/db/deck-assets.js'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

// 1KB PNG-ish payload(实际不是合法 PNG,但 createAsset 不校 magic header)
function fakePng(seed: number): Buffer {
  const buf = Buffer.alloc(1024)
  for (let i = 0; i < buf.length; i++) buf[i] = (i + seed) & 0xff
  return buf
}

describe('buildArchive', () => {
  it('happy:2 asset → manifest + content + assets 字节全对', async () => {
    const { user } = await createTestUser('build@a.com')
    const content = '---\ntitle: my deck\n---\n\n# slide one\n\n---\n\n# slide two'
    const { deck } = await createDeckDirect(user.id, 'My Deck', content)

    const png1 = fakePng(1)
    const png2 = fakePng(99)
    const { id: id1 } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: png1,
      prompt: 'a cat',
      model: 'gpt-image-1',
    })
    const { id: id2 } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: png2,
    })

    const buf = await buildArchive({ deckId: deck.id, userId: user.id })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)

    // 解 zip 校字段
    const zip = await JSZip.loadAsync(buf)
    const manifestStr = await zip.file('manifest.json')!.async('string')
    const manifest: ArchiveManifest = JSON.parse(manifestStr)

    expect(manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(manifest.lumideckVersion).toBe('0.1.0')
    expect(typeof manifest.exportedAt).toBe('string')
    expect(new Date(manifest.exportedAt).toString()).not.toBe('Invalid Date')
    expect(manifest.deck.originalDeckId).toBe(deck.id)
    expect(manifest.deck.title).toBe('My Deck')
    expect(manifest.deck.templateId).toBe(deck.templateId)
    expect(manifest.deck.createdAt).toBe(deck.createdAt.toISOString())
    expect(manifest.deck.updatedAt).toBe(deck.updatedAt.toISOString())

    // assets 顺序未约束,按 id 排序对比
    const sortedManifestAssets = [...manifest.assets].sort((a, b) => a.id.localeCompare(b.id))
    const sortedExpected = [
      { id: id1, mimeType: 'image/png', bytesSize: png1.length, prompt: 'a cat', model: 'gpt-image-1' },
      { id: id2, mimeType: 'image/png', bytesSize: png2.length, prompt: null, model: null },
    ].sort((a, b) => a.id.localeCompare(b.id))
    expect(sortedManifestAssets).toEqual(sortedExpected)

    // content.md byte-equal
    const contentInZip = await zip.file('content.md')!.async('string')
    expect(contentInZip).toBe(content)

    // assets/<id>.png 字节相等
    const bytes1 = await zip.file(`assets/${id1}.png`)!.async('nodebuffer')
    expect(bytes1.equals(png1)).toBe(true)
    const bytes2 = await zip.file(`assets/${id2}.png`)!.async('nodebuffer')
    expect(bytes2.equals(png2)).toBe(true)
  })

  it('无 currentVersion(全空 deck)→ content.md 空串、assets 数组空', async () => {
    const { user } = await createTestUser('empty@a.com')
    const db = getDb()
    await db.insert(decks).values({ userId: user.id, title: 'Empty Deck' })
    const [deck] = await db
      .select()
      .from(decks)
      .where(eq(decks.userId, user.id))
      .limit(1)
    expect(deck).toBeDefined()
    expect(deck!.currentVersionId).toBeNull()

    const buf = await buildArchive({ deckId: deck!.id, userId: user.id })
    const zip = await JSZip.loadAsync(buf)
    const manifest: ArchiveManifest = JSON.parse(
      await zip.file('manifest.json')!.async('string'),
    )
    expect(manifest.assets).toEqual([])
    const content = await zip.file('content.md')!.async('string')
    expect(content).toBe('')
  })

  it('跨用户访问 → 抛 deck-not-found-or-forbidden', async () => {
    const { user: a } = await createTestUser('owner@a.com')
    const { user: b } = await createTestUser('intruder@a.com')
    const { deck } = await createDeckDirect(a.id, "A's deck", '# only-mine')

    await expect(buildArchive({ deckId: deck.id, userId: b.id })).rejects.toThrow(
      'deck-not-found-or-forbidden',
    )
  })

  it('不存在的 deckId → 抛 deck-not-found-or-forbidden(不区分 404 vs 403)', async () => {
    const { user } = await createTestUser('ghost@a.com')
    await expect(buildArchive({ deckId: 999_999, userId: user.id })).rejects.toThrow(
      'deck-not-found-or-forbidden',
    )
  })

  it('未知 MIME type asset → 落 .bin 扩展名', async () => {
    const { user } = await createTestUser('mime@a.com')
    const { deck } = await createDeckDirect(user.id, 'MIME Test', '# x')
    const blob = Buffer.from('binary blob')
    const { id } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'application/x-weird',
      data: blob,
    })
    const buf = await buildArchive({ deckId: deck.id, userId: user.id })
    const zip = await JSZip.loadAsync(buf)
    expect(zip.file(`assets/${id}.bin`)).not.toBeNull()
    const bytes = await zip.file(`assets/${id}.bin`)!.async('nodebuffer')
    expect(bytes.equals(blob)).toBe(true)
  })
})
