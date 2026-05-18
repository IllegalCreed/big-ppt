/**
 * Phase 11.5：generate_slide_image —— AI 出图工具。
 * Phase 11.6：策略反转为「图片优先模式」——
 *   - 用户配了 image LLM,所有 content 页 DEFAULT 走本工具(write_slides 之后串联 N 次)
 *   - cover/toc/section-title/back-cover 例外,数据图表的 BarChart/LineChart/PieChart 例外
 *   - 工具签名加 fallbackSummary(中文),worker 失败时由 rewriteSinglePageToComponents 用此摘要兜底重写
 *   - 工具内 prompt 末尾自动追加 "this is a slide page" 正向约束 + no-text 负向约束
 *
 * 流程:
 *   工具同步入口 → 校验 + 启 job(含 fallbackSummary) → 立返 { jobId, status: 'queued' }
 *   后台 runImageJob(异步)→ 调 OpenAI → 写 DB BLOB → updateSlide → 标 done
 *   失败 → worker 调 rewriteSinglePageToComponents 自动降级为组件版,标 fallback-rewrote
 *
 * 重要约束(写在 description):
 *   - **DEFAULT for every content slide when image LLM is configured**
 *   - **cover/toc/section-title/back-cover excepted, data charts use BarChart components**
 *   - **graceful-degradation**: worker 失败兜底契约
 * 这些短语被单测断言,防未来弱化。
 */
import path from 'node:path'
import fs from 'node:fs'
import type { ImageGenStyle } from '@big-ppt/shared'
import type { ToolDef } from '../registry.js'
import { getRequestContext } from '../../context.js'
import { getDb, decks } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import { getManifest } from '../../templates/registry.js'
import { getImageLlmSettings } from '../../db/image-llm-settings.js'
import {
  createImageJob,
  runImageJob,
  type ImageJobInput,
  type RunImageJobDeps,
} from '../../image-gen-job.js'
import {
  generateImage,
  type ImageGenInput,
  type ImageGenOutput,
} from '../../llm/openai-image.js'
import { createAsset, getAsset } from '../../db/deck-assets.js'
import { updateSlide as storeUpdateSlide, readSlides } from '../../slides-store/index.js'
import { parseSlides } from '../../slides-store/pages.js'
import { rewriteSinglePageToComponents } from '../../prompts/rewriteSinglePageToComponents.js'
import { coerceInt } from './utils.js'

/**
 * Testing seam(2026-05-18 hybrid 集成测加):允许单测注入 fake `generateImage`,
 * 既能捕获 worker 真实透传给 OpenAI 的 args(尤其 baseImageBase64),又能返合法 b64
 * 让后续 createAsset / updateSlide / state machine 一路跑完。
 *
 * 用法:
 *   __setGenerateImageForTesting(async (input) => ({ b64: ..., modelUsed: ..., pathTaken: 'A' }))
 *   afterEach(() => __setGenerateImageForTesting(null))  // 必须复位防跨文件污染
 *
 * 优先级:override > stub env > fallback env > 真 generateImage。设置后 stub/fallback env 被忽略,
 * 让单测能精准控制行为。
 */
type GenerateImageFn = (input: ImageGenInput) => Promise<ImageGenOutput>
let generateImageOverride: GenerateImageFn | null = null
export function __setGenerateImageForTesting(fn: GenerateImageFn | null): void {
  generateImageOverride = fn
}

const PROMPT_MAX = 1000

/** 计算目标 layout 名:templateId 形如 'beitou-standard' / 'jingyeda-standard' → 取首段 */
function deriveImageLayoutName(templateId: string): string {
  const prefix = templateId.split('-')[0]
  return `${prefix}-image-content`
}

/**
 * Phase 11.6 dogfood 后加结构化 prompt augmentation,解决"22 页并发风格不统一 + 英文图"问题。
 * 参考 Codex imagegen skill 的 Shared prompt schema:工具层在每次调用都注入同一份
 * deck-level invariants(色板 hex + 风格关键词 + 中文 label),让 OpenAI 生图 LLM 跨调用
 * 保持视觉一致,而非每页自由编一种形式。
 *
 * 色板等模板视觉数据放在 manifest.json 的 imageGenStyle 字段(跟 tokens.css 同源,
 * 模板元数据跟模板同包),工具层只负责拼装 prompt,不维护数据。新模板加色板只改 manifest,
 * 不需要改 agent 代码。
 *
 * 若模板未配置 imageGenStyle,工具层用通用 fallback。
 */
const FALLBACK_IMAGE_STYLE: ImageGenStyle = {
  palette: [
    '#1f2937 (neutral charcoal)',
    '#3b82f6 (modern blue)',
    '#10b981 (emerald)',
    '#f59e0b (amber)',
    '#94a3b8 (neutral slate)',
  ],
  styleHint: 'modern corporate business aesthetic',
}

/**
 * 把 LLM 提供的自由 prompt 包成 Codex imagegen skill 的结构化 schema。
 * 这样工具层强制注入 deck-level invariants(色板 / 风格 / 中文 label / 边界约束),
 * LLM 即使写得 generic 也不会让生图模型乱发挥。
 */
function buildStructuredImagePrompt(userPrompt: string, style: ImageGenStyle): string {
  const paletteList = style.palette.join(', ')
  return [
    `Use case: productivity-visual`,
    `Asset type: corporate slide deck body image (16:9 wide, edge-to-edge illustration; the slide already has its own external header bar above this image)`,
    ``,
    `Primary request: ${userPrompt.trim()}`,
    ``,
    `Style/medium: clean modern flat infographic / business diagram illustration with subtle gradients and soft shadows. ${style.styleHint}. **Apply this consistent aesthetic across ALL images in this deck — deck-wide invariant, do not drift between flat / 3D / photo / cartoon / line-art per page.**`,
    `Composition/framing: wide 16:9 body-only layout. The slide's own header bar with the Chinese title sits ABOVE this image, so do NOT add any title / banner / large decorative text strip inside the image itself.`,
    `Color palette: anchor on these brand colors — ${paletteList}. Use these tones cohesively; do not introduce off-palette saturated colors.`,
    ``,
    `Internal labels: if the diagram needs labels inside boxes / nodes / chart axes, they must be in **Chinese only** (例如「检索器」「向量库」「核心模块」), **never English**. If labels would feel forced or unnatural, omit them entirely — the slide's external Chinese header already provides context.`,
    ``,
    `Constraints: edge-to-edge body content; no outer chrome.`,
    `Avoid: outer title / heading / banner / large decorative text strip; image caption / watermark / signature / logo overlay; English-only labels; photo-realistic 3D renders; cluttered text walls; cartoon mascots; comic strips; placeholder lorem ipsum.`,
  ].join('\n')
}

/**
 * stub 模式:E2E / CI 跑时跳真 OpenAI,直接读 fixture 字节。
 * fixture 文件由 Task H 添加在 packages/agent/test/fixtures/test-image.png。
 * 工具内只在 NODE_ENV !== 'production' && BIG_PPT_TEST_IMAGE_MODE === 'stub' 时启用,
 * 防生产误触。
 *
 * fallback 模式(同 env,值为 'fallback'):强制 generateImage 抛错走 Phase 11.6
 * graceful-degradation 路径。给 image-gen-fallback.spec.ts 用,验 fallback-rewrote
 * 状态机 + slide layout 回到组件版,不需要真制造 OpenAI 失败。
 */
function shouldUseStub(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.BIG_PPT_TEST_IMAGE_MODE === 'stub'
  )
}

function shouldForceFallback(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.BIG_PPT_TEST_IMAGE_MODE === 'fallback'
  )
}

function readStubBytes(): Buffer {
  const fixturePath = path.join(
    process.cwd(),
    'packages/agent/test/fixtures/test-image.png',
  )
  if (fs.existsSync(fixturePath)) return fs.readFileSync(fixturePath)
  // 兜底:cwd 不是 monorepo 根时,从模块相对路径推
  const fallback = path.join(import.meta.dirname ?? '', '../../../test/fixtures/test-image.png')
  if (fs.existsSync(fallback)) return fs.readFileSync(fallback)
  throw new Error(`stub fixture not found: ${fixturePath}`)
}

/** 将 stub 字节包成 generateImage 等价输出(给 worker DI 用) */
async function stubGenerateImage(_input: ImageGenInput): Promise<ImageGenOutput> {
  const buf = readStubBytes()
  return {
    b64: buf.toString('base64'),
    modelUsed: 'stub-fixture',
    pathTaken: 'B',
  }
}

/**
 * fallback 模式专用 stub:模拟 OpenAI 路 A + 路 B 都崩,让 worker 进入 Phase 11.6
 * graceful-degradation 重写分支。配 BIG_PPT_TEST_REWRITE_MODE=skeleton 一起用,
 * rewriteSinglePage 也走 skeleton 不烧 token,整体跑通 fallback-rewrote 终态。
 */
async function fallbackForcedGenerateImage(_input: ImageGenInput): Promise<ImageGenOutput> {
  throw new Error('forced fallback (BIG_PPT_TEST_IMAGE_MODE=fallback)')
}

const TOOL_NAME = 'generate_slide_image'

const TOOL_DESCRIPTION = [
  'Generate an AI image with OpenAI image_generation and place it on a slide using the template-specific image-content layout (e.g. beitou-image-content, jingyeda-image-content).',
  '',
  'DEFAULT for every content slide when image LLM is configured: after `write_slides` emits a deck, call this tool for each content slide so the rendered image populates the *-image-content layout. cover / toc / section-title / back-cover are excepted (use their structural layouts). Data charts (BarChart / LineChart / PieChart) live in component path — when image LLM is configured those slides also become AI-generated images per the system prompt decision tree.',
  '',
  'Required arguments:',
  '- `slideIndex`: 1-based page index of the content slide to populate.',
  '- `prompt`: English. Describe ONLY what the slide should convey (business points, key info, mood). DO NOT specify visual form (no "bar chart style", no "infographic", no "illustration", no "realistic photo"); let the image LLM decide. The tool auto-appends a "this is a slide page" positive constraint plus a no-text negative constraint, so the LLM sees a slide-aware visual prompt without you writing it.',
  '- `fallbackSummary`: Chinese, 1-2 short sentences summarizing what the slide should convey (e.g. "列举 RAG 系统的 4 个核心模块及作用"). Used as graceful-degradation input: if both OpenAI image API paths fail, the worker invokes a single non-streaming LLM call (rewriteSinglePageToComponents) that uses this summary plus the deck context to rewrite the slide as a layout/component version automatically — preserving user intent without manual retry.',
  '',
  'Returns `{ jobId, status: "queued" }` synchronously. **`queued` means "task is enqueued", NOT "image is ready"**. The actual OpenAI image_generation call is dispatched by a background worker behind a per-user concurrency limit (default 3 — N images take roughly N/3 × 30-60s end to end). Do not block; continue emitting tool calls for other slides in the same turn. **When you write your final reply to the user, do NOT say "已生成 N 页 PPT" / "配图已完成"**: the deck text is generated but most images are still pending or running. Say "已生成 N 页大纲,正在为 X 个内容页配图(后台异步,可在编辑器查看进度)" instead. The frontend separately polls `/api/image-jobs/<jobId>` for terminal states (`done` | `fallback-rewrote` | `fallback-failed` | `cancelled`).',
  '',
  'Side effect on success: the slide layout switches to `*-image-content` and `body` is wiped (the slide becomes pure image with the existing header heading on top). On failure the graceful-degradation rewrite replaces the slide with a `*-content` layout + components version derived from `fallbackSummary`.',
  '',
  'Image dimensions are hardcoded 1536x720 to match the layout body aspect ratio; do not pass a size argument.',
].join('\n')

async function runTool(args: Record<string, unknown>): Promise<string> {
  const ctx = getRequestContext()
  if (!ctx.userId) {
    return JSON.stringify({ success: false, error: '未登录' })
  }
  const slideIndex = coerceInt(args.slideIndex)
  if (slideIndex === null || slideIndex < 1) {
    return JSON.stringify({ success: false, error: 'slideIndex 必须是 ≥1 的整数' })
  }
  const userPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!userPrompt || userPrompt.length > PROMPT_MAX) {
    return JSON.stringify({
      success: false,
      error: `prompt 必填且长度 ≤ ${PROMPT_MAX}`,
    })
  }
  // Phase 11.6 dogfood 后改:fallbackSummary 改必填(LLM 不传 = 拒收)。
  // 没它 worker 失败时无法做 graceful-degradation,slides.md 留空壳;system prompt 也强约束。
  const fallbackSummaryRaw =
    typeof args.fallbackSummary === 'string' ? args.fallbackSummary.trim() : ''
  if (!fallbackSummaryRaw) {
    return JSON.stringify({
      success: false,
      error:
        'fallbackSummary 必填(中文 1-2 句概括本页应承载的信息)。worker 失败时 graceful-degradation 需要它作为重写组件版的输入,不传 = 失败时 slides.md 留 *-image-content 空壳。',
    })
  }
  const fallbackSummary = fallbackSummaryRaw
  // Phase 11.6 dogfood 后改造:从自由文本 negative constraint 改为结构化
  // augmentation schema(参考 Codex imagegen skill /Users/zhangxu/.codex/skills/.system/imagegen/SKILL.md):
  // - 每次调用注入同一份 deck-level invariants(productivity-visual + 模板色板 hex + 中文 label + 边界约束)
  // - 让生图 LLM 跨调用保持视觉一致,而非 22 页各自漂出 22 个风格
  // - 解决 dogfood 报告的「图片风格不统一 + 英文图」问题
  // 注:实际 prompt 在 createImageJob 之后才拼,因为要拿 deck.templateId(在下方)
  // **size 自动选**:模板的 image-content layout body 实际比例约 2:1
  // (Slidev 默认 16:9 canvas 减去 LBtHeader/LJydHeader 高度约 4.5em ≈ 15%)。
  // 1536x720 满足 OpenAI gpt-image-2 约束(min 655360 像素 + 16 倍数 + ≤3:1)
  // 且更贴近 layout 比例,object-fit:cover 时上下基本不裁。
  // LLM 不再决定 size — 工具按模板硬编最优值,避免 LLM 选错比例导致裁剪。
  const size: ImageJobInput['size'] = '1536x720'

  const deckId = ctx.activeDeckId
  if (!deckId) {
    return JSON.stringify({ success: false, error: '无 active deck' })
  }

  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return JSON.stringify({ success: false, error: 'deck 不存在' })
  if (deck.userId !== ctx.userId) {
    return JSON.stringify({ success: false, error: '无权访问该 deck' })
  }

  const targetLayout = deriveImageLayoutName(deck.templateId)
  const manifest = getManifest(deck.templateId)
  if (!manifest) {
    return JSON.stringify({ success: false, error: `模板 ${deck.templateId} 未注册` })
  }
  if (!manifest.layouts.some((l) => l.name === targetLayout)) {
    return JSON.stringify({
      success: false,
      error: `模板 ${deck.templateId} 没有 ${targetLayout} layout,无法插入 AI 图。请用 create_slide + 文字 layout`,
    })
  }

  let preservedHeading: string | undefined
  /**
   * Hybrid vision-aware 模式(2026-05-18):同步入口检测当前 slide 是否已有 imageSrc。
   * 字段名 `imageSrc` 与 layouts/<template>/<template>-image-content.vue 的 defineProps 一致,
   * 与 templates/<id>/manifest.json 的 frontmatterSchema 也一致(已 grep 确认)。
   *
   * 仅当值是合法 `/api/assets/<uuid>` 时,SQL 读 deck_assets BLOB(三条件 IDOR guard:
   * id + deck_id + user_id 全匹配)→ base64 → 透传给 createImageJob → worker。
   *
   * 边界:
   * - 字段值不是 /api/assets/<uuid>(用户手贴野 url / 字段名拼错):静默走原 text-only 路径
   * - asset 行不存在 / 跨 deck / 跨 user:静默走原 text-only 路径(不漏数据 / 不抛错)
   */
  let baseImageBase64: string | undefined
  let baseImageMime: string | undefined
  try {
    const parsed = parseSlides(await readSlides())
    if (slideIndex > parsed.pages.length) {
      return JSON.stringify({
        success: false,
        error: `slideIndex 超出范围:应为 1..${parsed.pages.length},收到 ${slideIndex}`,
      })
    }
    const target = parsed.pages[slideIndex - 1]
    const fmHeading = target?.frontmatter?.heading
    if (typeof fmHeading === 'string' && fmHeading.trim()) {
      preservedHeading = fmHeading
    }
    const fmImageSrc = target?.frontmatter?.imageSrc
    if (typeof fmImageSrc === 'string' && fmImageSrc.trim()) {
      // 严格匹配 `/api/assets/<uuid v4>` 格式,容错(末尾斜杠 / query string 等)
      const match = fmImageSrc.match(
        /^\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
      )
      if (match) {
        const assetId = match[1]!
        // IDOR guard 推进 SQL:`WHERE id = ? AND deck_id = ? AND user_id = ?`,
        // 不匹配直接 SELECT 空 → BLOB 永远不进进程内存(老实现先 load 完整行
        // 再 object-level 检查,即便最终 reject 也已占内存)。
        const asset = await getAsset(assetId, { deckId, userId: ctx.userId })
        if (asset && asset.data.length > 0) {
          baseImageBase64 = asset.data.toString('base64')
          baseImageMime = asset.mimeType || 'image/png'
        }
      }
    }
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `slides.md 解析失败:${(err as Error).message}`,
    })
  }

  let imageSettings = await getImageLlmSettings(ctx.userId)
  if (!imageSettings) {
    if (shouldUseStub() || shouldForceFallback()) {
      imageSettings = { provider: 'openai', apiKey: 'stub' }
    } else {
      return JSON.stringify({
        success: false,
        error: '请到设置 → 生图模型 中配置 OpenAI API Key',
      })
    }
  }

  // 拿到 deck.templateId 后再拼最终 prompt:从 manifest.imageGenStyle 读色板 + 风格(模板
  // 元数据跟模板同包,新模板加色板只改 manifest 不动 agent),缺省走通用 fallback
  const templateStyle = manifest.imageGenStyle ?? FALLBACK_IMAGE_STYLE
  const finalPrompt = buildStructuredImagePrompt(userPrompt, templateStyle)

  const job = createImageJob({
    deckId,
    userId: ctx.userId,
    slideIndex,
    prompt: finalPrompt,
    size,
    model: imageSettings.model,
    fallbackSummary,
    heading: preservedHeading,
    templateId: deck.templateId,
    baseImageBase64,
    baseImageMime,
  })

  // 后台跑 worker;捕获顶层 promise 避免 unhandled rejection。
  // 注意:**不**在此层包 `runInRequest` —— `runImageJob`(image-gen-job.ts)顶层已
  // 用 job.userId + job.deckId 自带 inner `runInRequest` 重注 ALS。外层若再包一层
  // 会立即被 inner 覆盖,纯 dead code,且会误导未来 reader 以为 worker 继承当前 turn
  // 的 turnId(实际 inner 写死 turnId:null,因为 worker 不该跟 LLM turn 合并 version)。
  const userId = ctx.userId
  void (async () => {
    try {
      const settings = imageSettings!
      // 选 generateImage 实现:override 优先(集成测精确捕获 args),其次 env-gated stub/fallback,
      // 否则真 OpenAI client。所有分支均把 baseImageBase64/Mime 透传给底层。
      const pickGenerateImage: GenerateImageFn = generateImageOverride
        ? generateImageOverride
        : shouldForceFallback()
          ? fallbackForcedGenerateImage
          : shouldUseStub()
            ? stubGenerateImage
            : generateImage
      const deps: RunImageJobDeps = {
        generateImage: (a) =>
          pickGenerateImage({
            prompt: a.prompt,
            size: a.size,
            signal: a.signal,
            apiKey: settings.apiKey,
            baseUrl: settings.baseUrl,
            primaryModel: a.model,
            baseImageBase64: a.baseImageBase64,
            baseImageMime: a.baseImageMime,
          }),
        createAsset: async (args2) => createAsset(args2),
        updateSlide: async (args2) => {
          const fm: Record<string, unknown> = {
            layout: args2.layout,
            imageSrc: args2.imageSrc,
          }
          if (args2.heading) fm.heading = args2.heading
          const result = await storeUpdateSlide({
            index: args2.slideIndex,
            frontmatter: fm,
            body: '',
            replaceFrontmatter: true,
          })
          if (!result.success) {
            throw new Error(result.error ?? 'updateSlide 失败')
          }
        },
        // Phase 11.6 graceful-degradation:三件 DI 注入,worker 在出图失败时
        // 自动调 rewriteSinglePage 用 fallbackSummary + 整 deck 上下文重写为组件版
        updateSlideRaw: async (args2) => {
          const result = await storeUpdateSlide({
            index: args2.slideIndex,
            frontmatter: args2.frontmatter,
            body: args2.body,
            replaceFrontmatter: args2.replaceFrontmatter,
          })
          if (!result.success) {
            throw new Error(result.error ?? 'updateSlideRaw 失败')
          }
        },
        readSlides: () => readSlides(),
        rewriteSinglePage: rewriteSinglePageToComponents,
        targetLayout,
        preservedHeading,
      }
      await runImageJob(job.id, deps)
    } catch (err) {
      // 兜底:任何意外抛错(包括 setImageLlmSettings 解构等同步失败)都到 stderr +
      // 持久化日志,避免 unhandled rejection 静默吞错;同时把 job 标 failed。
      const e = err as Error
      console.error(
        `[generate_slide_image worker] unhandled error for job ${job.id.slice(0, 8)}: ${e.name}: ${e.message}\n${e.stack ?? ''}`,
      )
      const { logServerEvent } = await import('../../logger/server-log.js')
      logServerEvent({
        category: 'image-gen',
        event: 'worker-wrapper-error',
        jobId: job.id,
        deckId,
        userId,
        slideIndex,
        errorName: e.name,
        errorMsg: e.message,
      })
    }
  })()

  return JSON.stringify({
    success: true,
    jobId: job.id,
    status: 'queued',
    estimatedSeconds: 45,
    hint: '通过 GET /api/image-jobs/<jobId> 轮询状态',
  })
}

export const generateSlideImageTool: ToolDef = {
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      slideIndex: {
        type: 'integer',
        minimum: 1,
        description: '目标 slide 的 1-based 位置',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: PROMPT_MAX,
        description:
          '英文图像 prompt。**只描述本页要承载的内容**(业务点 / 关键信息 / 主题氛围),**不要指定展示形式**(no "bar chart style" / "infographic" / "illustration" / "realistic photo" 等限定词,让生图 LLM 自决)。工具层会自动追加 "this is a slide page" 与 no-text 约束。',
      },
      fallbackSummary: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description:
          '中文,1-2 句概括本页应承载的信息(例:「列举 RAG 系统的 4 个核心模块及作用」)。**必填**:worker 在 OpenAI 路 A/B 都失败时,用此摘要 + 整 deck 上下文调一次 LLM 自动重写为 *-content + 组件版本(graceful-degradation)。不传 = 工具拒收;无此字段 worker 失败 → slides.md 留 *-image-content 空壳,体验差。',
      },
    },
    required: ['slideIndex', 'prompt', 'fallbackSummary'],
  },
  exec: runTool,
}
