/**
 * Phase 11.5：image-gen job 管理器(进程内内存)。
 *
 * 状态机:pending → running → done | failed | cancelled
 * 重启丢失可接受(出图是用户主动触发,失败重发即可,与 template-switch-job 同策略)。
 *
 * 与 template-switch-job.ts 的关键差异:
 * - 加 AbortController 字段供 cancel 调用方中断 fetch
 * - 完成后 assetId 写到 job(供前端轮询确认 imagePath)
 * - 不依赖 DB 表(不做跨设备同步)
 */
import { randomUUID } from 'node:crypto'

export type ImageJobState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ImageJobInput {
  deckId: number
  userId: number
  slideIndex: number
  prompt: string
  caption?: string
  size: '1280x720' | '1024x1024' | '720x1280'
  /** 用户在 settings 显式选的模型;空则走默认 gpt-5.5 主 + gpt-image-2 fallback */
  model?: string
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
  updateSlide: (args: {
    deckId: number
    userId: number
    slideIndex: number
    layout: string
    heading?: string
    imageSrc: string
    caption?: string
  }) => Promise<void>
  /** Task E 算出的目标 layout 名(prefix-image-content),由调用方在创建 job 时已校验 */
  targetLayout: string
  /** 保留原 slide 的 heading 文本(如有),传给 updateSlide */
  preservedHeading?: string
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
    const gen = await deps.generateImage({
      prompt: job.prompt,
      size: job.size,
      signal: job.controller.signal,
      model: job.model,
    })

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
      caption: job.caption,
    })

    mutate(jobId, {
      state: 'done',
      pathTaken: gen.pathTaken,
      assetId: asset.id,
      modelUsed: gen.modelUsed,
      finishedAt: new Date(),
    })
  } catch (err) {
    const msg = (err as Error).message ?? String(err)
    // ImageCancelled / AbortError 走 cancelled,其他走 failed
    if ((err as Error).name === 'ImageCancelled' || (err as Error).name === 'AbortError') {
      mutate(jobId, { state: 'cancelled', errorMsg: msg, finishedAt: new Date() })
    } else {
      mutate(jobId, { state: 'failed', errorMsg: msg, finishedAt: new Date() })
    }
  }
}
