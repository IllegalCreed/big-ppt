import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app.js'
import { createAsset } from '../src/db/deck-assets.js'
import { deckAssets, decks, getDb } from '../src/db/index.js'
import { listImageStyles, readImageStyleReference } from '../src/image-styles/registry.js'
import { useTestDb } from './_setup/test-db.js'
import { createDeckDirect, createLoggedInUser } from './_setup/factories.js'

useTestDb()

const ORIGIN = 'http://localhost:3030'

function jsonHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: ORIGIN, 'content-type': 'application/json' }
}

describe('Phase 17 style-library routes (full app mount)', () => {
  it('authenticated style-library 端点未登录 401，但 public system catalog 仍 200', async () => {
    const privateRes = await app.request('/api/decks/1/style-library')
    expect(privateRes.status).toBe(401)

    const publicRes = await app.request('/api/image-style-presets')
    expect(publicRes.status).toBe(200)
    const publicBody = await publicRes.json()
    expect(publicBody.success).toBe(true)
    expect(publicBody.presets.length).toBeGreaterThanOrEqual(12)
  })

  it('system preset 即时 materialize，GET 高亮；free 原子清 anchor', async () => {
    const { user, cookie } = await createLoggedInUser('style-system@a.com')
    const { deck } = await createDeckDirect(user.id)
    const system = listImageStyles()[0]!

    const applyRes = await app.request(`/api/decks/${deck.id}/style-library/apply`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ source: 'system', id: system.manifest.id }),
    })
    expect(applyRes.status).toBe(200)
    const applied = await applyRes.json()
    expect(applied.active).toMatchObject({
      mode: 'preset',
      styleSource: 'system',
      styleSourceId: system.manifest.id,
    })

    const [storedDeck] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId, anchorSkipped: decks.anchorSkipped })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(storedDeck?.anchorSkipped).toBe(true)
    const [anchor] = await getDb()
      .select()
      .from(deckAssets)
      .where(eq(deckAssets.id, storedDeck!.anchorAssetId!))
      .limit(1)
    expect(anchor).toMatchObject({
      deckId: deck.id,
      userId: user.id,
      purpose: 'style-preset-anchor',
      styleSource: 'system',
      styleSourceId: system.manifest.id,
      stylePalettePolicy: system.manifest.palettePolicy,
      imageWidth: 1280,
      imageHeight: 624,
    })

    const libraryRes = await app.request(`/api/decks/${deck.id}/style-library`, {
      headers: { Cookie: cookie },
    })
    expect(libraryRes.status).toBe(200)
    const library = await libraryRes.json()
    expect(library.active).toMatchObject({
      mode: 'preset',
      styleSourceId: system.manifest.id,
      anchorAssetId: anchor!.id,
    })

    const freeRes = await app.request(`/api/decks/${deck.id}/style-library/free`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    })
    expect(freeRes.status).toBe(200)
    const [freed] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId, anchorSkipped: decks.anchorSkipped })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(freed).toEqual({ anchorAssetId: null, anchorSkipped: true })
  })

  it('explore candidate 保存后可跨 deck apply；跨用户不可读；删除 preset 不破坏已应用 deck', async () => {
    const { user, cookie } = await createLoggedInUser('style-user@a.com')
    const { user: other, cookie: otherCookie } = await createLoggedInUser('style-user-other@a.com')
    const { deck: sourceDeck } = await createDeckDirect(user.id, 'Source')
    const { deck: targetDeck } = await createDeckDirect(user.id, 'Target')
    const system = listImageStyles()[0]!
    const reference = readImageStyleReference(system.manifest.id, 0)!
    const candidate = await createAsset({
      deckId: sourceDeck.id,
      userId: user.id,
      mimeType: reference.mimeType,
      data: reference.data,
      purpose: 'mood-board-candidate',
      style: 'saved editorial',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      stylePrompt: 'editorial illustration with crisp shapes',
      imageWidth: reference.width,
      imageHeight: reference.height,
    })

    const saveRes = await app.request(`/api/decks/${sourceDeck.id}/style-library/save`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ assetId: candidate.id, name: '我的编辑插画' }),
    })
    expect(saveRes.status).toBe(201)
    const saved = await saveRes.json()
    const presetId = saved.preset.id as string

    const otherImage = await app.request(`/api/style-presets/${presetId}/image`, {
      headers: { Cookie: otherCookie },
    })
    expect(otherImage.status).toBe(404)
    const crossApply = await app.request(`/api/decks/${targetDeck.id}/style-library/apply`, {
      method: 'POST',
      headers: jsonHeaders(otherCookie),
      body: JSON.stringify({ source: 'user', id: presetId }),
    })
    expect(crossApply.status).toBe(404)

    const applyRes = await app.request(`/api/decks/${targetDeck.id}/style-library/apply`, {
      method: 'POST',
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ source: 'user', id: presetId }),
    })
    expect(applyRes.status).toBe(200)
    const [target] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(eq(decks.id, targetDeck.id))
      .limit(1)
    const [targetAnchor] = await getDb()
      .select()
      .from(deckAssets)
      .where(
        and(
          eq(deckAssets.id, target!.anchorAssetId!),
          eq(deckAssets.deckId, targetDeck.id),
          eq(deckAssets.userId, user.id),
        ),
      )
      .limit(1)
    expect(targetAnchor).toMatchObject({
      styleSource: 'user',
      styleSourceId: presetId,
      purpose: 'style-preset-anchor',
    })
    expect(Buffer.from(targetAnchor!.data).equals(reference.data)).toBe(true)

    const deleteRes = await app.request(`/api/style-presets/${presetId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: ORIGIN },
    })
    expect(deleteRes.status).toBe(200)
    const [afterDelete] = await getDb()
      .select({
        purpose: deckAssets.purpose,
        source: deckAssets.styleSource,
        sourceId: deckAssets.styleSourceId,
        data: deckAssets.data,
      })
      .from(deckAssets)
      .where(eq(deckAssets.id, targetAnchor!.id))
      .limit(1)
    expect(afterDelete).toMatchObject({
      purpose: 'style-preset-anchor',
      source: 'explore',
      sourceId: targetAnchor!.id,
    })
    expect(Buffer.from(afterDelete!.data).equals(reference.data)).toBe(true)

    const afterLibrary = await app.request(`/api/decks/${targetDeck.id}/style-library`, {
      headers: { Cookie: cookie },
    })
    const afterLibraryBody = await afterLibrary.json()
    expect(afterLibraryBody.active).toMatchObject({
      mode: 'generated',
      anchorAssetId: targetAnchor!.id,
    })
    expect(afterLibraryBody.generatedCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ assetId: targetAnchor!.id })]),
    )
    expect(other.id).not.toBe(user.id)
  })

  it('并发候选共享 createdAt 时按 id 稳定排序，刷新后卡片不跳位', async () => {
    const { user, cookie } = await createLoggedInUser('style-order@a.com')
    const { deck } = await createDeckDirect(user.id)
    const reference = readImageStyleReference(listImageStyles()[0]!.manifest.id, 0)!
    const ids = [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]
    const createdAt = new Date('2026-07-11T00:00:00Z')
    await getDb()
      .insert(deckAssets)
      .values(
        ids.map((id) => ({
          id,
          deckId: deck.id,
          userId: user.id,
          mimeType: reference.mimeType,
          bytesSize: reference.data.length,
          data: reference.data,
          purpose: 'mood-board-candidate',
          style: id.slice(-1),
          styleSource: 'explore',
          styleSourceId: id,
          stylePalettePolicy: 'reference',
          stylePrompt: 'stable ordering fixture',
          imageWidth: reference.width,
          imageHeight: reference.height,
          createdAt,
        })),
      )

    const response = await app.request(`/api/decks/${deck.id}/style-library`, {
      headers: { Cookie: cookie },
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(
      body.generatedCandidates.map((candidate: { assetId: string }) => candidate.assetId),
    ).toEqual([...ids].sort())
  })
})
