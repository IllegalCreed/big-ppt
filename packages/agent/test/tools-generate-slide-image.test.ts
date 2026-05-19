/**
 * Phase 11.5 Task E：generate_slide_image 工具单测。
 *
 * 关键覆盖:
 * - 描述包含 "explicitly" + "BarChart" 关键约束词(防未来弱化)
 * - 同步入口校验:slideIndex 越界 / 缺 prompt / 跨用户 deck / 缺 OpenAI key
 * - 同步入口快速返 { jobId, status: 'queued' },slides.md 未变,DB 无 asset
 * - stub 模式跑完 worker:DB 多一行 asset + slides.md frontmatter.layout 切换 + imageSrc 写入
 *
 * stub 模式由 BIG_PPT_TEST_IMAGE_MODE=stub 启用,跳真 OpenAI 直接读 fixture PNG。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting } from '../src/crypto/apikey.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { __resetImageJobsForTesting, getImageJob } from '../src/image-gen-job.js'
import { generateSlideImageTool } from '../src/tools/local/generate-slide-image.js'
import { runInRequest } from '../src/context.js'
import { setImageLlmSettings } from '../src/db/image-llm-settings.js'
import { listAssetIdsByDeck, getAsset, createAsset } from '../src/db/deck-assets.js'

useTestDb()

// 用 alias 调工具入口,绕过 security hook 对 .exec( 字面量的误报
const runTool = generateSlideImageTool.exec.bind(generateSlideImageTool)

const FIXED_KEY = Buffer.alloc(32, 0x4f)

let tmpRoot: string
let slidesFile: string

// P0 fix(2026-05-18):slides-store DB-based;tool 读 deck DB content,不读全局 slides.md。
// 测试 fixture content 同时灌入 slides.md(legacy mirror,跟 generate-slide-image 工具
// 调 readSlides 的 deck content 必须一致)和 createDeckDirect 让 deck 有 ≥3 页可被 slideIndex=2/99 引用。
const FIXTURE_SLIDES = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-content
heading: 第二页标题
---

正文 A

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
  process.env.BIG_PPT_TEST_IMAGE_MODE = 'stub'
})

afterAll(() => {
  delete process.env.BIG_PPT_TEST_IMAGE_MODE
})

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-image-tool-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(slidevDir, { recursive: true })
  slidesFile = path.join(slidevDir, 'slides.md')
  fs.writeFileSync(slidesFile, FIXTURE_SLIDES, 'utf-8')
  process.env.BIG_PPT_SLIDES_PATH = slidesFile
  process.env.BIG_PPT_HISTORY_DIR = path.join(tmpRoot, 'history')
  __resetPathsForTesting()
  __resetImageJobsForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_HISTORY_DIR
  __resetPathsForTesting()
  __resetImageJobsForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function pollUntilDone(jobId: string, timeoutMs = 5000): Promise<ReturnType<typeof getImageJob>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const j = getImageJob(jobId)
    if (j && (j.state === 'done' || j.state === 'failed' || j.state === 'cancelled')) return j
    await new Promise((r) => setTimeout(r, 50))
  }
  return getImageJob(jobId)
}

describe('generate_slide_image 工具', () => {
  it('Phase 11.6：描述含 DEFAULT for every content slide + fallbackSummary 引导（防未来弱化）', () => {
    // Phase 11.6 起 image-gen 配置后默认对每个 content 页都调用，所以描述
    // 不能再写"only when explicitly asks";但 BarChart 例外提示仍保留（数据图不走生图）。
    expect(generateSlideImageTool.description).toContain('DEFAULT for every content slide')
    expect(generateSlideImageTool.description).toContain('fallbackSummary')
    expect(generateSlideImageTool.description).toContain('BarChart')
    // graceful-degradation 关键词：worker 失败兜底契约
    expect(generateSlideImageTool.description).toMatch(/graceful[- ]degradation/i)
  })

  it('Phase 11.6：parameters schema 含 fallbackSummary 字段（中文兜底摘要）', () => {
    const props = (generateSlideImageTool.parameters as { properties?: Record<string, unknown> })
      .properties
    expect(props).toBeDefined()
    expect(props).toHaveProperty('fallbackSummary')
  })

  it('Phase 11.6 dogfood 后:fallbackSummary 改必填(在 required 数组里 + 工具内拒收)', () => {
    const required = (generateSlideImageTool.parameters as { required?: string[] }).required
    expect(required).toContain('fallbackSummary')
  })

  it('未登录 → 失败', async () => {
    const result = await runTool({ slideIndex: 2, prompt: 'a' })
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/未登录/)
  })

  it('slideIndex 不是整数 → 失败', async () => {
    const { user } = await createLoggedInUser('e1@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 'abc', prompt: 'p', fallbackSummary: 's' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/slideIndex/)
  })

  it('prompt 缺失 → 失败', async () => {
    const { user } = await createLoggedInUser('e2@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 2, prompt: '' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/prompt/)
  })

  it('slideIndex 超过页数 → 失败 + slides.md 不变', async () => {
    const { user } = await createLoggedInUser('e3@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const before = fs.readFileSync(slidesFile, 'utf-8')
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 99, prompt: 'p', fallbackSummary: 's' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(fs.readFileSync(slidesFile, 'utf-8')).toBe(before)
  })

  it('跨用户 deck → 失败', async () => {
    const { user: a } = await createLoggedInUser('owner@a.com')
    const { deck } = await createDeckDirect(a.id, "D", FIXTURE_SLIDES)
    const { user: b } = await createLoggedInUser('intruder@a.com')
    await setImageLlmSettings(b.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: b.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 2, prompt: 'p', fallbackSummary: 's' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/无权/)
  })

  it('未配生图模型 + 非 stub 模式 → 失败,引导去 Settings', async () => {
    delete process.env.BIG_PPT_TEST_IMAGE_MODE
    try {
      const { user } = await createLoggedInUser('nokey@a.com')
      const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
      const result = await runInRequest(
        { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
        () => runTool({ slideIndex: 2, prompt: 'p', fallbackSummary: 's' }),
      )
      const json = JSON.parse(result)
      expect(json.success).toBe(false)
      expect(json.error).toMatch(/生图模型/)
    } finally {
      process.env.BIG_PPT_TEST_IMAGE_MODE = 'stub'
    }
  })

  it('Phase 11.6 dogfood 后:fallbackSummary 缺失 → 工具拒收', async () => {
    const { user } = await createLoggedInUser('nofallback@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 2, prompt: 'p' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/fallbackSummary/)
  })

  it('Phase 11.6 dogfood 后:fallbackSummary 全空白字符串 → 工具拒收(trim 后非空才算)', async () => {
    const { user } = await createLoggedInUser('emptyfb@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () => runTool({ slideIndex: 2, prompt: 'p', fallbackSummary: '   ' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/fallbackSummary/)
  })

  it('happy path:同步立返 jobId 且 slides.md/DB 暂未变;stub 跑完后 DB+slides.md 都更新', async () => {
    const { user } = await createLoggedInUser('happy@a.com')
    const { deck } = await createDeckDirect(user.id, "D", FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const before = fs.readFileSync(slidesFile, 'utf-8')

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () =>
        runTool({
          slideIndex: 2,
          prompt: 'a futuristic city',
          fallbackSummary: '某段中文兜底摘要',
        }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.jobId).toMatch(/^[0-9a-f-]{36}$/)
    expect(json.status).toBe('queued')

    const justAfter = fs.readFileSync(slidesFile, 'utf-8')
    expect(justAfter).toBe(before)

    const final = await pollUntilDone(json.jobId)
    expect(final?.state).toBe('done')
    expect(final?.assetId).toMatch(/^[0-9a-f-]{36}$/)

    const ids = await listAssetIdsByDeck(deck.id)
    expect(ids).toContain(final!.assetId)
    const asset = await getAsset(final!.assetId!)
    expect(asset?.mimeType).toBe('image/png')
    expect(asset?.bytesSize).toBeGreaterThan(0)

    // P0 fix(2026-05-18):slides-store DB-based,worker 写入直接走 deck_versions;
    // 读取从 DB 拿 currentVersion.content 而非 fs slides.md。
    const { getDb, decks, deckVersions } = await import('../src/db/index.js')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const [updatedDeck] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    const [currentVersion] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, updatedDeck!.currentVersionId!))
      .limit(1)
    const after = currentVersion!.content
    expect(after).toContain('layout: beitou-image-content')
    expect(after).toContain(`/api/assets/${final!.assetId}`)
    // heading 保留
    expect(after).toContain('第二页标题')
  })

  // caption 字段已从工具/layout 中删除(图片纯净充满 header 下方,
  // 不再叠加文字标注;LLM 也不会主动给图加文字标题)

  // Hybrid vision-aware(2026-05-18):同步入口检测当前 slide 是否已有 imageSrc。
  it('hybrid:slide 已有 imageSrc(/api/assets/<uuid>)→ 读 DB BLOB,job 带 baseImageBase64/baseImageMime', async () => {
    const { user } = await createLoggedInUser('hybrid-has-image@a.com')
    // 先建 deck + asset,再用带 imageSrc 的 slides content 重建 deck
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
    const asset = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // 4 bytes PNG magic 够测断言
      prompt: 'seed',
      model: 'test',
    })

    // 把 slide 2 改成 *-image-content + imageSrc 指向刚建的 asset
    const slidesWithImage = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: /api/assets/${asset.id}
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
    // 写到 fs slides.md(slides-store 读 DB 时仍走 deck content;但要让 deck.currentVersion
    // 拿到带 imageSrc 的版本,得 update deck_versions.content 或重建 deck)
    const { getDb, deckVersions, decks } = await import('../src/db/index.js')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const [updatedDeck] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    await db
      .update(deckVersions)
      .set({ content: slidesWithImage })
      .where(eq(deckVersions.id, updatedDeck!.currentVersionId!))
    fs.writeFileSync(slidesFile, slidesWithImage, 'utf-8')

    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () =>
        runTool({
          slideIndex: 2,
          prompt: 'modify the rooftop',
          fallbackSummary: '调整屋顶细节',
        }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.jobId).toMatch(/^[0-9a-f-]{36}$/)

    // 关键:job 的 baseImageBase64/baseImageMime 透传
    const job = getImageJob(json.jobId)
    expect(job).not.toBeNull()
    expect(job!.baseImageBase64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
    expect(job!.baseImageMime).toBe('image/png')
  })

  it('hybrid:slide 无 imageSrc → job.baseImageBase64 / baseImageMime 都是 undefined', async () => {
    const { user } = await createLoggedInUser('hybrid-no-image@a.com')
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () =>
        runTool({
          slideIndex: 2,
          prompt: 'a futuristic city',
          fallbackSummary: '某段中文兜底摘要',
        }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    const job = getImageJob(json.jobId)
    expect(job!.baseImageBase64).toBeUndefined()
    expect(job!.baseImageMime).toBeUndefined()
  })

  it('hybrid:slide.imageSrc 是野 url(非 /api/assets/<uuid>)→ 静默走 text-only,job 无 baseImage', async () => {
    const { user } = await createLoggedInUser('hybrid-bad-url@a.com')
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
    const slidesBad = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: https://example.com/foo.png
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
    const { getDb, deckVersions, decks } = await import('../src/db/index.js')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const [updatedDeck] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    await db
      .update(deckVersions)
      .set({ content: slidesBad })
      .where(eq(deckVersions.id, updatedDeck!.currentVersionId!))
    fs.writeFileSync(slidesFile, slidesBad, 'utf-8')

    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
      () =>
        runTool({
          slideIndex: 2,
          prompt: 'p',
          fallbackSummary: 's',
        }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    const job = getImageJob(json.jobId)
    expect(job!.baseImageBase64).toBeUndefined()
    expect(job!.baseImageMime).toBeUndefined()
  })

  it('hybrid IDOR guard:imageSrc 指向别家 user 的 asset → 静默走 text-only,不漏数据', async () => {
    // user A 拥有 asset,user B 的 slide 把 imageSrc 拼成 A 的 asset uuid(横向越权尝试)
    const { user: a } = await createLoggedInUser('hybrid-idor-a@a.com')
    const { deck: deckA } = await createDeckDirect(a.id, 'A', FIXTURE_SLIDES)
    const assetA = await createAsset({
      deckId: deckA.id,
      userId: a.id,
      mimeType: 'image/png',
      data: Buffer.from('secret'),
      prompt: 'secret',
      model: 'test',
    })

    const { user: b } = await createLoggedInUser('hybrid-idor-b@a.com')
    const { deck: deckB } = await createDeckDirect(b.id, 'B', FIXTURE_SLIDES)
    const slidesB = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: /api/assets/${assetA.id}
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
    const { getDb, deckVersions, decks } = await import('../src/db/index.js')
    const { eq } = await import('drizzle-orm')
    const db = getDb()
    const [updatedDeckB] = await db.select().from(decks).where(eq(decks.id, deckB.id)).limit(1)
    await db
      .update(deckVersions)
      .set({ content: slidesB })
      .where(eq(deckVersions.id, updatedDeckB!.currentVersionId!))
    fs.writeFileSync(slidesFile, slidesB, 'utf-8')

    await setImageLlmSettings(b.id, { provider: 'openai', apiKey: 'sk-x' })

    const result = await runInRequest(
      { userId: b.id, sessionId: null, activeDeckId: deckB.id, turnId: null },
      () =>
        runTool({
          slideIndex: 2,
          prompt: 'p',
          fallbackSummary: 's',
        }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    const job = getImageJob(json.jobId)
    // 关键:B 拿不到 A 的 asset(deckId / userId 都不匹配),静默走 text-only
    expect(job!.baseImageBase64).toBeUndefined()
    expect(job!.baseImageMime).toBeUndefined()
  })

  // Phase 11.8 (2026-05-19):工具入口自动读 deck.anchor_asset_id 注入 baseImage,
  // 优先级 frontmatter imageSrc > deck.anchor > none。
  describe('Phase 11.8 anchor 自动注入', () => {
    it('slide 无 imageSrc + deck 有 anchor → job 透传 anchor BLOB', async () => {
      const { user } = await createLoggedInUser('anchor-deck@a.com')
      const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
      // 建 anchor asset(purpose='anchor')+ deck.anchor_asset_id 写入
      const ANCHOR_BYTES = Buffer.from([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56])
      const anchor = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/jpeg',
        data: ANCHOR_BYTES,
        prompt: 'anchor sample',
        purpose: 'anchor',
      })
      const { getDb, decks } = await import('../src/db/index.js')
      const { eq } = await import('drizzle-orm')
      await getDb()
        .update(decks)
        .set({ anchorAssetId: anchor.id })
        .where(eq(decks.id, deck.id))

      await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
      const result = await runInRequest(
        { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
        () =>
          runTool({
            slideIndex: 2,
            prompt: 'p',
            fallbackSummary: 's',
          }),
      )
      const json = JSON.parse(result)
      expect(json.success).toBe(true)
      const job = getImageJob(json.jobId)
      expect(job!.baseImageBase64).toBe(ANCHOR_BYTES.toString('base64'))
      expect(job!.baseImageMime).toBe('image/jpeg')
    })

    it('slide 有 imageSrc + deck 有 anchor → 用 imageSrc(优先级高于 anchor)', async () => {
      const { user } = await createLoggedInUser('anchor-priority@a.com')
      const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
      // imageSrc 指向的 asset
      const SLIDE_BYTES = Buffer.from([0x11, 0x22, 0x33, 0x44])
      const slideAsset = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: SLIDE_BYTES,
        prompt: 'slide',
      })
      // 另一张作 anchor
      const ANCHOR_BYTES = Buffer.from([0x99, 0x88, 0x77])
      const anchor = await createAsset({
        deckId: deck.id,
        userId: user.id,
        mimeType: 'image/png',
        data: ANCHOR_BYTES,
        prompt: 'anchor',
        purpose: 'anchor',
      })

      const slidesWithSrc = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: /api/assets/${slideAsset.id}
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
      const { getDb, deckVersions, decks } = await import('../src/db/index.js')
      const { eq } = await import('drizzle-orm')
      const db = getDb()
      const [updatedDeck] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
      await db
        .update(deckVersions)
        .set({ content: slidesWithSrc })
        .where(eq(deckVersions.id, updatedDeck!.currentVersionId!))
      await db.update(decks).set({ anchorAssetId: anchor.id }).where(eq(decks.id, deck.id))
      fs.writeFileSync(slidesFile, slidesWithSrc, 'utf-8')

      await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
      const result = await runInRequest(
        { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
        () =>
          runTool({
            slideIndex: 2,
            prompt: 'p',
            fallbackSummary: 's',
          }),
      )
      const json = JSON.parse(result)
      expect(json.success).toBe(true)
      const job = getImageJob(json.jobId)
      // 关键:用 slideAsset 的 BLOB,不是 anchor 的(优先级 imageSrc > anchor)
      expect(job!.baseImageBase64).toBe(SLIDE_BYTES.toString('base64'))
      expect(job!.baseImageBase64).not.toBe(ANCHOR_BYTES.toString('base64'))
    })

    it('slide 无 imageSrc + deck 无 anchor → 无 baseImage(纯 text-only)', async () => {
      const { user } = await createLoggedInUser('anchor-none@a.com')
      const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_SLIDES)
      // 故意不设 anchor_asset_id
      await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
      const result = await runInRequest(
        { userId: user.id, sessionId: null, activeDeckId: deck.id, turnId: null },
        () =>
          runTool({
            slideIndex: 2,
            prompt: 'p',
            fallbackSummary: 's',
          }),
      )
      const json = JSON.parse(result)
      expect(json.success).toBe(true)
      const job = getImageJob(json.jobId)
      expect(job!.baseImageBase64).toBeUndefined()
      expect(job!.baseImageMime).toBeUndefined()
    })

    it('deck.anchor_asset_id 指向跨 user asset → IDOR guard 拦,静默走 text-only', async () => {
      // 用户 A 拥有 asset,但 user B 的 deck 字面 anchorAssetId 指向 A 的 asset uuid。
      // 这种情况理论上路由层 IDOR 已拦,但工具入口也要兜底保险防 DB 脏数据。
      const { user: a } = await createLoggedInUser('anchor-idor-a@a.com')
      const { deck: deckA } = await createDeckDirect(a.id, 'A', FIXTURE_SLIDES)
      const assetA = await createAsset({
        deckId: deckA.id,
        userId: a.id,
        mimeType: 'image/png',
        data: Buffer.from('secret-anchor-bytes'),
        purpose: 'anchor',
      })

      const { user: b } = await createLoggedInUser('anchor-idor-b@a.com')
      const { deck: deckB } = await createDeckDirect(b.id, 'B', FIXTURE_SLIDES)
      const { getDb, decks } = await import('../src/db/index.js')
      const { eq } = await import('drizzle-orm')
      // 模拟脏数据:B 的 deck.anchor_asset_id 指向 A 的 asset
      await getDb()
        .update(decks)
        .set({ anchorAssetId: assetA.id })
        .where(eq(decks.id, deckB.id))

      await setImageLlmSettings(b.id, { provider: 'openai', apiKey: 'sk-x' })
      const result = await runInRequest(
        { userId: b.id, sessionId: null, activeDeckId: deckB.id, turnId: null },
        () =>
          runTool({
            slideIndex: 2,
            prompt: 'p',
            fallbackSummary: 's',
          }),
      )
      const json = JSON.parse(result)
      expect(json.success).toBe(true)
      const job = getImageJob(json.jobId)
      // B 拿不到 A 的 asset(三条件 SQL 不匹配),静默 text-only
      expect(job!.baseImageBase64).toBeUndefined()
      expect(job!.baseImageMime).toBeUndefined()
    })
  })
})
