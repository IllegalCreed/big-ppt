// packages/agent/test/llm-semaphore.test.ts
/**
 * Per-user LLM 并发 semaphore(2026-04-29)。
 * 验证:active < limit 立即拿到 / 超出排队 / release 唤醒队首 / 超时 reject /
 *      release 幂等 / 不同 user 互不干扰。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireLlmSlot,
  LlmConcurrencyTimeoutError,
  __resetLlmSemaphoreForTesting,
  __getLlmSemaphoreStateForTesting,
} from '../src/middleware/llm-semaphore.js'

beforeEach(() => __resetLlmSemaphoreForTesting())
afterEach(() => __resetLlmSemaphoreForTesting())

describe('acquireLlmSlot', () => {
  it('active < limit 立即返回 release', async () => {
    const r1 = await acquireLlmSlot(1, { limit: 2 })
    const r2 = await acquireLlmSlot(1, { limit: 2 })
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 2, queueLen: 0 })
    r1()
    r2()
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  it('超出 limit 进入 queue,前面 release 后唤醒', async () => {
    const r1 = await acquireLlmSlot(1, { limit: 2 })
    const r2 = await acquireLlmSlot(1, { limit: 2 })
    // 第三个排队
    let r3Resolved = false
    const p3 = acquireLlmSlot(1, { limit: 2 }).then((r) => {
      r3Resolved = true
      return r
    })
    // 让事件循环跑一下
    await new Promise((r) => setTimeout(r, 10))
    expect(r3Resolved).toBe(false)
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 2, queueLen: 1 })

    r1()
    const r3 = await p3
    expect(r3Resolved).toBe(true)
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 2, queueLen: 0 })

    r2()
    r3()
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  it('排队超时抛 LlmConcurrencyTimeoutError', async () => {
    const r1 = await acquireLlmSlot(1, { limit: 1 })
    await expect(acquireLlmSlot(1, { limit: 1, timeoutMs: 30 })).rejects.toBeInstanceOf(
      LlmConcurrencyTimeoutError,
    )
    // 超时拒绝后应已从 queue 移除,不会让 release 误唤醒空 slot
    r1()
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  it('release 幂等(多次调用只生效一次)', async () => {
    const r1 = await acquireLlmSlot(1, { limit: 1 })
    r1()
    r1()
    r1()
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  it('不同 user 互不干扰', async () => {
    const a1 = await acquireLlmSlot(1, { limit: 1 })
    // user 2 仍能立即拿到自己的 slot
    const b1 = await acquireLlmSlot(2, { limit: 1 })
    expect(__getLlmSemaphoreStateForTesting(1)).toEqual({ active: 1, queueLen: 0 })
    expect(__getLlmSemaphoreStateForTesting(2)).toEqual({ active: 1, queueLen: 0 })
    a1()
    b1()
  })

  it('唤醒顺序 FIFO', async () => {
    const r1 = await acquireLlmSlot(1, { limit: 1 })
    const order: number[] = []
    const p2 = acquireLlmSlot(1, { limit: 1 }).then((r) => {
      order.push(2)
      return r
    })
    const p3 = acquireLlmSlot(1, { limit: 1 }).then((r) => {
      order.push(3)
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    r1()
    const r2 = await p2
    expect(order).toEqual([2])
    r2()
    const r3 = await p3
    expect(order).toEqual([2, 3])
    r3()
  })
})
