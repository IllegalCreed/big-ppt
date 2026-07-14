import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { app } from '../src/app.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../src/crypto/apikey.js'
import { createAsset } from '../src/db/deck-assets.js'
import { setImageLlmSettings } from '../src/db/image-llm-settings.js'
import { deckAssets, decks, getDb, users } from '../src/db/index.js'
import { listImageStyles, readImageStyleReference } from '../src/image-styles/registry.js'
import {
  __resetMoodBoardTestingSeams,
  __setGenerateImageForMoodBoardTesting,
  __setMainLlmCallerForTesting,
} from '../src/mood-board/index.js'
import { useTestDb } from './_setup/test-db.js'
import { createDeckDirect, createLoggedInUser } from './_setup/factories.js'

useTestDb()

const FIXED_KEY = Buffer.alloc(32, 0xc7)
const ORIGIN = 'http://localhost:3030'
const VALID_3 = JSON.stringify({
  samples: [
    { style: 'editorial flat', prompt: 'editorial business subject' },
    { style: 'soft watercolor', prompt: 'watercolor business subject' },
    { style: 'isometric clay', prompt: 'isometric business subject' },
  ],
})

beforeAll(() => __setMasterKeyGetterForTesting(() => FIXED_KEY))
afterAll(() => __setMasterKeyGetterForTesting(null))
afterEach(() => __resetMoodBoardTestingSeams())

async function seedReadyDeck(email: string) {
  const { user, cookie } = await createLoggedInUser(email)
  const { deck } = await createDeckDirect(user.id)
  await getDb()
    .update(users)
    .set({
      llmSettings: encryptApiKey(
        JSON.stringify({
          activeProvider: 'zhipu',
          providers: { zhipu: { apiKey: 'main-test', model: 'GLM-5.1' } },
        }),
      ),
    })
    .where(eq(users.id, user.id))
  await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'image-test' })
  return { user, cookie, deck }
}

async function waitForDraw(
  deckId: number,
  cookie: string,
  terminal: 'done' | 'failed',
): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const response = await app.request(`/api/decks/${deckId}/style-library`, {
      headers: { Cookie: cookie },
    })
    const body = await response.json()
    if (body.draw.state === terminal) return body
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`draw did not reach ${terminal}`)
}

describe('Phase 17 style exploration background job', () => {
  it('POST 202 后后台 single-flight；完成才替换旧 candidates，当前 anchor 保留', async () => {
    const { user, cookie, deck } = await seedReadyDeck('style-job@a.com')
    const system = listImageStyles()[0]!
    const reference = readImageStyleReference(system.manifest.id, 0)!
    const anchor = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: reference.mimeType,
      data: reference.data,
      purpose: 'anchor',
      style: 'existing anchor',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      imageWidth: reference.width,
      imageHeight: reference.height,
    })
    const oldCandidate = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: reference.mimeType,
      data: reference.data,
      purpose: 'mood-board-candidate',
      style: 'old candidate',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      imageWidth: reference.width,
      imageHeight: reference.height,
    })
    await getDb()
      .update(decks)
      .set({ anchorAssetId: anchor.id, anchorSkipped: true })
      .where(eq(decks.id, deck.id))

    __setMainLlmCallerForTesting(async () => VALID_3)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    __setGenerateImageForMoodBoardTesting(
      vi.fn(async () => {
        await gate
        return {
          b64: reference.data.toString('base64'),
          modelUsed: 'stub-image',
          pathTaken: 'B' as const,
        }
      }),
    )

    const first = await app.request(`/api/decks/${deck.id}/style-library/explore`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    })
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ state: 'running', jobId: expect.any(String) })

    const duplicate = await app.request(`/api/decks/${deck.id}/style-library/explore`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    })
    expect(duplicate.status).toBe(409)

    // While running nothing destructive happened.
    expect(
      (await getDb().select().from(deckAssets).where(eq(deckAssets.id, oldCandidate.id)))[0]
        ?.purpose,
    ).toBe('mood-board-candidate')
    release()
    const library = await waitForDraw(deck.id, cookie, 'done')
    expect(library.generatedCandidates).toHaveLength(4) // active anchor + new batch of three
    expect(library.remainingExplorations).toBe(2)

    const [storedDeck] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(storedDeck?.anchorAssetId).toBe(anchor.id)
    const [discardedOld] = await getDb()
      .select({ purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.id, oldCandidate.id))
      .limit(1)
    expect(discardedOld?.purpose).toBe('mood-board-discarded')
  })

  it('探索失败不清当前 anchor 或旧候选', async () => {
    const { user, cookie, deck } = await seedReadyDeck('style-job-fail@a.com')
    const system = listImageStyles()[0]!
    const reference = readImageStyleReference(system.manifest.id, 0)!
    const anchor = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: reference.mimeType,
      data: reference.data,
      purpose: 'anchor',
      style: 'existing anchor',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      imageWidth: reference.width,
      imageHeight: reference.height,
    })
    const oldCandidate = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: reference.mimeType,
      data: reference.data,
      purpose: 'mood-board-candidate',
      style: 'old candidate',
      styleSource: 'explore',
      stylePalettePolicy: 'reference',
      imageWidth: reference.width,
      imageHeight: reference.height,
    })
    await getDb()
      .update(decks)
      .set({ anchorAssetId: anchor.id, anchorSkipped: true })
      .where(eq(decks.id, deck.id))
    __setMainLlmCallerForTesting(async () => VALID_3)
    __setGenerateImageForMoodBoardTesting(async () => {
      throw new Error('provider unavailable')
    })

    const response = await app.request(`/api/decks/${deck.id}/style-library/explore`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    })
    expect(response.status).toBe(202)
    await waitForDraw(deck.id, cookie, 'failed')

    const [storedDeck] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(storedDeck?.anchorAssetId).toBe(anchor.id)
    const [old] = await getDb()
      .select({ purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.id, oldCandidate.id))
      .limit(1)
    expect(old?.purpose).toBe('mood-board-candidate')
  })
})
