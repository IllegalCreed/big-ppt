import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createDeckDirect, createLoggedInUser } from './_setup/factories.js'
import { createAsset } from '../src/db/deck-assets.js'
import {
  deleteUserStylePreset,
  getUserStylePreset,
  renameUserStylePreset,
  saveUserStylePresetFromAsset,
  UserStylePresetSourceError,
} from '../src/db/user-style-presets.js'
import { deckAssets, decks, getDb } from '../src/db/index.js'

useTestDb()

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf00000003000100ff0a3a630000000049454e44ae426082',
  'hex',
)

async function seedCandidate(userId: number, deckId: number) {
  return createAsset({
    userId,
    deckId,
    mimeType: 'image/png',
    data: TINY_PNG,
    purpose: 'mood-board-candidate',
    style: 'watercolor wash',
    styleSource: 'explore',
    stylePalettePolicy: 'reference',
    stylePrompt: 'soft translucent watercolor wash with visible paper grain',
    imageWidth: 1,
    imageHeight: 1,
  })
}

describe('db/user-style-presets', () => {
  it('复制候选 BLOB，重复保存幂等；删除源 deck 后 preset 仍存在', async () => {
    const { user } = await createLoggedInUser('style-save@a.com')
    const { deck } = await createDeckDirect(user.id)
    const candidate = await seedCandidate(user.id, deck.id)

    const first = await saveUserStylePresetFromAsset({
      userId: user.id,
      deckId: deck.id,
      assetId: candidate.id,
      name: '我的水彩',
    })
    const second = await saveUserStylePresetFromAsset({
      userId: user.id,
      deckId: deck.id,
      assetId: candidate.id,
      name: '不会重复创建',
    })
    expect(second.id).toBe(first.id)
    expect(first.name).toBe('我的水彩')
    expect(Buffer.from(first.data).equals(TINY_PNG)).toBe(true)

    await getDb().delete(decks).where(eq(decks.id, deck.id))
    const afterDeckDelete = await getUserStylePreset(user.id, first.id)
    expect(afterDeckDelete?.id).toBe(first.id)
    expect(Buffer.from(afterDeckDelete!.data).equals(TINY_PNG)).toBe(true)
  })

  it('保存源 asset 强制 assetId + deckId + userId，跨 deck 拒绝', async () => {
    const { user } = await createLoggedInUser('style-idor@a.com')
    const { deck: a } = await createDeckDirect(user.id, 'A')
    const { deck: b } = await createDeckDirect(user.id, 'B')
    const candidate = await seedCandidate(user.id, b.id)

    await expect(
      saveUserStylePresetFromAsset({
        userId: user.id,
        deckId: a.id,
        assetId: candidate.id,
      }),
    ).rejects.toBeInstanceOf(UserStylePresetSourceError)
  })

  it('rename/delete 只作用 owner；删除 preset 后 materialized copy 降为 explore 但 BLOB/purpose 不变', async () => {
    const { user: owner } = await createLoggedInUser('style-owner@a.com')
    const { user: other } = await createLoggedInUser('style-other@a.com')
    const { deck } = await createDeckDirect(owner.id)
    const candidate = await seedCandidate(owner.id, deck.id)
    const preset = await saveUserStylePresetFromAsset({
      userId: owner.id,
      deckId: deck.id,
      assetId: candidate.id,
    })
    await getDb()
      .update(deckAssets)
      .set({ purpose: 'style-preset-anchor' })
      .where(and(eq(deckAssets.id, candidate.id), eq(deckAssets.deckId, deck.id)))

    expect(await renameUserStylePreset(other.id, preset.id, '越权')).toBe(false)
    expect(await deleteUserStylePreset(other.id, preset.id)).toBe(false)
    expect(await renameUserStylePreset(owner.id, preset.id, '新名字')).toBe(true)
    expect((await getUserStylePreset(owner.id, preset.id))?.name).toBe('新名字')

    expect(await deleteUserStylePreset(owner.id, preset.id)).toBe(true)
    expect(await getUserStylePreset(owner.id, preset.id)).toBeNull()
    const [copy] = await getDb()
      .select({
        purpose: deckAssets.purpose,
        source: deckAssets.styleSource,
        sourceId: deckAssets.styleSourceId,
        data: deckAssets.data,
      })
      .from(deckAssets)
      .where(eq(deckAssets.id, candidate.id))
      .limit(1)
    expect(copy).toMatchObject({
      purpose: 'style-preset-anchor',
      source: 'explore',
      sourceId: candidate.id,
    })
    expect(Buffer.from(copy!.data).equals(TINY_PNG)).toBe(true)
  })
})
