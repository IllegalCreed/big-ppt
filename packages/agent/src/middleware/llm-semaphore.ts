/**
 * Per-user LLM 并发排队（2026-04-29）。
 *
 * **不是 rate limit**:不丢请求,只是把超出 limit 的请求 await 排队等前面的释放。
 * 解决场景:智谱 GLM-5.1 上游硬限"并发 2",用户开多 tab / chat + 切模板并发用同一个
 * apiKey 时上游直接 429。retry 救不回(并发数没减),所以 agent 端做排队兜底。
 *
 * 与 Phase 9-E "LLM 代理刻意不挂 rate limit" 决策不冲突:
 * - rate limit:超过阈值丢请求,保护服务器
 * - 这里:超过阈值排队等待,保护用户的请求不被上游 429,agent 自己资源占用基本零
 *
 * 默认值:
 * - LLM_USER_CONCURRENCY=2 (匹配 GLM-5.1 上游限制)
 * - LLM_QUEUE_TIMEOUT_MS=60000 (排队超过 1 分钟拒,避免无限堆积)
 */

interface QueueEntry {
  resolve: () => void
  timer: NodeJS.Timeout
}

interface UserSlot {
  active: number
  queue: QueueEntry[]
}

const slots = new Map<number, UserSlot>()

function defaultLimit(): number {
  const v = Number(process.env.LLM_USER_CONCURRENCY)
  return Number.isFinite(v) && v > 0 ? v : 2
}
function defaultTimeoutMs(): number {
  const v = Number(process.env.LLM_QUEUE_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 60_000
}

export class LlmConcurrencyTimeoutError extends Error {
  constructor(userId: number, ms: number) {
    super(`LLM 并发排队超时(${ms}ms, user=${userId})。请等其他对话完成,或在设置里换 provider / 升级套餐。`)
    this.name = 'LlmConcurrencyTimeoutError'
  }
}

/**
 * 获取一个 LLM 调用 slot。返回 release 函数:**调用方必须在请求完成 / 失败 / 取消时调一次。**
 * - 当前 active < limit:立即 active++ 返回
 * - 否则进入 queue 等待;超过 timeoutMs 仍未拿到 → throw LlmConcurrencyTimeoutError
 * release 幂等(多次调用只生效一次)。
 */
export async function acquireLlmSlot(
  userId: number,
  opts: { limit?: number; timeoutMs?: number } = {},
): Promise<() => void> {
  const limit = opts.limit ?? defaultLimit()
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs()

  let slot = slots.get(userId)
  if (!slot) {
    slot = { active: 0, queue: [] }
    slots.set(userId, slot)
  }
  const s = slot

  if (s.active < limit) {
    s.active++
    return makeRelease(userId)
  }

  return new Promise<() => void>((resolveOuter, reject) => {
    const entry: QueueEntry = {
      resolve: () => {
        clearTimeout(entry.timer)
        s.active++
        resolveOuter(makeRelease(userId))
      },
      timer: setTimeout(() => {
        const idx = s.queue.indexOf(entry)
        if (idx >= 0) s.queue.splice(idx, 1)
        reject(new LlmConcurrencyTimeoutError(userId, timeoutMs))
      }, timeoutMs),
    }
    s.queue.push(entry)
  })
}

function makeRelease(userId: number): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    const slot = slots.get(userId)
    if (!slot) return
    slot.active = Math.max(0, slot.active - 1)
    const next = slot.queue.shift()
    if (next) next.resolve()
    if (slot.active === 0 && slot.queue.length === 0) {
      slots.delete(userId)
    }
  }
}

/** 仅测试用:清掉所有用户的排队 + active 计数,不解 timer 会泄漏,所以也清 timer */
export function __resetLlmSemaphoreForTesting(): void {
  for (const slot of slots.values()) {
    for (const entry of slot.queue) clearTimeout(entry.timer)
  }
  slots.clear()
}

/** 仅测试用:看某 user 当前 active / queueLen */
export function __getLlmSemaphoreStateForTesting(userId: number): { active: number; queueLen: number } {
  const slot = slots.get(userId)
  return { active: slot?.active ?? 0, queueLen: slot?.queue.length ?? 0 }
}
