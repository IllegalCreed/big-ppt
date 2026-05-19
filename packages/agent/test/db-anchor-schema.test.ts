/**
 * Phase 11.8 Task A:验证 anchor 三列(decks.anchor_asset_id / deck_versions.anchor_asset_id /
 * deck_assets.purpose)落库 + helpers(setAnchor / clearDeckAnchor / restoreDeckAnchor /
 * listMoodBoardCandidates) 状态机正确。
 *
 * 不在本测试范围:routes 层 / template-switch / restore 端点联动(由 Task A 后续 Task 各自加测,
 * 本文件只测 DB 层)。
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { getDb, decks, deckVersions, deckAssets } from '../src/db/index.js'
import {
  createAsset,
  getAsset,
  listMoodBoardCandidates,
  markAsAnchor,
  clearDeckAnchor,
  restoreDeckAnchor,
  discardAssets,
} from '../src/db/deck-assets.js'

useTestDb()

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf00000003000100ff0a3a630000000049454e44ae426082',
  'hex',
)

describe('Phase 11.8 anchor schema + helpers', () => {
  describe('schema 列存在 + 默认 NULL', () => {
    it('decks.anchor_asset_id 列存在、新建 deck 默认 NULL', async () => {
      const { user } = await createLoggedInUser('schema1@a.com')
      const { deck } = await createDeckDirect(user.id)
      const [row] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(row).toBeDefined()
      expect(row!.anchorAssetId).toBeNull()
    })

    it('deck_versions.anchor_asset_id 列存在、initial version 默认 NULL', async () => {
      const { user } = await createLoggedInUser('schema2@a.com')
      const { initialVersionId } = await createDeckDirect(user.id)
      const [v] = await getDb()
        .select({ anchorAssetId: deckVersions.anchorAssetId })
        .from(deckVersions)
        .where(eq(deckVersions.id, initialVersionId))
        .limit(1)
      expect(v).toBeDefined()
      expect(v!.anchorAssetId).toBeNull()
    })

    it('deck_assets.purpose 列存在、createAsset 不传时默认 NULL', async () => {
      const { user } = await createLoggedInUser('schema3@a.com')
      const { deck } = await createDeckDirect(user.id)
      const { id } = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
      })
      const got = await getAsset(id)
      expect(got).toBeTruthy()
      expect(got!.purpose).toBeNull()
    })

    it('createAsset 接 purpose 参数,落库正确', async () => {
      const { user } = await createLoggedInUser('schema4@a.com')
      const { deck } = await createDeckDirect(user.id)
      const { id } = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })
      const got = await getAsset(id)
      expect(got!.purpose).toBe('mood-board-candidate')
    })
  })

  describe('listMoodBoardCandidates', () => {
    it('仅返本 deck purpose=candidate 的行,不返 BLOB(轻查询)', async () => {
      const { user } = await createLoggedInUser('list@a.com')
      const { deck } = await createDeckDirect(user.id)
      const { deck: other } = await createDeckDirect(user.id, 'Other')

      const c1 = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        prompt: 'flat geo',
        purpose: 'mood-board-candidate',
      })
      const c2 = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        prompt: 'soft water',
        purpose: 'mood-board-candidate',
      })
      // 同 deck 但 purpose 非 candidate(普通生图) — 不应被列出
      await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: undefined,
      })
      // 别的 deck 的 candidate — 不应被列出
      await createAsset({
        deckId: other.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })

      const got = await listMoodBoardCandidates(deck.id)
      expect(got).toHaveLength(2)
      expect(new Set(got.map((r) => r.id))).toEqual(new Set([c1.id, c2.id]))
      // 不应包含 BLOB 字段
      expect((got[0] as unknown as { data?: unknown }).data).toBeUndefined()
      // 必须包含 mimeType + prompt(给前端显示用)
      expect(got[0]!.mimeType).toBe('image/png')
      expect(got.map((r) => r.prompt).sort()).toEqual(['flat geo', 'soft water'])
    })
  })

  describe('markAsAnchor 状态机', () => {
    it('选 1 个 candidate → 该 asset.purpose=anchor、其它 candidate **保持 candidate**、deck.anchor 写入(Phase 11.8 dogfood 改:不再破坏同批其他候选,让 picker reopen 能显示 3 张 + 高亮)', async () => {
      const { user } = await createLoggedInUser('mark@a.com')
      const { deck } = await createDeckDirect(user.id)
      const a = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })
      const b = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })
      const c = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })

      await markAsAnchor(deck.id, b.id)

      const [aRow, bRow, cRow] = await Promise.all([
        getAsset(a.id),
        getAsset(b.id),
        getAsset(c.id),
      ])
      expect(aRow!.purpose).toBe('mood-board-candidate')
      expect(bRow!.purpose).toBe('anchor')
      expect(cRow!.purpose).toBe('mood-board-candidate')

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBe(b.id)
    })

    it('已有 anchor 的 deck 选新 anchor → 旧 anchor **降回 candidate**、新 anchor 顶上(Phase 11.8 dogfood 改:旧 anchor 不再 discard,让重选可逆 + reopen 仍能看到 3 张)', async () => {
      const { user } = await createLoggedInUser('repick@a.com')
      const { deck } = await createDeckDirect(user.id)
      // 已有 anchor
      const oldAnchor = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'anchor',
      })
      await getDb()
        .update(decks)
        .set({ anchorAssetId: oldAnchor.id })
        .where(eq(decks.id, deck.id))

      // 新 candidate
      const newCandidate = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })

      await markAsAnchor(deck.id, newCandidate.id)

      const [oldRow, newRow] = await Promise.all([
        getAsset(oldAnchor.id),
        getAsset(newCandidate.id),
      ])
      expect(oldRow!.purpose).toBe('mood-board-candidate')
      expect(newRow!.purpose).toBe('anchor')

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBe(newCandidate.id)
    })
  })

  describe('clearDeckAnchor', () => {
    it('清空 → deck.anchor=NULL + 旧 anchor asset 改 discarded', async () => {
      const { user } = await createLoggedInUser('clear@a.com')
      const { deck } = await createDeckDirect(user.id)
      const a = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'anchor',
      })
      await getDb().update(decks).set({ anchorAssetId: a.id }).where(eq(decks.id, deck.id))

      await clearDeckAnchor(deck.id)

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBeNull()
      const row = await getAsset(a.id)
      expect(row!.purpose).toBe('mood-board-discarded')
    })

    it('deck 无 anchor 时 clear 是 no-op,不抛错', async () => {
      const { user } = await createLoggedInUser('clear-noop@a.com')
      const { deck } = await createDeckDirect(user.id)
      await expect(clearDeckAnchor(deck.id)).resolves.toBeUndefined()
    })
  })

  describe('restoreDeckAnchor', () => {
    it('指向同 deck 的 asset → 写入 decks.anchor_asset_id,不动 purpose', async () => {
      const { user } = await createLoggedInUser('restore@a.com')
      const { deck } = await createDeckDirect(user.id)
      const a = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-discarded', // 历史上被 discarded 过,restore 应能恢复指向
      })

      await restoreDeckAnchor(deck.id, a.id)

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBe(a.id)
      // purpose 不应被 restore 改(它是 version snapshot 的反向恢复,不走状态机)
      const row = await getAsset(a.id)
      expect(row!.purpose).toBe('mood-board-discarded')
    })

    it('指向 NULL → 清空 decks.anchor_asset_id', async () => {
      const { user } = await createLoggedInUser('restore-null@a.com')
      const { deck } = await createDeckDirect(user.id)
      const a = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'anchor',
      })
      await getDb().update(decks).set({ anchorAssetId: a.id }).where(eq(decks.id, deck.id))

      await restoreDeckAnchor(deck.id, null)

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBeNull()
    })

    it('指向已不存在的 assetId → 静默清空,不留脏指针', async () => {
      const { user } = await createLoggedInUser('restore-stale@a.com')
      const { deck } = await createDeckDirect(user.id)
      // 不存在的 uuid
      await restoreDeckAnchor(deck.id, '00000000-0000-0000-0000-000000000000')

      const [d] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, deck.id))
        .limit(1)
      expect(d!.anchorAssetId).toBeNull()
    })

    it('指向跨 deck 的 assetId → 视为不存在,静默清空(防 cross-deck 注入)', async () => {
      const { user } = await createLoggedInUser('restore-xdeck@a.com')
      const { deck: a } = await createDeckDirect(user.id, 'A')
      const { deck: b } = await createDeckDirect(user.id, 'B')
      const bAsset = await createAsset({
        deckId: b.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'anchor',
      })

      await restoreDeckAnchor(a.id, bAsset.id)

      const [da] = await getDb()
        .select({ anchorAssetId: decks.anchorAssetId })
        .from(decks)
        .where(eq(decks.id, a.id))
        .limit(1)
      expect(da!.anchorAssetId).toBeNull()
    })
  })

  describe('discardAssets', () => {
    it('批量改 purpose=discarded', async () => {
      const { user } = await createLoggedInUser('discard@a.com')
      const { deck } = await createDeckDirect(user.id)
      const a = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })
      const b = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: TINY_PNG,
        purpose: 'mood-board-candidate',
      })
      await discardAssets([a.id, b.id])
      const [ar, br] = await Promise.all([getAsset(a.id), getAsset(b.id)])
      expect(ar!.purpose).toBe('mood-board-discarded')
      expect(br!.purpose).toBe('mood-board-discarded')
    })

    it('空数组 → no-op', async () => {
      await expect(discardAssets([])).resolves.toBeUndefined()
    })
  })

  describe('cascade FK', () => {
    it('删 deck 行后 candidate/anchor asset 全部自动消失(走 deck_assets.deckId FK cascade)', async () => {
      const { user } = await createLoggedInUser('cascade@a.com')
      const { deck } = await createDeckDirect(user.id)
      const candId = (
        await createAsset({
          deckId: deck.id,
          userId: user.id,
          mimeType: 'image/png',
          data: TINY_PNG,
          purpose: 'mood-board-candidate',
        })
      ).id
      const anchorId = (
        await createAsset({
          deckId: deck.id,
          userId: user.id,
          mimeType: 'image/png',
          data: TINY_PNG,
          purpose: 'anchor',
        })
      ).id

      await getDb().delete(decks).where(eq(decks.id, deck.id))

      const [c1, c2] = await Promise.all([
        getDb().select().from(deckAssets).where(eq(deckAssets.id, candId)).limit(1),
        getDb().select().from(deckAssets).where(eq(deckAssets.id, anchorId)).limit(1),
      ])
      expect(c1).toHaveLength(0)
      expect(c2).toHaveLength(0)
    })
  })
})
