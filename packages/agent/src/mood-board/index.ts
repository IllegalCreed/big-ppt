/**
 * Phase 11.8 Task B-2: mood-board 生成 orchestration。
 *
 * 流程(plan 32 抉择 1):
 *   1. extractDeckOutlineForPrompt 截上下文(≤ 2KB)
 *   2. 调主 LLM 1 次非流式 → JSON {samples: [{style, prompt}, × 3]}
 *   3. assessStyleDiversity ≥ 0.8 雷同 → retry 1 次(加强差异化指令)
 *   4. retry 仍雷同 → 接受降级(log warn,不抛错;用户能"换一批"自救)
 *   5. 3 个 prompt 并发调 generateImage → 落 deck_assets(purpose='mood-board-candidate')
 *   6. 任一图失败 → 已写入 candidate 标记 discarded(避免脏 row)+ 抛 MoodBoardGenError
 */
import {
  createAsset,
  discardAssets,
  type AssetPurpose,
} from '../db/deck-assets.js'
import fs from 'node:fs'
import path from 'node:path'
import { generateImage as defaultGenerateImage } from '../llm/openai-image.js'
import type { ImageGenInput, ImageGenOutput } from '../llm/openai-image.js'
import { readImageDimensions, SIZE_AR_TOLERANCE } from '../llm/image-dimensions.js'
import { acquireImageSlot } from '../middleware/image-semaphore.js'
import { acquireLlmSlot } from '../middleware/llm-semaphore.js'
import { loadUserLlmSettings, resolveUpstream } from '../prompts/rewriteForTemplate.js'
import { getImageLlmSettings } from '../db/image-llm-settings.js'
import { getManifest } from '../templates/registry.js'
import { logServerEvent } from '../logger/server-log.js'
import {
  MOOD_BOARD_SYSTEM_PROMPT,
  buildRetrySystemPrompt,
  extractDeckOutlineForPrompt,
  parseMoodBoardLlmResponse,
  assessStyleDiversity,
  STYLE_SIMILARITY_RETRY_THRESHOLD,
  type MoodBoardSample,
} from './prompt.js'

export class MoodBoardGenError extends Error {
  override readonly cause?: Error
  constructor(message: string, cause?: Error) {
    super(message)
    this.name = 'MoodBoardGenError'
    this.cause = cause
  }
}

export interface MoodBoardCandidate {
  /** deck_assets.id, purpose='mood-board-candidate' */
  assetId: string
  style: string
  prompt: string
}

export interface GenerateMoodBoardInput {
  deckId: number
  userId: number
  /** 当前 deck markdown 全文(被 outline 截断到 ≤ 2KB 喂主 LLM) */
  deckContent: string
  /**
   * Phase 11.8 dogfood:deck 当前模板 id,用于查 manifest.imageGenSize 让 mood-board
   * 候选图的尺寸跟正式内容页生图一致(用户挑的 anchor 与后续 generate_slide_image
   * 比例对齐,免得 anchor 看起来 1:1 漂亮但实际正式页 2:1 走形)。
   */
  templateId: string
}

/**
 * Phase 11.8 dogfood 后引入:模板缺 imageGenSize 字段时 mood-board 用的通用兜底。
 * 跟 generate-slide-image.ts 保持一致,新模板都应在 manifest.json 显式声明,
 * 不要依赖此 fallback。
 */
const MOOD_BOARD_FALLBACK_SIZE = { width: 1536, height: 720 } as const

function resolveMoodBoardSize(templateId: string): string {
  const manifest = getManifest(templateId)
  const cfg = manifest?.imageGenSize ?? MOOD_BOARD_FALLBACK_SIZE
  return `${cfg.width}x${cfg.height}`
}

/** 候选/锚图出图的重抽上限(含首次) */
const MOOD_BOARD_MAX_ATTEMPTS = 2

/**
 * 出图 + 尺寸校验重抽(2026-07 生产 dogfood)。
 *
 * 中转偶发不按请求 size 返图(生产 deck#30 实测:请求 1280x624 却返 1536x1024=1.5)。
 * mood-board 候选被用户选中即成锚图,而 hybrid 出图**比例跟着锚图走**(生产验证:锚图 2.051
 * → 出图 2.051 满铺;锚图 1.5 → 出图全 16:9 被裁)。故锚图尺寸必须正,否则整批内容页跑偏。
 *
 * 出图后用 readImageDimensions 校验 AR,与请求 size 差 > SIZE_AR_TOLERANCE 就重抽一次;
 * 用尽仍不符则接受(*-image-content 的 object-fit:contain 兜底整图显示)并落 giveup 日志。
 * 只对「尺寸不符」重抽;imageGen 抛错(取消/5xx)直接向上传播,不在此吞。
 */
async function generateSizedImage(
  imageGen: (input: ImageGenInput) => Promise<ImageGenOutput>,
  input: ImageGenInput,
  expectedSize: string,
  ctx: { deckId: number; userId: number; style: string },
): Promise<ImageGenOutput> {
  const [rw, rh] = expectedSize.split('x').map((n) => Number(n))
  let out: ImageGenOutput
  for (let attempt = 1; ; attempt++) {
    out = await imageGen(input)
    const dims = readImageDimensions(Buffer.from(out.b64, 'base64'))
    if (!dims || !rw || !rh || dims.height === 0) return out // 无法校验 → 接受
    const drift = Math.abs(dims.width / dims.height - rw / rh) / (rw / rh)
    if (drift <= SIZE_AR_TOLERANCE) return out // 比例匹配 → 用它
    if (attempt >= MOOD_BOARD_MAX_ATTEMPTS) {
      logServerEvent({
        category: 'mood-board',
        event: 'anchor-size-giveup',
        deckId: ctx.deckId,
        userId: ctx.userId,
        style: ctx.style,
        requestedSize: expectedSize,
        actualWidth: dims.width,
        actualHeight: dims.height,
        attempts: attempt,
      })
      return out // 用尽仍不符 → 接受,contain 兜底显示
    }
    logServerEvent({
      category: 'mood-board',
      event: 'anchor-size-retry',
      deckId: ctx.deckId,
      userId: ctx.userId,
      style: ctx.style,
      attempt,
      requestedSize: expectedSize,
      actualWidth: dims.width,
      actualHeight: dims.height,
    })
  }
}

export interface GenerateMoodBoardOutput {
  candidates: MoodBoardCandidate[]
  /** 主 LLM 是否 retry 过(给前端 / 日志做诊断) */
  retried: boolean
  /** retry 后仍雷同(降级接受)? */
  diversityDegraded: boolean
}

/** 主 LLM 非流式调用 fn(可注入 DI,生产链路用默认实现) */
export type MainLlmCaller = (args: {
  userId: number
  systemPrompt: string
  userPrompt: string
}) => Promise<string>

let mainLlmCallerOverride: MainLlmCaller | null = null
/**
 * Testing seam:注入 fake 主 LLM 调用,避免单测真打 LLM。
 * **必须**在 afterEach 调 `__setMainLlmCallerForTesting(null)` 复位,
 * 否则模块级状态会跨文件污染(沿用 CLAUDE.md 测试基建条 2)。
 */
export function __setMainLlmCallerForTesting(fn: MainLlmCaller | null): void {
  mainLlmCallerOverride = fn
}

let generateImageOverride: ((input: ImageGenInput) => Promise<ImageGenOutput>) | null = null
/**
 * Testing seam:注入 fake generateImage,捕获 worker 真透传的 prompt + 返合法 b64。
 * 同样必须 afterEach 复位。
 */
export function __setGenerateImageForMoodBoardTesting(
  fn: ((input: ImageGenInput) => Promise<ImageGenOutput>) | null,
): void {
  generateImageOverride = fn
}

/**
 * E2E / CI stub 模式:env BIG_PPT_TEST_MOOD_BOARD_MODE=stub 时跳真主 LLM,
 * 直接返 hardcoded 3 个差异化 sample。配 BIG_PPT_TEST_IMAGE_MODE=stub 一起用
 * 让整条 mood-board E2E 流程不烧 token。
 */
const STUB_SAMPLES_JSON = JSON.stringify({
  samples: [
    { style: 'isometric tech', prompt: '[stub] isometric tech illustration about deck theme' },
    { style: 'hand-drawn doodle', prompt: '[stub] hand-drawn doodle of deck theme' },
    { style: 'watercolor wash', prompt: '[stub] soft watercolor painting of deck theme' },
  ],
})

function shouldUseStubMainLlm(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.BIG_PPT_TEST_MOOD_BOARD_MODE === 'stub'
  )
}

/**
 * Stub generateImage 复用 generate-slide-image 同款 fixture(BIG_PPT_TEST_IMAGE_MODE=stub),
 * 避免 mood-board 在 e2e 真打 OpenAI。仅 NODE_ENV !== 'production' 时启用。
 */
function shouldUseStubGenerateImage(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.BIG_PPT_TEST_IMAGE_MODE === 'stub'
  )
}

function readStubImageBytes(): Buffer {
  const fixturePath = path.join(
    process.cwd(),
    'packages/agent/test/fixtures/test-image.png',
  )
  if (fs.existsSync(fixturePath)) return fs.readFileSync(fixturePath)
  const fallback = path.join(
    import.meta.dirname ?? '',
    '../../test/fixtures/test-image.png',
  )
  if (fs.existsSync(fallback)) return fs.readFileSync(fallback)
  throw new Error(`mood-board stub fixture not found: ${fixturePath}`)
}

async function stubGenerateImageForMoodBoard(
  _input: ImageGenInput,
): Promise<ImageGenOutput> {
  const buf = readStubImageBytes()
  return {
    b64: buf.toString('base64'),
    modelUsed: 'stub-fixture',
    pathTaken: 'B',
  }
}

/** 默认主 LLM 调用实现(套用 rewriteSinglePageToComponents 同款套路:loadUserLlmSettings + fetch /chat/completions) */
const defaultMainLlmCaller: MainLlmCaller = async ({ userId, systemPrompt, userPrompt }) => {
  if (shouldUseStubMainLlm()) {
    return STUB_SAMPLES_JSON
  }
  const settings = await loadUserLlmSettings(userId)
  const { url, model } = resolveUpstream(settings)
  const release = await acquireLlmSlot(userId)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`mood-board 主 LLM 调用失败:HTTP ${resp.status} ${text.slice(0, 200)}`)
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') {
      throw new Error('mood-board 主 LLM 响应缺失 content')
    }
    return content
  } finally {
    release()
  }
}

/**
 * 主入口。失败抛 MoodBoardGenError;部分成功(主 LLM OK 但出图失败)也抛错,
 * 已写入的 candidate 行被标 discarded 防脏数据。
 */
export async function generateMoodBoard(
  input: GenerateMoodBoardInput,
): Promise<GenerateMoodBoardOutput> {
  // 1. 校验用户已配 image LLM(没配的话 generateImage 走 generic 报错,这里前置 friendly)
  const imageSettings = await getImageLlmSettings(input.userId)
  if (!imageSettings) {
    throw new MoodBoardGenError('请到设置 → 生图模型 中配置 OpenAI API Key')
  }

  // 2. 校验主 LLM 也配了(出 mood-board prompt 用),loadUserLlmSettings 内会抛。
  // stub 模式(BIG_PPT_TEST_MOOD_BOARD_MODE=stub)跳过主 LLM key 校验,e2e 不需要 seed key
  if (!shouldUseStubMainLlm()) {
    try {
      await loadUserLlmSettings(input.userId)
    } catch (err) {
      throw new MoodBoardGenError(`主 LLM 未配置:${(err as Error).message}`)
    }
  }

  // 3. 截 outline 喂主 LLM
  const outline = extractDeckOutlineForPrompt(input.deckContent)
  const llmCaller = mainLlmCallerOverride ?? defaultMainLlmCaller

  logServerEvent({
    category: 'mood-board',
    event: 'main-llm-call-start',
    deckId: input.deckId,
    userId: input.userId,
    outlineBytes: Buffer.byteLength(outline, 'utf-8'),
  })

  let samples: MoodBoardSample[]
  let raw: string
  try {
    raw = await llmCaller({
      userId: input.userId,
      systemPrompt: MOOD_BOARD_SYSTEM_PROMPT,
      userPrompt: `Deck outline:\n\n${outline}`,
    })
    samples = parseMoodBoardLlmResponse(raw).samples
  } catch (err) {
    logServerEvent({
      category: 'mood-board',
      event: 'main-llm-call-failed',
      deckId: input.deckId,
      userId: input.userId,
      errorMsg: (err as Error).message,
    })
    throw new MoodBoardGenError(`主 LLM 出 prompt 失败:${(err as Error).message}`, err as Error)
  }

  // 4. diversity check + retry 一次
  let retried = false
  let diversityDegraded = false
  const sim = assessStyleDiversity(samples)
  if (sim >= STYLE_SIMILARITY_RETRY_THRESHOLD) {
    retried = true
    logServerEvent({
      category: 'mood-board',
      event: 'diversity-retry',
      deckId: input.deckId,
      userId: input.userId,
      similarity: sim,
      prevStyles: samples.map((s) => s.style),
    })
    try {
      raw = await llmCaller({
        userId: input.userId,
        systemPrompt: buildRetrySystemPrompt(samples.map((s) => s.style)),
        userPrompt: `Deck outline:\n\n${outline}`,
      })
      const retryParsed = parseMoodBoardLlmResponse(raw)
      const retrySim = assessStyleDiversity(retryParsed.samples)
      if (retrySim >= STYLE_SIMILARITY_RETRY_THRESHOLD) {
        diversityDegraded = true
        logServerEvent({
          category: 'mood-board',
          event: 'diversity-degraded',
          deckId: input.deckId,
          userId: input.userId,
          similarity: retrySim,
          styles: retryParsed.samples.map((s) => s.style),
        })
      }
      samples = retryParsed.samples
    } catch (err) {
      // retry 出 LLM 错也接受第一轮结果(diversityDegraded=true),不抛
      diversityDegraded = true
      logServerEvent({
        category: 'mood-board',
        event: 'diversity-retry-llm-failed',
        deckId: input.deckId,
        userId: input.userId,
        errorMsg: (err as Error).message,
      })
    }
  }

  // 5. 并发出图(共享 per-user image-semaphore);用 allSettled **等所有 settled**
  // 再判结果,否则 Promise.all 一 reject 其它 inflight 的 createAsset 写入会"漏 GC":
  // catch 段已跑 discardAssets 时,fulfilled promise 还没 push id 进 writtenAssetIds,
  // 最终 DB 留两条 candidate 没被 discard(脏 row)。
  // 优先级:override(单测) > stub(e2e) > 真 generateImage(prod)
  const imageGen = generateImageOverride
    ? generateImageOverride
    : shouldUseStubGenerateImage()
      ? stubGenerateImageForMoodBoard
      : defaultGenerateImage
  const ctrl = new AbortController()

  type ImageOutcome =
    | { ok: true; assetId: string; style: string; prompt: string }
    | { ok: false; error: Error }

  const moodBoardSize = resolveMoodBoardSize(input.templateId)
  const outcomes: ImageOutcome[] = await Promise.all(
    samples.map(async (sample): Promise<ImageOutcome> => {
      const release = await acquireImageSlot(input.userId)
      try {
        // Phase 11.8 dogfood:size 跟模板的 imageGenSize 同源,确保用户挑的 anchor
        // 跟后续正式生图比例一致。2026-07:中转偶发不认 size,故出图后校验 AR 不符则重抽
        // (generateSizedImage),避免锚图比例错导致整批内容页跑偏(生产 deck#30 教训)。
        const out = await generateSizedImage(
          imageGen,
          {
            prompt: sample.prompt,
            size: moodBoardSize,
            signal: ctrl.signal,
            apiKey: imageSettings.apiKey,
            baseUrl: imageSettings.baseUrl,
            primaryModel: imageSettings.model,
          },
          moodBoardSize,
          { deckId: input.deckId, userId: input.userId, style: sample.style },
        )
        const bytes = Buffer.from(out.b64, 'base64')
        const { id } = await createAsset({
          deckId: input.deckId,
          userId: input.userId,
          mimeType: 'image/png',
          data: bytes,
          prompt: sample.prompt,
          model: out.modelUsed,
          purpose: 'mood-board-candidate' satisfies AssetPurpose,
          // Phase 11.8 dogfood:把短风格标签也存 DB,picker reopen 时 GET candidates
          // 能拿回展示,不再依赖 frontend 内存
          style: sample.style,
        })
        return { ok: true, assetId: id, style: sample.style, prompt: sample.prompt }
      } catch (err) {
        return { ok: false, error: err as Error }
      } finally {
        release()
      }
    }),
  )

  const successes = outcomes.filter((o): o is Extract<ImageOutcome, { ok: true }> => o.ok)
  const failures = outcomes.filter((o): o is Extract<ImageOutcome, { ok: false }> => !o.ok)

  if (failures.length > 0) {
    ctrl.abort()
    // 部分成功的 candidate 标 discarded 防脏 row
    const ids = successes.map((s) => s.assetId)
    if (ids.length > 0) {
      await discardAssets(ids).catch(() => {})
    }
    const firstError = failures[0]!.error
    logServerEvent({
      category: 'mood-board',
      event: 'image-gen-failed',
      deckId: input.deckId,
      userId: input.userId,
      errorMsg: firstError.message,
      failureCount: failures.length,
      partialAssetCount: ids.length,
    })
    throw new MoodBoardGenError(`出图失败:${firstError.message}`, firstError)
  }

  const candidates: MoodBoardCandidate[] = successes.map((s) => ({
    assetId: s.assetId,
    style: s.style,
    prompt: s.prompt,
  }))

  logServerEvent({
    category: 'mood-board',
    event: 'success',
    deckId: input.deckId,
    userId: input.userId,
    retried,
    diversityDegraded,
    styles: candidates.map((c) => c.style),
  })

  return { candidates, retried, diversityDegraded }
}

/** Test helper: 强制清两个 DI seam(给 afterEach 一行复位用) */
export function __resetMoodBoardTestingSeams(): void {
  mainLlmCallerOverride = null
  generateImageOverride = null
}
