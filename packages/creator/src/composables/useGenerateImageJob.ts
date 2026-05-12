/**
 * Phase 11.5：image-gen job 前端轮询 composable。
 * Phase 11.6：扩两个状态 fallback-rewrote(出图失败但兜底重写成功) / fallback-failed(兜底也崩)。
 *
 * 用法:tool 工具 exec 返 { jobId, status: 'queued' };useAIChat 立即调 start(jobId)
 * 由本 composable 接管轮询 + 进度展示;done / fallback-rewrote 后 SlidePreview 通过 Slidev HMR 自动刷新。
 *
 * 状态机:pending → running → done | fallback-rewrote | fallback-failed | failed | cancelled
 * 进度:running 阶段每次 poll +0.02 上限 0.85;done → 1.0;fallback-rewrote → 1.0(也是成功)
 *
 * 沿用 useSwitchTemplateJob 的 abort + 双速 poll 范式(plan 14 踩坑 4:setTimeout 必须清理)。
 */
import { ref, shallowRef } from 'vue'
import { useDecks, type ImageJobInfo, type ImageJobState } from './useDecks'
import { useSlideStore } from './useSlideStore'

const FAST_INTERVAL_MS = 1_500
const SLOW_INTERVAL_MS = 3_000
const FAST_PHASE_MS = 30_000
/**
 * dogfood 后:**完全删前端 hard timeout**,靠后端 + 用户 cancel 兜底。
 *
 * 历史:
 *   v1: TOTAL_TIMEOUT_MS = 3min hard。LLM 一 turn 触发 22 张图,后端 pLimit=3,排队尾的 job
 *       前端 3min 早 timeout 标 failed,但后端 worker 还在 pending 队列实际跑成。前端 / 后端
 *       状态背离 → 用户看到「失败但还在跑」错觉。
 *   v2: STATE_CHANGE_TIMEOUT_MS = 5min(state 不变化就超时)。仍有 bug:pending 排队就是
 *       state 不变化的合理状态,5min 内没拿到 slot 就误超时。
 *   v3(当前): 删 timeout。pending 长时间排队是合理的;后端 acquireImageSlot 自身有
 *       IMAGE_QUEUE_TIMEOUT_MS=10min 兜底(超时后 worker 标 job state='failed',前端 polling
 *       自然看到 terminal 状态结束)。用户失耐心可点 cancel(发 DELETE /api/image-jobs/<id>
 *       触发 worker controller.abort)。
 */

const STAGE_RATIO: Record<ImageJobState, number> = {
  pending: 0.05,
  running: 0.5,
  done: 1,
  failed: 0,
  cancelled: 0,
  // 兜底重写:出图阶段已经走完(50%),重写期间继续推进到 100%
  'fallback-rewrote': 1,
  'fallback-failed': 0,
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
        if (isSuccess(initial.state)) {
          result.value = initial
          running.value = false
          controller = null
          return initial
        }
        throw new Error(initial.errorMsg ?? `image job ${initial.state}`)
      }

      // dogfood 后:无前端 hard timeout。靠后端 image-semaphore (10min 排队 timeout) +
      // 用户 cancel 兜底。pending 长时间排队是合理状态,前端不该误超时。
      while (!ctrl.signal.aborted) {
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
        if (isSuccess(job.state)) {
          // done(出图成功) 或 fallback-rewrote(出图失败但兜底重写成功),
          // server slides.md 已写入新 imageSrc / 重写后的组件版页;主动调
          // slideStore.refresh() 把新内容同步给 DeckRenderer(Phase 10.5 后
          // 没有 Slidev HMR 自动刷新这条路径了)。
          // fallback-rewrote 时 errorMsg 含原因,调用方可读 result.value.state
          // 区分给 toast 文案。
          await useSlideStore().refresh()
          result.value = job
          running.value = false
          controller = null
          return job
        }
        if (job.state === 'failed' || job.state === 'fallback-failed') {
          // fallback-failed = 出图失败 + 兜底重写也失败,前端把 errorMsg 透传给用户,
          // 该页保留 *-image-content + 空 imageSrc(slides.md 不动)
          throw new Error(job.errorMsg ?? `image job ${job.state}`)
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
  return (
    s === 'done' ||
    s === 'failed' ||
    s === 'cancelled' ||
    s === 'fallback-rewrote' ||
    s === 'fallback-failed'
  )
}

/** Phase 11.6:done 与 fallback-rewrote 都视为"slides.md 已更新成功" */
function isSuccess(s: ImageJobState): boolean {
  return s === 'done' || s === 'fallback-rewrote'
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
