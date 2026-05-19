/**
 * Phase 11.8 Task B-2: mood-board/index.ts orchestration 集成测。
 *
 * 关键覆盖:
 * - happy path: 主 LLM 返 3 个差异化 prompt → 出 3 图 → 3 candidate 落库 + purpose='mood-board-candidate'
 * - retry: 第一轮 style 雷同 → 触发 retry → 第二轮通过
 * - diversity-degraded: retry 仍雷同接受降级,不抛错
 * - main LLM 错误: 抛 MoodBoardGenError
 * - 主 LLM 返非法 JSON: 抛 MoodBoardGenError
 * - 任一图失败: 已落 candidate 标 discarded + 抛 MoodBoardGenError
 * - 未配 image LLM: 友好错
 * - 未配主 LLM: 友好错
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting } from '../src/crypto/apikey.js'
import { encryptApiKey } from '../src/crypto/apikey.js'
import { setImageLlmSettings } from '../src/db/image-llm-settings.js'
import { getDb, users, deckAssets } from '../src/db/index.js'
import {
  generateMoodBoard,
  MoodBoardGenError,
  __setMainLlmCallerForTesting,
  __setGenerateImageForMoodBoardTesting,
  __resetMoodBoardTestingSeams,
} from '../src/mood-board/index.js'

useTestDb()

const FIXED_KEY = Buffer.alloc(32, 0x4f)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const VALID_3_SAMPLES = JSON.stringify({
  samples: [
    { style: 'isometric tech', prompt: 'An isometric tech illustration of an AI system.' },
    { style: 'hand-drawn doodle', prompt: 'A whimsical hand-drawn doodle showing AI concepts.' },
    { style: 'watercolor wash', prompt: 'A soft watercolor painting of an AI workflow.' },
  ],
})

/** 主 LLM 返雷同 styles(都共享 'flat')触发 retry */
const FLAT_DUPLICATE_SAMPLES = JSON.stringify({
  samples: [
    { style: 'flat infographic', prompt: 'Flat infographic about AI.' },
    { style: 'flat geometric', prompt: 'Flat geometric AI illustration.' },
    { style: 'flat illustration', prompt: 'Flat illustration of AI systems.' },
  ],
})

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  __setMasterKeyGetterForTesting(null)
})

afterEach(() => {
  // 必须复位 DI seam 防跨文件污染(CLAUDE.md 测试基建条 2)
  __resetMoodBoardTestingSeams()
})

async function seedMainLlmKey(userId: number): Promise<void> {
  const payload = JSON.stringify({
    activeProvider: 'zhipu',
    providers: { zhipu: { apiKey: 'glm-x', model: 'GLM-5.1' } },
  })
  await getDb()
    .update(users)
    .set({ llmSettings: encryptApiKey(payload) })
    .where(eq(users.id, userId))
}

function makeFakeGenerateImage(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    b64: TINY_PNG_B64,
    modelUsed: 'gpt-image-2',
    pathTaken: 'B' as const,
  }))
}

describe('generateMoodBoard happy path', () => {
  it('主 LLM 返 3 差异化 prompt → 3 candidate 落库 + purpose=mood-board-candidate', async () => {
    const { user } = await createLoggedInUser('happy@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const llmFake = vi.fn(async () => VALID_3_SAMPLES)
    const imgFake = makeFakeGenerateImage()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(imgFake)

    const out = await generateMoodBoard({
      deckId: deck.id,
      userId: user.id,
      deckContent: '---\nlayout: cover\n---\n\n# AI 系统',
    })

    expect(out.candidates).toHaveLength(3)
    expect(out.retried).toBe(false)
    expect(out.diversityDegraded).toBe(false)
    expect(new Set(out.candidates.map((c) => c.style))).toEqual(
      new Set(['isometric tech', 'hand-drawn doodle', 'watercolor wash']),
    )

    // DB 验证 3 行 purpose=mood-board-candidate
    const rows = await getDb()
      .select({ id: deckAssets.id, purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.deckId, deck.id))
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.purpose).toBe('mood-board-candidate'))

    // 主 LLM 只被调一次(无 retry)
    expect(llmFake).toHaveBeenCalledTimes(1)
    // 出图被并发调 3 次
    expect(imgFake).toHaveBeenCalledTimes(3)
  })
})

describe('generateMoodBoard retry on duplicate styles', () => {
  it('第一轮 style 雷同 → retry → 第二轮通过 → retried=true / diversityDegraded=false', async () => {
    const { user } = await createLoggedInUser('retry@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const llmFake = vi
      .fn()
      .mockResolvedValueOnce(FLAT_DUPLICATE_SAMPLES) // 第一轮雷同
      .mockResolvedValueOnce(VALID_3_SAMPLES) // retry 通过
    const imgFake = makeFakeGenerateImage()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(imgFake)

    const out = await generateMoodBoard({
      deckId: deck.id,
      userId: user.id,
      deckContent: '# x',
    })

    expect(out.retried).toBe(true)
    expect(out.diversityDegraded).toBe(false)
    expect(out.candidates.map((c) => c.style).sort()).toEqual(
      ['hand-drawn doodle', 'isometric tech', 'watercolor wash'].sort(),
    )
    expect(llmFake).toHaveBeenCalledTimes(2)
    // retry 时 system prompt 含 PREVIOUS ATTEMPT 加强差异化
    expect(llmFake.mock.calls[1]![0].systemPrompt).toContain('PREVIOUS ATTEMPT')
  })

  it('retry 仍雷同 → 接受降级 diversityDegraded=true,不抛错', async () => {
    const { user } = await createLoggedInUser('degrade@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const llmFake = vi
      .fn()
      .mockResolvedValueOnce(FLAT_DUPLICATE_SAMPLES)
      .mockResolvedValueOnce(FLAT_DUPLICATE_SAMPLES) // retry 仍雷同
    const imgFake = makeFakeGenerateImage()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(imgFake)

    const out = await generateMoodBoard({
      deckId: deck.id,
      userId: user.id,
      deckContent: '# x',
    })

    expect(out.retried).toBe(true)
    expect(out.diversityDegraded).toBe(true)
    expect(out.candidates).toHaveLength(3)
  })

  it('retry 时主 LLM 出错 → 接受第一轮结果 + diversityDegraded=true,不抛错', async () => {
    const { user } = await createLoggedInUser('retry-llm-fail@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const llmFake = vi
      .fn()
      .mockResolvedValueOnce(FLAT_DUPLICATE_SAMPLES)
      .mockRejectedValueOnce(new Error('retry 502'))
    const imgFake = makeFakeGenerateImage()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(imgFake)

    const out = await generateMoodBoard({
      deckId: deck.id,
      userId: user.id,
      deckContent: '# x',
    })

    expect(out.retried).toBe(true)
    expect(out.diversityDegraded).toBe(true)
    // 第一轮的 3 个 flat-X 样张被采用
    expect(out.candidates.map((c) => c.style).sort()).toEqual(
      ['flat geometric', 'flat illustration', 'flat infographic'].sort(),
    )
  })
})

describe('generateMoodBoard error paths', () => {
  it('主 LLM 整体崩 → MoodBoardGenError(主 LLM 出 prompt 失败)', async () => {
    const { user } = await createLoggedInUser('llm-down@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    __setMainLlmCallerForTesting(async () => {
      throw new Error('upstream 502')
    })
    __setGenerateImageForMoodBoardTesting(makeFakeGenerateImage())

    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(MoodBoardGenError)
    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(/主 LLM 出 prompt 失败/)
  })

  it('主 LLM 返非法 JSON → MoodBoardGenError(parse 失败)', async () => {
    const { user } = await createLoggedInUser('llm-junk@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    __setMainLlmCallerForTesting(async () => 'not json at all')
    __setGenerateImageForMoodBoardTesting(makeFakeGenerateImage())

    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(MoodBoardGenError)
  })

  it('出图任一失败 → 已落 candidate 标 discarded + 抛 MoodBoardGenError', async () => {
    const { user } = await createLoggedInUser('img-fail@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    __setMainLlmCallerForTesting(async () => VALID_3_SAMPLES)
    // 3 张图:头 2 成功(落 candidate),第 3 失败
    let call = 0
    __setGenerateImageForMoodBoardTesting(async () => {
      call++
      if (call === 3) throw new Error('OpenAI 5xx')
      return { b64: TINY_PNG_B64, modelUsed: 'gpt-image-2', pathTaken: 'B' as const }
    })

    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(MoodBoardGenError)

    // 已落库的 candidate 应当全部被标 discarded(防脏 row)
    const rows = await getDb()
      .select({ purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(eq(deckAssets.deckId, deck.id))
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r) => expect(r.purpose).toBe('mood-board-discarded'))
  })

  it('未配 image LLM → friendly MoodBoardGenError(不到 LLM 调用就返)', async () => {
    const { user } = await createLoggedInUser('no-img@a.com')
    const { deck } = await createDeckDirect(user.id)
    await seedMainLlmKey(user.id)
    // 故意不 setImageLlmSettings

    const llmFake = vi.fn()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(makeFakeGenerateImage())

    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(/请到设置 → 生图模型 中配置/)
    // 不应走到主 LLM
    expect(llmFake).not.toHaveBeenCalled()
  })

  it('未配主 LLM → friendly MoodBoardGenError(主 LLM 未配置)', async () => {
    const { user } = await createLoggedInUser('no-main@a.com')
    const { deck } = await createDeckDirect(user.id)
    // 故意不 seedMainLlmKey
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const llmFake = vi.fn()
    __setMainLlmCallerForTesting(llmFake)
    __setGenerateImageForMoodBoardTesting(makeFakeGenerateImage())

    await expect(
      generateMoodBoard({ deckId: deck.id, userId: user.id, deckContent: '# x' }),
    ).rejects.toThrow(/主 LLM 未配置/)
    expect(llmFake).not.toHaveBeenCalled()
  })
})

describe('generateMoodBoard 跟其它 deck 隔离', () => {
  it('只写自己 deck 的 candidate,不污染其它 deck', async () => {
    const { user } = await createLoggedInUser('iso@a.com')
    const { deck: a } = await createDeckDirect(user.id, 'A')
    const { deck: b } = await createDeckDirect(user.id, 'B')
    await seedMainLlmKey(user.id)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    __setMainLlmCallerForTesting(async () => VALID_3_SAMPLES)
    __setGenerateImageForMoodBoardTesting(makeFakeGenerateImage())

    await generateMoodBoard({ deckId: a.id, userId: user.id, deckContent: '# A' })

    const aRows = await getDb()
      .select({ purpose: deckAssets.purpose })
      .from(deckAssets)
      .where(and(eq(deckAssets.deckId, a.id), eq(deckAssets.purpose, 'mood-board-candidate')))
    expect(aRows).toHaveLength(3)

    const bRows = await getDb()
      .select({ id: deckAssets.id })
      .from(deckAssets)
      .where(eq(deckAssets.deckId, b.id))
    expect(bRows).toHaveLength(0)
  })
})
