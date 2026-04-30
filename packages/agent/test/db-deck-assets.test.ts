/**
 * Phase 11.5 Task B：deck_assets DB helper 测试。
 */
import { describe, expect, it } from 'vitest'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import {
  createAsset,
  getAsset,
  deleteAssetsByDeck,
  listAssetIdsByDeck,
} from '../src/db/deck-assets.js'

useTestDb()

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf00000003000100ff0a3a630000000049454e44ae426082',
  'hex',
)

describe('db/deck-assets', () => {
  it('createAsset → getAsset：字节相等 + 元数据一致', async () => {
    const { user } = await createLoggedInUser('owner@a.com')
    const { deck } = await createDeckDirect(user.id)
    const { id } = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: TINY_PNG,
      prompt: 'a cyberpunk city',
      model: 'gpt-image-2',
    })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const got = await getAsset(id)
    expect(got).toBeTruthy()
    expect(got!.deckId).toBe(deck.id)
    expect(got!.userId).toBe(user.id)
    expect(got!.mimeType).toBe('image/png')
    expect(got!.bytesSize).toBe(TINY_PNG.length)
    expect(Buffer.from(got!.data).equals(TINY_PNG)).toBe(true)
    expect(got!.prompt).toBe('a cyberpunk city')
    expect(got!.model).toBe('gpt-image-2')
  })

  it('getAsset：不存在返 null', async () => {
    const got = await getAsset('00000000-0000-0000-0000-000000000000')
    expect(got).toBeNull()
  })

  it('deleteAssetsByDeck：清掉指定 deck 全部 asset,其他 deck 不动', async () => {
    const { user } = await createLoggedInUser('multi@a.com')
    const { deck: a } = await createDeckDirect(user.id, 'A')
    const { deck: b } = await createDeckDirect(user.id, 'B')
    const a1 = await createAsset({ deckId: a.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })
    const a2 = await createAsset({ deckId: a.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })
    const b1 = await createAsset({ deckId: b.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })

    await deleteAssetsByDeck(a.id)

    expect(await getAsset(a1.id)).toBeNull()
    expect(await getAsset(a2.id)).toBeNull()
    expect(await getAsset(b1.id)).not.toBeNull()
  })

  it('listAssetIdsByDeck：仅返本 deck 的 id 列表', async () => {
    const { user } = await createLoggedInUser('list@a.com')
    const { deck } = await createDeckDirect(user.id)
    const { id: a } = await createAsset({ deckId: deck.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })
    const { id: b } = await createAsset({ deckId: deck.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })
    const ids = await listAssetIdsByDeck(deck.id)
    expect(new Set(ids)).toEqual(new Set([a, b]))
  })

  it('cascade(decks ON DELETE)：删 deck 行后 asset 自动消失', async () => {
    // 注意:这里我们走 hard delete(直接 db.delete)模拟级联,
    // 实际生产的 routes/decks.ts 是 soft delete(由 Task G 显式调 deleteAssetsByDeck)。
    const { user } = await createLoggedInUser('cas@a.com')
    const { deck } = await createDeckDirect(user.id)
    const { id } = await createAsset({ deckId: deck.id, userId: user.id, mimeType: 'image/png', data: TINY_PNG })
    expect(await getAsset(id)).not.toBeNull()
    const { getDb, decks } = await import('../src/db/index.js')
    const { eq } = await import('drizzle-orm')
    await getDb().delete(decks).where(eq(decks.id, deck.id))
    expect(await getAsset(id)).toBeNull()
  })
})
