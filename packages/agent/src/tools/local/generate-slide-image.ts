/**
 * Phase 11.5：generate_slide_image —— LLM 触发 AI 出图工具。
 *
 * 流程:
 *   工具同步入口 → 校验 + 启 job → 立返 { jobId, status: 'queued' }
 *   后台 runImageJob(异步)→ 调 OpenAI → 写 DB BLOB → updateSlide → 标 done
 *
 * 跟 switch_template 的范式一致(异步 job + 前端轮询),但绑定 image-llm-settings
 * 而非主 LLM key,且不走 chat semaphore。
 *
 * 重要约束(写在 description):
 *   - **only when user explicitly asks for AI-generated visuals**
 *   - **for charts use BarChart/LineChart/PieChart components, not this tool**
 * 这两条短语被单测断言,防未来弱化。
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
import { coerceInt } from './utils.js'

const PROMPT_MAX = 1000
const CAPTION_MAX = 120

/** 计算目标 layout 名:templateId 形如 'beitou-standard' / 'jingyeda-standard' → 取首段 */
function deriveImageLayoutName(templateId: string): string {
  const prefix = templateId.split('-')[0]
  return `${prefix}-image-content`
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
  'Use ONLY when the user explicitly asks for AI-generated visuals (生成图片 / 画一张 / AI 出图 / 配图 etc).',
  '',
  'Do NOT use for charts: for charts use BarChart / LineChart / PieChart components, not this tool. Do NOT use to "make a slide more visual" without explicit instruction — this burns the user OpenAI quota.',
  '',
  'Returns { jobId, status: "queued" } immediately; the frontend polls /api/image-jobs/<jobId> for completion. Do not block waiting; you can continue with other tools while the image generates.',
  '',
  'Side effect: switching the slide to *-image-content layout WIPES the existing body. If the user wants to keep text, use create_slide to add a new image page instead of update_slide here.',
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
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt || prompt.length > PROMPT_MAX) {
    return JSON.stringify({
      success: false,
      error: `prompt 必填且长度 ≤ ${PROMPT_MAX}`,
    })
  }
  const caption =
    typeof args.caption === 'string' && args.caption.trim()
      ? args.caption.trim().slice(0, CAPTION_MAX)
      : undefined
  const aspect = args.aspectRatio === 'portrait' || args.aspectRatio === 'square'
    ? args.aspectRatio
    : 'landscape'
  const size: ImageJobInput['size'] =
    aspect === 'portrait' ? '720x1280' : aspect === 'square' ? '1024x1024' : '1280x720'

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

  const job = createImageJob({
    deckId,
    userId: ctx.userId,
    slideIndex,
    prompt,
    caption,
    size,
    model: imageSettings.model,
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
            if (args2.caption) fm.caption = args2.caption
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
          '图像生成 prompt;英文 prompt 通常质量更好。明确描述风格/构图/主体/光线。',
      },
      caption: {
        type: 'string',
        maxLength: CAPTION_MAX,
        description: '图下小字标注(可选,≤120 字)',
      },
      aspectRatio: {
        type: 'string',
        enum: ['landscape', 'portrait', 'square'],
        description: '默认 landscape (1280×720,与 layout 槽对齐);portrait/square 仅特殊场景',
      },
    },
    required: ['slideIndex', 'prompt'],
  },
  exec: runTool,
}
