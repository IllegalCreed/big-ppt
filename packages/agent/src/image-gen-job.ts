/**
 * Phase 11.5：image-gen job 管理器(进程内内存)。
 * Phase 11.6：状态机扩两个状态 fallback-rewrote / fallback-failed,
 *            ImageJobInput 加 fallbackSummary / heading / templateId(graceful-degradation 输入)。
 *
 * 状态机:pending → running → done | fallback-rewrote | fallback-failed | cancelled
 *   - done:出图成功,slides.md 已切到 *-image-content
 *   - fallback-rewrote:出图失败,worker 调 rewriteSinglePageToComponents 自动降级为组件版成功
 *   - fallback-failed:出图失败 + 兜底重写也失败(主 LLM 也挂),slides.md 仍是 *-image-content + 空 imageSrc
 *   - cancelled:用户主动取消
 * 重启丢失可接受(出图是用户主动触发,失败重发即可,与 template-switch-job 同策略)。
 *
 * 与 template-switch-job.ts 的关键差异:
 * - 加 AbortController 字段供 cancel 调用方中断 fetch
 * - 完成后 assetId 写到 job(供前端轮询确认 imagePath)
 * - 不依赖 DB 表(不做跨设备同步)
 */
import { randomUUID } from 'node:crypto'

export type ImageJobState =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'fallback-rewrote'
  | 'fallback-failed'

export interface ImageJobInput {
  deckId: number
  userId: number
  slideIndex: number
  prompt: string
  size: string  // OpenAI gpt-image-2 size '<W>x<H>',工具层硬编最优值,无需此处枚举
  /** 用户在 settings 显式选的模型;空则走默认 gpt-5.5 主 + gpt-image-2 fallback */
  model?: string
  /**
   * Phase 11.6:中文兜底摘要,worker 失败时由 rewriteSinglePageToComponents 用作 LLM 输入。
   * 例:「列举 RAG 系统的 4 个核心模块及作用」。可选,但强烈建议(不传时仅靠 heading,效果差)。
   */
  fallbackSummary?: string
  /** Phase 11.6:页 heading,既给成功路径用于 *-image-content frontmatter,也给 fallback 重写当上下文 */
  heading?: string
  /** Phase 11.6:deck.templateId,用于 fallback 重写时构造 OFF 分支 system prompt */
  templateId?: string
}

export interface ImageJob extends ImageJobInput {
  id: string
  state: ImageJobState
  pathTaken?: 'A' | 'B'
  /** 完成后的 deck_assets.id;前端轮询 done 时拿这个拼 imageSrc */
  assetId?: string
  /** 完成后实际用的模型,用于成本/审计 */
  modelUsed?: string
  errorMsg?: string
  startedAt: Date
  finishedAt?: Date
}

interface InternalJob extends ImageJob {
  controller: AbortController
}

const jobs = new Map<string, InternalJob>()

export function __resetImageJobsForTesting(): void {
  for (const j of jobs.values()) {
    j.controller.abort()
  }
  jobs.clear()
}

export function createImageJob(input: ImageJobInput): ImageJob {
  const internal: InternalJob = {
    id: randomUUID(),
    state: 'pending',
    startedAt: new Date(),
    controller: new AbortController(),
    ...input,
  }
  jobs.set(internal.id, internal)
  return toPublic(internal)
}

export function getImageJob(id: string): ImageJob | null {
  const j = jobs.get(id)
  return j ? toPublic(j) : null
}

/** 取消 job(校验所有权防越权)。已结束的 job 是 noop。 */
export function cancelImageJob(id: string, userId: number): boolean {
  const j = jobs.get(id)
  if (!j) return false
  if (j.userId !== userId) return false
  if (j.state === 'done' || j.state === 'failed' || j.state === 'cancelled') return true
  j.controller.abort()
  mutate(id, { state: 'cancelled', finishedAt: new Date() })
  return true
}

/** 内部用:让 worker 拿到 signal */
export function __getJobSignal(id: string): AbortSignal | null {
  return jobs.get(id)?.controller.signal ?? null
}

function mutate(id: string, patch: Partial<ImageJob>): void {
  const j = jobs.get(id)
  if (!j) return
  jobs.set(id, { ...j, ...patch })
}

function toPublic(j: InternalJob): ImageJob {
  // 剥 controller 字段(不可序列化)
  const { controller: _controller, ...rest } = j
  void _controller
  return rest
}

/**
 * 出图 worker 的 DI 接口。Task E 的工具会注入真实实现:
 * - generateImage:openai-image client
 * - createAsset:DB BLOB 写入
 * - updateSlide:slides-store 改写 frontmatter
 *
 * Phase 11.6 加 3 个可选依赖,合一起开启 graceful-degradation:
 * - readSlides:失败兜底时拿当前 slides.md 给 LLM 当上下文
 * - updateSlideRaw:用 LLM 重写后的任意 frontmatter+body 替换该页
 * - rewriteSinglePage:调主 LLM 把单页重写为 *-content + 组件
 * 三者全提供 + job.fallbackSummary + job.templateId 都存在时,worker 失败走兜底;
 * 否则维持 Phase 11.5 老语义(标 failed)。
 *
 * stub 模式(BIG_PPT_TEST_IMAGE_MODE=stub)由调用方决定如何注入(读 fixture 字节)。
 */
export interface RunImageJobDeps {
  generateImage: (args: {
    prompt: string
    size: ImageJobInput['size']
    signal: AbortSignal
    model?: string
  }) => Promise<{ b64: string; modelUsed: string; pathTaken: 'A' | 'B' }>
  createAsset: (args: {
    deckId: number
    userId: number
    mimeType: string
    data: Buffer
    prompt: string
    model: string
  }) => Promise<{ id: string }>
  /** 出图成功路径:specialized signature,worker 内部组装最小 frontmatter */
  updateSlide: (args: {
    deckId: number
    userId: number
    slideIndex: number
    layout: string
    heading?: string
    imageSrc: string
  }) => Promise<void>
  /** Task E 算出的目标 layout 名(prefix-image-content),由调用方在创建 job 时已校验 */
  targetLayout: string
  /** 保留原 slide 的 heading 文本(如有),传给 updateSlide */
  preservedHeading?: string
  /** Phase 11.6:失败兜底专用——通用 update_slide,接受任意 frontmatter + body 替换该页 */
  updateSlideRaw?: (args: {
    slideIndex: number
    frontmatter: Record<string, unknown>
    body: string
    replaceFrontmatter: boolean
  }) => Promise<void>
  /** Phase 11.6:失败兜底专用——拿当前 slides.md 内容给 LLM 当上下文 */
  readSlides?: () => string
  /** Phase 11.6:失败兜底专用——单页重写为 *-content + 组件版 */
  rewriteSinglePage?: (args: {
    currentSlidesContent: string
    slideIndex: number
    heading?: string
    fallbackSummary?: string
    templateId: string
    userId: number
  }) => Promise<{ frontmatter: Record<string, unknown>; body: string }>
}

export async function runImageJob(jobId: string, deps: RunImageJobDeps): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return
  if (job.state !== 'pending') return // 防重入
  if (job.controller.signal.aborted) {
    mutate(jobId, { state: 'cancelled', finishedAt: new Date() })
    return
  }
  mutate(jobId, { state: 'running' })

  try {
    console.log(
      `[image-gen-job ${jobId.slice(0, 8)}] running: deck=${job.deckId} slide=${job.slideIndex} model=${job.model ?? 'default'}`,
    )
    const gen = await deps.generateImage({
      prompt: job.prompt,
      size: job.size,
      signal: job.controller.signal,
      model: job.model,
    })
    console.log(
      `[image-gen-job ${jobId.slice(0, 8)}] gen ok: model=${gen.modelUsed} pathTaken=${gen.pathTaken} bytes=${gen.b64.length}`,
    )

    if (job.controller.signal.aborted) {
      mutate(jobId, { state: 'cancelled', finishedAt: new Date() })
      return
    }

    const buffer = Buffer.from(gen.b64, 'base64')
    const asset = await deps.createAsset({
      deckId: job.deckId,
      userId: job.userId,
      mimeType: 'image/png',
      data: buffer,
      prompt: job.prompt,
      model: gen.modelUsed,
    })

    if (job.controller.signal.aborted) {
      // asset 已写入但 signal 已取消;asset 留库,deck-delete cascade 时清(可接受小冗余)
      mutate(jobId, {
        state: 'cancelled',
        finishedAt: new Date(),
        assetId: asset.id,
      })
      return
    }

    await deps.updateSlide({
      deckId: job.deckId,
      userId: job.userId,
      slideIndex: job.slideIndex,
      layout: deps.targetLayout,
      heading: deps.preservedHeading,
      imageSrc: `/api/assets/${asset.id}`,
    })

    console.log(
      `[image-gen-job ${jobId.slice(0, 8)}] done: assetId=${asset.id}`,
    )
    mutate(jobId, {
      state: 'done',
      pathTaken: gen.pathTaken,
      assetId: asset.id,
      modelUsed: gen.modelUsed,
      finishedAt: new Date(),
    })
  } catch (err) {
    const e = err as Error
    const msg = e.message ?? String(err)
    // ImageCancelled / AbortError 走 cancelled,其他走 failed / 兜底重写
    if (e.name === 'ImageCancelled' || e.name === 'AbortError') {
      console.warn(`[image-gen-job ${jobId.slice(0, 8)}] cancelled: ${msg}`)
      mutate(jobId, { state: 'cancelled', errorMsg: msg, finishedAt: new Date() })
      return
    }
    console.error(
      `[image-gen-job ${jobId.slice(0, 8)}] image gen FAILED: ${e.name}: ${msg}\n${e.stack ?? ''}`,
    )

    // Phase 11.6 graceful-degradation:rewriteSinglePage + readSlides + updateSlideRaw 三件 DI
    // 全提供 + job.fallbackSummary + job.templateId 都存在时,触发兜底重写。
    // 否则退化为 Phase 11.5 行为标 failed,保持向后兼容(现有测试不带 DI 时仍走老路径)。
    const canFallback =
      !!deps.rewriteSinglePage &&
      !!deps.readSlides &&
      !!deps.updateSlideRaw &&
      !!job.fallbackSummary &&
      !!job.templateId
    if (!canFallback) {
      mutate(jobId, { state: 'failed', errorMsg: msg, finishedAt: new Date() })
      return
    }

    try {
      const slidesContent = deps.readSlides!()
      const rewritten = await deps.rewriteSinglePage!({
        currentSlidesContent: slidesContent,
        slideIndex: job.slideIndex,
        heading: job.heading,
        fallbackSummary: job.fallbackSummary,
        templateId: job.templateId!,
        userId: job.userId,
      })
      await deps.updateSlideRaw!({
        slideIndex: job.slideIndex,
        frontmatter: rewritten.frontmatter,
        body: rewritten.body,
        replaceFrontmatter: true,
      })
      console.log(
        `[image-gen-job ${jobId.slice(0, 8)}] fallback-rewrote ok (image gen failed: ${msg})`,
      )
      mutate(jobId, {
        state: 'fallback-rewrote',
        errorMsg: msg,
        finishedAt: new Date(),
      })
    } catch (rwErr) {
      const rE = rwErr as Error
      const rMsg = rE.message ?? String(rwErr)
      console.error(
        `[image-gen-job ${jobId.slice(0, 8)}] fallback rewrite ALSO FAILED: ${rE.name}: ${rMsg}`,
      )
      mutate(jobId, {
        state: 'fallback-failed',
        errorMsg: `image gen failed: ${msg}; fallback rewrite also failed: ${rMsg}`,
        finishedAt: new Date(),
      })
    }
  }
}
