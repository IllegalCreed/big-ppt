import { ref, shallowRef } from 'vue'
import { useDecks, type SwitchJobInfo, type SwitchJobState } from './useDecks'

const FAST_INTERVAL_MS = 1_500
const SLOW_INTERVAL_MS = 3_000
const FAST_PHASE_MS = 45_000
const TOTAL_TIMEOUT_MS = 5 * 60_000

/** stage → progress 比例估算（视觉用，非真实进度） */
const STAGE_RATIO: Record<SwitchJobState, number> = {
  pending: 0.05,
  snapshotting: 0.2,
  migrating: 0.5,
  success: 1,
  failed: 0,
}

export type StartParams = { deckId: number; targetTemplateId: string }

export function useSwitchTemplateJob() {
  const { switchTemplate, getSwitchTemplateJob } = useDecks()

  const stage = ref<SwitchJobState>('pending')
  const progressRatio = ref(0)
  const error = ref<string | null>(null)
  const result = shallowRef<SwitchJobInfo | null>(null)
  const running = ref(false)

  let controller: AbortController | null = null
  let currentJobId: string | null = null
  let currentPromise: Promise<SwitchJobInfo> | null = null

  function reset() {
    stage.value = 'pending'
    progressRatio.value = 0
    error.value = null
    result.value = null
  }

  function abort() {
    if (currentPromise) {
      // 吞掉因 abort 导致的 rejected promise，防止 unhandled rejection
      currentPromise.catch(() => {})
      currentPromise = null
    }
    controller?.abort()
    controller = null
    running.value = false
  }

  function start(params: StartParams): Promise<SwitchJobInfo> {
    abort()
    reset()
    running.value = true
    const ctrl = new AbortController()
    controller = ctrl
    const promise = _doStart(params, ctrl)
    // 预挂 catch 防止 "aborted" / timeout 在 fake-timer 环境下变成 unhandled rejection。
    // 调用方持有同一 promise 引用，await 时仍可捕获到错误。
    promise.catch(() => {})
    currentPromise = promise
    return promise
  }

  async function _doStart(params: StartParams, ctrl: AbortController): Promise<SwitchJobInfo> {

    try {
      const { jobId, state } = await switchTemplate(params.deckId, params.targetTemplateId)
      if (ctrl.signal.aborted) throw new Error('aborted')
      currentJobId = jobId
      stage.value = state
      progressRatio.value = STAGE_RATIO[state]

      const deadline = Date.now() + TOTAL_TIMEOUT_MS
      const startTs = Date.now()

      while (!ctrl.signal.aborted) {
        if (Date.now() >= deadline) {
          throw new Error('switch job timeout (5min)')
        }
        const interval =
          Date.now() - startTs < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
        await sleep(interval, ctrl.signal)
        if (ctrl.signal.aborted) throw new Error('aborted')

        const { job } = await getSwitchTemplateJob(jobId)
        if (job.id !== currentJobId) continue
        stage.value = job.state
        // migrating 阶段根据轮询次数在 0.5 → 0.9 区间插值
        if (job.state === 'migrating') {
          progressRatio.value = Math.min(0.9, Math.max(progressRatio.value, STAGE_RATIO.migrating + 0.01))
        } else {
          progressRatio.value = STAGE_RATIO[job.state]
        }
        if (job.state === 'success') {
          result.value = job
          running.value = false
          controller = null
          return job
        }
        if (job.state === 'failed') {
          throw new Error(job.error ?? 'switch job failed')
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

  return { stage, progressRatio, error, result, running, start, abort }
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
