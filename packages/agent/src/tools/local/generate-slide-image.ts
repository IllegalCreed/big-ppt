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
import type { ToolDef } from '../registry.js'
import { getRequestContext, runInRequest } from '../../context.js'
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
import { createAsset } from '../../db/deck-assets.js'
import { updateSlide as storeUpdateSlide, readSlides } from '../../slides-store/index.js'
import { parseSlides } from '../../slides-store/pages.js'
import { rewriteSinglePageToComponents } from '../../prompts/rewriteSinglePageToComponents.js'
import { coerceInt } from './utils.js'

const PROMPT_MAX = 1000

/** 计算目标 layout 名:templateId 形如 'beitou-standard' / 'jingyeda-standard' → 取首段 */
function deriveImageLayoutName(templateId: string): string {
  const prefix = templateId.split('-')[0]
  return `${prefix}-image-content`
}

/**
 * 模板图像风格表 — Phase 11.6 dogfood 后加,解决"22 页并发风格不统一 + 英文图"问题。
 *
 * 参考 Codex imagegen skill 的 structured prompt schema:工具层在每次调用都注入
 * 同一份 deck-level invariants(色板 hex + 风格关键词 + 中文 label),让 OpenAI 生图
 * LLM 在跨调用之间保持视觉一致,而非每页自由编一种形式。
 *
 * 色板从 packages/slidev/templates/<id>/tokens.css 的 chart-1..chart-5 + brand-primary
 * 抄过来,跟 layout 视觉同源。新模板加进来时同步加一行;若 templateId 不在表里,fallback
 * 通用 palette + style。
 */
interface TemplateImageStyle {
  /** 色板 hex 列表(带语义标签),作为生图色调 anchor */
  palette: string[]
  /** 风格关键词,跟模板 layout 视觉氛围对齐(红色品牌 / 蓝色品牌 等) */
  styleHint: string
}

const TEMPLATE_IMAGE_STYLE: Record<string, TemplateImageStyle> = {
  'beitou-standard': {
    palette: [
      '#d00d14 (brand red, primary anchor)',
      '#f59e0b (amber gold, warm secondary)',
      '#2a9d8f (teal green, cool counter-balance)',
      '#6366f1 (indigo, cool accent)',
      '#94a3b8 (neutral slate gray)',
    ],
    styleHint:
      'corporate red anchor with warm-cool secondary tones, formal Chinese business presentation aesthetic',
  },
  'jingyeda-standard': {
    palette: [
      '#003da5 (brand blue, primary anchor)',
      '#8fc31f (brand green, secondary anchor)',
      '#f59e0b (amber gold, warm accent)',
      '#e76f51 (warm coral, accent)',
      '#94a3b8 (neutral slate gray)',
    ],
    styleHint:
      'corporate blue + green dual-anchor with warm accents, formal Chinese business presentation aesthetic',
  },
}

const FALLBACK_IMAGE_STYLE: TemplateImageStyle = {
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
function buildStructuredImagePrompt(userPrompt: string, style: TemplateImageStyle): string {
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
 */
function shouldUseStub(): boolean {
  return (
    process.env.NODE_ENV !== 'production' && process.env.BIG_PPT_TEST_IMAGE_MODE === 'stub'
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

const TOOL_NAME = 'generate_slide_image'

const TOOL_DESCRIPTION = [
  'Generate an AI image with OpenAI image_generation and place it on a slide using the template-specific image-content layout (e.g. beitou-image-content, jingyeda-image-content).',
  '',
  'Phase 11.6 — DEFAULT for every content slide when image LLM is configured: after `write_slides` emits a deck, call this tool for each content slide so the rendered image populates the *-image-content layout. cover / toc / section-title / back-cover are excepted (use their structural layouts). Data charts (BarChart / LineChart / PieChart) live in OFF-mode component path — when image LLM is configured those slides also become AI-generated images per the system prompt decision tree.',
  '',
  'Required arguments:',
  '- `slideIndex`: 1-based page index of the content slide to populate.',
  '- `prompt`: English. Describe ONLY what the slide should convey (business points, key info, mood). DO NOT specify visual form (no "bar chart style", no "infographic", no "illustration", no "realistic photo"); let the image LLM decide. The tool auto-appends a "this is a slide page" positive constraint plus a no-text negative constraint, so the LLM sees a slide-aware visual prompt without you writing it.',
  '- `fallbackSummary`: Chinese, 1-2 short sentences summarizing what the slide should convey (e.g. "列举 RAG 系统的 4 个核心模块及作用"). Used as graceful-degradation input: if both OpenAI image API paths fail, the worker invokes a single non-streaming LLM call (rewriteSinglePageToComponents) that uses this summary plus the deck context to rewrite the slide as a layout/component version automatically — preserving user intent without manual retry.',
  '',
  'Returns `{ jobId, status: "queued" }` synchronously. The frontend polls `/api/image-jobs/<jobId>` for completion (`done` | `fallback-rewrote` | `fallback-failed` | `cancelled`). Do not block; continue emitting tool calls for other slides in the same turn.',
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
  // Phase 11.6:fallbackSummary 是 graceful-degradation 输入。可选(为 undefined 时
  // worker 失败仍会尝试用 heading 兜底,但效果差)。LLM 应该传,prompt 已强约束。
  const fallbackSummaryRaw =
    typeof args.fallbackSummary === 'string' ? args.fallbackSummary.trim() : ''
  const fallbackSummary = fallbackSummaryRaw.length > 0 ? fallbackSummaryRaw : undefined
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
  try {
    const parsed = parseSlides(readSlides())
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
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `slides.md 解析失败:${(err as Error).message}`,
    })
  }

  let imageSettings = await getImageLlmSettings(ctx.userId)
  if (!imageSettings) {
    if (shouldUseStub()) {
      imageSettings = { provider: 'openai', apiKey: 'stub' }
    } else {
      return JSON.stringify({
        success: false,
        error: '请到设置 → 生图模型 中配置 OpenAI API Key',
      })
    }
  }

  // 拿到 deck.templateId 后再拼最终 prompt(注入对应模板的色板 + 风格 invariants)
  const templateStyle = TEMPLATE_IMAGE_STYLE[deck.templateId] ?? FALLBACK_IMAGE_STYLE
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
  })

  // 后台跑 worker;捕获顶层 promise 避免 unhandled rejection
  const userId = ctx.userId
  const turnId = ctx.turnId
  const sessionId = ctx.sessionId
  void (async () => {
    try {
    // worker 跑出请求 context;手动复原让 slides-store/persist 写 deck_versions
    await runInRequest(
      {
        userId,
        activeDeckId: deckId,
        sessionId,
        turnId,
      },
      async () => {
        const settings = imageSettings!
        const deps: RunImageJobDeps = {
          generateImage: shouldUseStub()
            ? (a) =>
                stubGenerateImage({
                  prompt: a.prompt,
                  size: a.size,
                  signal: a.signal,
                  apiKey: settings.apiKey,
                  baseUrl: settings.baseUrl,
                  primaryModel: a.model,
                })
            : (a) =>
                generateImage({
                  prompt: a.prompt,
                  size: a.size,
                  signal: a.signal,
                  apiKey: settings.apiKey,
                  baseUrl: settings.baseUrl,
                  primaryModel: a.model,
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
      },
    )
    } catch (err) {
      // 兜底:任何意外抛错(包括 runInRequest / setImageLlmSettings 解构等同步失败)
      // 都到 stderr,避免 unhandled rejection 静默吞错;同时把 job 标 failed。
      const e = err as Error
      console.error(
        `[generate_slide_image worker] unhandled error for job ${job.id.slice(0, 8)}: ${e.name}: ${e.message}\n${e.stack ?? ''}`,
      )
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
        maxLength: 500,
        description:
          '中文,1-2 句概括本页应承载的信息(例:「列举 RAG 系统的 4 个核心模块及作用」)。worker 在 OpenAI 路 A/B 都失败时,会用此摘要 + 整 deck 上下文调一次 LLM 自动重写为 *-content + 组件版本(graceful-degradation)。强烈建议传;不传时 worker 仅靠 heading 兜底,效果差。',
      },
    },
    required: ['slideIndex', 'prompt'],
  },
  exec: runTool,
}
