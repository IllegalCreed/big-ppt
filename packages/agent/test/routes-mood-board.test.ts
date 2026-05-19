/**
 * Phase 11.8 Task C-3: mood-board 路由集成测。
 *
 * 覆盖:
 * - POST /api/decks/:id/mood-board/generate:401 / 404 / 403 / 400(空 deck) / 429(限 3 次) / 200(happy)
 * - POST /api/decks/:id/anchor:401 / 404 / 403 / 400(uuid 格式) / 400(asset 不是 candidate) / 200
 *
 * 主 LLM + generateImage 全部用 DI seam 注入 fake,**不**真打 LLM。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { moodBoardRoute, __resetMoodBoardRoutesForTesting } from '../src/routes/mood-board.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../src/crypto/apikey.js'
import { setImageLlmSettings } from '../src/db/image-llm-settings.js'
import { getDb, users, decks, deckAssets } from '../src/db/index.js'
import { createAsset } from '../src/db/deck-assets.js'
import {
  __setMainLlmCallerForTesting,
  __setGenerateImageForMoodBoardTesting,
  __resetMoodBoardTestingSeams,
} from '../src/mood-board/index.js'

useTestDb()

const FIXED_KEY = Buffer.alloc(32, 0xab)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const VALID_3 = JSON.stringify({
  samples: [
    { style: 'isometric tech', prompt: 'iso tech prompt' },
    { style: 'hand-drawn doodle', prompt: 'doodle prompt' },
    { style: 'watercolor wash', prompt: 'watercolor prompt' },
  ],
})

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  __setMasterKeyGetterForTesting(null)
})

afterEach(() => {
  __resetMoodBoardRoutesForTesting()
  __resetMoodBoardTestingSeams()
})

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api', moodBoardRoute)
  return app
}

async function seedMainLlmKey(userId: number): Promise<void> {
  const payload = JSON.stringify({
    activeProvider: 'zhipu',
    providers: { zhipu: { apiKey: 'glm-test', model: 'GLM-5.1' } },
  })
  await getDb()
    .update(users)
    .set({ llmSettings: encryptApiKey(payload) })
    .where(eq(users.id, userId))
}

async function seedReadyDeck(emailSeed: string) {
  const { user, cookie } = await createLoggedInUser(emailSeed)
  // createDeckDirect 默认 initialContent 是 `---\ntheme: seriph\n---\n\n# test`,够长
  const { deck } = await createDeckDirect(user.id, 'D')
  await seedMainLlmKey(user.id)
  await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
  return { user, cookie, deck }
}

function setupHappyMocks() {
  __setMainLlmCallerForTesting(async () => VALID_3)
  __setGenerateImageForMoodBoardTesting(
    vi.fn(async () => ({
      b64: TINY_PNG_B64,
      modelUsed: 'gpt-image-2',
      pathTaken: 'B' as const,
    })),
  )
}

describe('POST /api/decks/:id/mood-board/generate', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/decks/1/mood-board/generate', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('deck 不存在 → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('mb1@a.com')
    const res = await app.request('/api/decks/99999/mood-board/generate', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('跨 user deck → 403', async () => {
    const app = makeApp()
    const { user: owner } = await createLoggedInUser('owner-mb@a.com')
    const { deck } = await createDeckDirect(owner.id, 'OwnedByOther')
    const { cookie: intruderCookie } = await createLoggedInUser('intruder-mb@a.com')
    const res = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: intruderCookie },
    })
    expect(res.status).toBe(403)
  })

  it('deck 内容为空 → 400(应先生成大纲)', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('empty-mb@a.com')
    const { deck } = await createDeckDirect(user.id, 'EmptyDeck', '   \n\n   ')
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    setupHappyMocks()
    const res = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/deck 内容为空/)
  })

  it('happy path → 200 + 3 candidate + remaining=2', async () => {
    const app = makeApp()
    const { cookie, deck } = await seedReadyDeck('happy-mb@a.com')
    setupHappyMocks()

    const res = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.candidates).toHaveLength(3)
    expect(json.candidates[0]).toMatchObject({ style: expect.any(String), prompt: expect.any(String) })
    expect(json.remaining).toBe(2)
    expect(json.retried).toBe(false)
    expect(json.diversityDegraded).toBe(false)

    // DB 验证 3 行 candidate
    const rows = await getDb()
      .select({ purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.deckId, deck.id))
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.purpose).toBe('mood-board-candidate'))
  })

  it('限 3 次/deck:第 4 次 → 429 + remaining=0', async () => {
    const app = makeApp()
    const { cookie, deck } = await seedReadyDeck('limit-mb@a.com')
    setupHappyMocks()

    for (let i = 0; i < 3; i++) {
      const ok = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
      expect(ok.status).toBe(200)
    }

    const fourth = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(fourth.status).toBe(429)
    const json = await fourth.json()
    expect(json.remaining).toBe(0)
    expect(json.error).toMatch(/上限/)
  })

  it('生成失败也算 1 次(防滥用 retry 烧 LLM)', async () => {
    const app = makeApp()
    const { cookie, deck } = await seedReadyDeck('fail-counts@a.com')
    // 主 LLM 总崩
    __setMainLlmCallerForTesting(async () => {
      throw new Error('llm 502')
    })
    __setGenerateImageForMoodBoardTesting(async () => ({
      b64: TINY_PNG_B64,
      modelUsed: 'm',
      pathTaken: 'B' as const,
    }))

    for (let i = 0; i < 3; i++) {
      const r = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
      expect(r.status).toBe(500)
    }

    // 第 4 次仍应 429(失败也算)
    const fourth = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(fourth.status).toBe(429)
  })

  it('未配 image LLM → 500 friendly error(不到限频检查)', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('no-img@a.com')
    const { deck } = await createDeckDirect(user.id, 'D')
    await seedMainLlmKey(user.id)
    // 故意不 setImageLlmSettings

    setupHappyMocks()
    const res = await app.request(`/api/decks/${deck.id}/mood-board/generate`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/请到设置 → 生图模型/)
  })
})

describe('POST /api/decks/:id/anchor', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/decks/1/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: '11111111-1111-1111-1111-111111111111' }),
    })
    expect(res.status).toBe(401)
  })

  it('deck 不存在 → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('anchor1@a.com')
    const res = await app.request('/api/decks/99999/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: '11111111-1111-1111-1111-111111111111' }),
    })
    expect(res.status).toBe(404)
  })

  it('assetId 非 uuid 格式 → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ax@a.com')
    const { deck } = await createDeckDirect(user.id)
    const res = await app.request(`/api/decks/${deck.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: 'not-uuid' }),
    })
    expect(res.status).toBe(400)
  })

  it('asset 不存在 → 404', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ax-404@a.com')
    const { deck } = await createDeckDirect(user.id)
    const res = await app.request(`/api/decks/${deck.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.status).toBe(404)
  })

  it('跨 deck 的 asset → 403(IDOR guard)', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ax-xdeck@a.com')
    const { deck: a } = await createDeckDirect(user.id, 'A')
    const { deck: b } = await createDeckDirect(user.id, 'B')
    // 在 B 创个 candidate,但 anchor 请求指向 A
    const bAsset = await createAsset({
      deckId: b.id,
      userId: user.id,
      mimeType: 'image/png',
      data: Buffer.from(TINY_PNG_B64, 'base64'),
      purpose: 'mood-board-candidate',
    })
    const res = await app.request(`/api/decks/${a.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: bAsset.id }),
    })
    expect(res.status).toBe(403)
  })

  it('跨 user 的 asset → 403(IDOR guard)', async () => {
    const app = makeApp()
    const { user: ownerUser } = await createLoggedInUser('ax-owner@a.com')
    const { deck } = await createDeckDirect(ownerUser.id, 'OwnedByOther')
    const ownerAsset = await createAsset({
      deckId: deck.id,
      userId: ownerUser.id,
      mimeType: 'image/png',
      data: Buffer.from(TINY_PNG_B64, 'base64'),
      purpose: 'mood-board-candidate',
    })

    const { cookie: intruderCookie } = await createLoggedInUser('ax-intruder@a.com')
    const res = await app.request(`/api/decks/${deck.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: intruderCookie },
      body: JSON.stringify({ assetId: ownerAsset.id }),
    })
    // intruder 看不到 deck 本身,所以是 403(deck IDOR 优先于 asset IDOR)
    expect(res.status).toBe(403)
  })

  it('asset 不是 candidate(如已 discarded / 已 anchor / 普通图)→ 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ax-purpose@a.com')
    const { deck } = await createDeckDirect(user.id)
    // 普通图 purpose=null
    const a = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: Buffer.from(TINY_PNG_B64, 'base64'),
    })
    const res = await app.request(`/api/decks/${deck.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: a.id }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/候选/)
  })

  it('happy path:candidate → anchor + decks.anchor_asset_id 写入 + anchor_skipped 同步置 true', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('ax-happy@a.com')
    const { deck } = await createDeckDirect(user.id)
    const candidates = await Promise.all(
      [1, 2, 3].map(() =>
        createAsset({
          deckId: deck.id,
          userId: user.id,
          mimeType: 'image/png',
          data: Buffer.from(TINY_PNG_B64, 'base64'),
          purpose: 'mood-board-candidate',
        }),
      ),
    )
    const target = candidates[1]!

    const res = await app.request(`/api/decks/${deck.id}/anchor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ assetId: target.id }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, anchorAssetId: target.id })

    // decks.anchor_asset_id 写入 + anchorSkipped 同步置 true(已决策)
    const [d] = await getDb()
      .select({ anchorAssetId: decks.anchorAssetId, anchorSkipped: decks.anchorSkipped })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(d!.anchorAssetId).toBe(target.id)
    expect(d!.anchorSkipped).toBe(true)

    // 目标 asset purpose=anchor,其它两个 **保持 candidate**
    // Phase 11.8 dogfood 改:不再 discard 同批 candidate,让 picker reopen 时能显示 3 张 + 高亮
    const rows = await getDb()
      .select({ id: deckAssets.id, purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.deckId, deck.id))
    const map = Object.fromEntries(rows.map((r) => [r.id, r.purpose]))
    expect(map[target.id]).toBe('anchor')
    candidates
      .filter((c) => c.id !== target.id)
      .forEach((c) => expect(map[c.id]).toBe('mood-board-candidate'))
  })
})

describe('POST /api/decks/:id/anchor/skip', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/decks/1/anchor/skip', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('deck 不存在 → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('skip-404@a.com')
    const res = await app.request('/api/decks/99999/anchor/skip', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('跨 user deck → 403', async () => {
    const app = makeApp()
    const { user: owner } = await createLoggedInUser('skip-owner@a.com')
    const { deck } = await createDeckDirect(owner.id, 'OwnedByOther')
    const { cookie: intruderCookie } = await createLoggedInUser('skip-intruder@a.com')
    const res = await app.request(`/api/decks/${deck.id}/anchor/skip`, {
      method: 'POST',
      headers: { Cookie: intruderCookie },
    })
    expect(res.status).toBe(403)
  })

  it('happy path → 200 + decks.anchor_skipped 写 true(anchor_asset_id 不变)', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('skip-happy@a.com')
    const { deck } = await createDeckDirect(user.id)

    // 先验默认值是 false/null(nullable 后,未显式 INSERT 时 mysql 留 null;
    // Phase 11.8 application 层 null 跟 false 等价处理 = "未决策")
    const [before] = await getDb()
      .select({ anchorSkipped: decks.anchorSkipped, anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(before!.anchorSkipped).toBeFalsy()
    expect(before!.anchorAssetId).toBeNull()

    const res = await app.request(`/api/decks/${deck.id}/anchor/skip`, {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, anchorSkipped: true })

    // DB 验:anchor_skipped=true,anchor_asset_id 仍 null(不改 anchor 本身)
    const [after] = await getDb()
      .select({ anchorSkipped: decks.anchorSkipped, anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(eq(decks.id, deck.id))
      .limit(1)
    expect(after!.anchorSkipped).toBe(true)
    expect(after!.anchorAssetId).toBeNull()
  })
})
