/**
 * Phase 11.5：image-gen job 前端轮询 composable。
 *
 * 用法:tool 工具 exec 返 { jobId, status: 'queued' };useAIChat 立即调 start(jobId)
 * 由本 composable 接管轮询 + 进度展示;done 后 SlidePreview 通过 Slidev HMR 自动刷新。
 *
 * 状态机:pending → running → done | failed | cancelled
 * 进度:running 阶段每次 poll +0.02 上限 0.85;done → 1.0
 *
 * 沿用 useSwitchTemplateJob 的 abort + 双速 poll 范式(plan 14 踩坑 4:setTimeout 必须清理)。
 */
import { ref, shallowRef } from 'vue'
import { useDecks, type ImageJobInfo, type ImageJobState } from './useDecks'

const FAST_INTERVAL_MS = 1_500
const SLOW_INTERVAL_MS = 3_000
const FAST_PHASE_MS = 30_000
const TOTAL_TIMEOUT_MS = 2 * 60_000 // OpenAI 出图典型 30-60s + 缓冲

const STAGE_RATIO: Record<ImageJobState, number> = {
  pending: 0.05,
  running: 0.5,
  done: 1,
  failed: 0,
  cancelled: 0,
}

export type StartParams = { jobId: string }

export function useGenerateImageJob() {
  const { getImageJob, cancelImageJob } = useDecks()

  const stage = ref<ImageJobState>('pending')
  const progressRatio = ref(0)
  const error = ref<string | null>(null)
  const result = shallowRef<ImageJobInfo | null>(null)
  const running = ref(false)

  let controller: AbortController | null = null
  let currentJobId: string | null = null
  let currentPromise: Promise<ImageJobInfo> | null = null

  function reset() {
    stage.value = 'pending'
    progressRatio.value = 0
    error.value = null
    result.value = null
  }

  function abort() {
    if (currentPromise) {
      currentPromise.catch(() => {})
      currentPromise = null
    }
    controller?.abort()
    controller = null
    running.value = false
  }

  /**
   * 开始追踪一个已经创建的 job(由 generate_slide_image 工具同步入口返的 jobId)。
   * 不调创建端点 —— 工具内部已经创建。
   */
  function start(params: StartParams): Promise<ImageJobInfo> {
    abort()
    reset()
    running.value = true
    currentJobId = params.jobId
    const ctrl = new AbortController()
    controller = ctrl
    const promise = _doStart(params, ctrl)
    promise.catch(() => {})
    currentPromise = promise
    return promise
  }

  /** 主动取消(发 DELETE 给后端 + abort 本地轮询) */
  async function cancel(): Promise<void> {
    if (currentJobId) {
      try {
        await cancelImageJob(currentJobId)
      } catch {
        // 后端已 done/不存在等情况吞错
      }
    }
    abort()
  }

  async function _doStart(params: StartParams, ctrl: AbortController): Promise<ImageJobInfo> {
    try {
      const deadline = Date.now() + TOTAL_TIMEOUT_MS
      const startTs = Date.now()

      // 立即查一次,拿到初始 state
      let initial: ImageJobInfo
      try {
        const { job } = await getImageJob(params.jobId)
        initial = job
      } catch (err) {
        throw new Error(`获取 image job 失败:${(err as Error).message}`)
      }
      stage.value = initial.state
      progressRatio.value = STAGE_RATIO[initial.state]
      if (terminal(initial.state)) {
        if (initial.state === 'done') {
          result.value = initial
          running.value = false
          controller = null
          return initial
        }
        throw new Error(initial.errorMsg ?? `image job ${initial.state}`)
      }

      while (!ctrl.signal.aborted) {
        if (Date.now() >= deadline) {
          throw new Error('image job timeout (2min)')
        }
        const interval =
          Date.now() - startTs < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
        await sleep(interval, ctrl.signal)
        if (ctrl.signal.aborted) throw new Error('aborted')

        const { job } = await getImageJob(params.jobId)
        if (job.id !== currentJobId) continue
        stage.value = job.state
        if (job.state === 'running') {
          const base = Math.max(progressRatio.value, STAGE_RATIO.running)
          progressRatio.value = Math.min(0.85, base + 0.02)
        } else {
          progressRatio.value = STAGE_RATIO[job.state]
        }
        if (job.state === 'done') {
          result.value = job
          running.value = false
          controller = null
          return job
        }
        if (job.state === 'failed') {
          throw new Error(job.errorMsg ?? 'image job failed')
        }
        if (job.state === 'cancelled') {
          throw new Error('cancelled')
        }
      }
      throw new Error('aborted')
    } catch (err) {
      running.value = false
      controller = null
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    }
  }

  return { stage, progressRatio, error, result, running, start, abort, cancel }
}

function terminal(s: ImageJobState): boolean {
  return s === 'done' || s === 'failed' || s === 'cancelled'
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}
