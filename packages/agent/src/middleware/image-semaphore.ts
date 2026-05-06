/**
 * Per-user image-gen 并发排队(Phase 11.6 dogfood 后引入)。
 *
 * **不是 rate limit**:不丢请求,只是把超出 limit 的请求 await 排队等前面的释放。
 * 解决场景:Phase 11.6 图片优先模式下,LLM 一 turn 内对 N 个内容页发 N 个 generate_slide_image
 * tool_call → 后台 worker 全并发跑 OpenAI image API → tier 1 RPS 5/min 被打爆,部分 job
 * 撞 429 fail。retry 救不回(并发数没减),所以 agent 端做排队兜底。
 *
 * 跟 llm-semaphore 对称(独立计数,各自管 chat / image 上游配额):
 * - llm-semaphore:chat completion 用,默认 limit 2(GLM-5.1 上游硬限"并发 2")
 * - image-semaphore:openai-image 用,默认 limit 3(OpenAI tier 1 安全值,1 张图约 30s)
 *
 * 默认值:
 * - IMAGE_USER_CONCURRENCY=3 (OpenAI tier 1 RPS 5,留余量)
 * - IMAGE_QUEUE_TIMEOUT_MS=0 (不限时;排队不消耗外部资源,等待本身没风险)
 *
 * Queue timeout 历史:
 * - 初版默认 600_000ms(10 分钟),设计意图是"防 zombie 排队"
 * - 2026-05-06 dogfood 实战:OpenAI 中转 503 时排队尾部撞 timeout 集体红叉(详见 image-gen-job.ts 同期 fix)
 * - 反思:排队期间没占任何外部配额,设 timeout 没保护意义。zombie 唯一可能是前面 slot
 *   release 漏掉,那是 caller 的 bug(image-gen-job.ts finally 已兜底)。
 *   改默认不限时,prod 操作员通过 cancel API / 重启进程兜底极端情况。
 *   IMAGE_QUEUE_TIMEOUT_MS 仍保留(传 > 0 显式启用),便于将来需要时再开。
 */

interface QueueEntry {
  resolve: () => void
  /** 仅当 timeoutMs > 0 时设置;无超时排队时为 null */
  timer: NodeJS.Timeout | null
}

interface UserSlot {
  active: number
  queue: QueueEntry[]
}

const slots = new Map<number, UserSlot>()

function defaultLimit(): number {
  const v = Number(process.env.IMAGE_USER_CONCURRENCY)
  return Number.isFinite(v) && v > 0 ? v : 3
}
function defaultTimeoutMs(): number {
  // 不设 / 非数字 / ≤0 → 0 = 不超时;显式传正整数才启用 timeout
  const raw = process.env.IMAGE_QUEUE_TIMEOUT_MS
  if (raw === undefined) return 0
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : 0
}

export class ImageConcurrencyTimeoutError extends Error {
  constructor(userId: number, ms: number) {
    super(
      `Image 并发排队超时(${ms}ms, user=${userId})。同一时间排队的生图任务太多,请等当前队列消化或减少同时生成的页数。`,
    )
    this.name = 'ImageConcurrencyTimeoutError'
  }
}

/**
 * 获取一个 image-gen slot。返回 release 函数:**调用方必须在请求完成 / 失败 / 取消时调一次。**
 * - 当前 active < limit:立即 active++ 返回
 * - 否则进入 queue 等待
 *   - timeoutMs > 0:超过 timeoutMs 仍未拿到 → throw ImageConcurrencyTimeoutError
 *   - timeoutMs ≤ 0(默认):**不超时**,一直等到前面 slot release 唤醒
 * release 幂等(多次调用只生效一次)。
 */
export async function acquireImageSlot(
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
        if (entry.timer) clearTimeout(entry.timer)
        s.active++
        resolveOuter(makeRelease(userId))
      },
      timer:
        timeoutMs > 0
          ? setTimeout(() => {
              const idx = s.queue.indexOf(entry)
              if (idx >= 0) s.queue.splice(idx, 1)
              reject(new ImageConcurrencyTimeoutError(userId, timeoutMs))
            }, timeoutMs)
          : null,
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

/** 仅测试用:清掉所有用户的排队 + active 计数 */
export function __resetImageSemaphoreForTesting(): void {
  for (const slot of slots.values()) {
    for (const entry of slot.queue) {
      if (entry.timer) clearTimeout(entry.timer)
    }
  }
  slots.clear()
}

/** 仅测试用:看某 user 当前 active / queueLen */
export function __getImageSemaphoreStateForTesting(userId: number): {
  active: number
  queueLen: number
} {
  const slot = slots.get(userId)
  return { active: slot?.active ?? 0, queueLen: slot?.queue.length ?? 0 }
}
