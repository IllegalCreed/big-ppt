/**
 * image-semaphore 单测(2026-05-06 dogfood 修复后引入)。
 *
 * 覆盖关键行为:
 * - 默认不超时:排队期间不消耗外部资源,等待本身没风险
 * - 显式 timeoutMs > 0 仍可启用,超时 throw ImageConcurrencyTimeoutError
 * - 上一个 slot release 后,排队中的下一个 entry 立刻被唤醒
 * - 配合 image-gen-job:出图失败后立刻 release(在 worker 跑 fallback 重写之前)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireImageSlot,
  ImageConcurrencyTimeoutError,
  __getImageSemaphoreStateForTesting,
  __resetImageSemaphoreForTesting,
} from '../src/middleware/image-semaphore.js'

beforeEach(() => {
  __resetImageSemaphoreForTesting()
})

afterEach(() => {
  __resetImageSemaphoreForTesting()
})

describe('image-semaphore', () => {
  it('limit 内的 acquire 立刻拿到 slot', async () => {
    const r1 = await acquireImageSlot(1, { limit: 2 })
    const r2 = await acquireImageSlot(1, { limit: 2 })
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 2, queueLen: 0 })
    r1()
    r2()
  })

  it('超 limit 的 acquire 进 queue,前面 release 后被唤醒', async () => {
    const r1 = await acquireImageSlot(1, { limit: 1 })
    expect(__getImageSemaphoreStateForTesting(1).active).toBe(1)

    let acquired = false
    const p2 = acquireImageSlot(1, { limit: 1 }).then((release) => {
      acquired = true
      return release
    })

    // 让微任务跑完,p2 应仍在排队
    await new Promise((r) => setImmediate(r))
    expect(acquired).toBe(false)
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 1, queueLen: 1 })

    r1()
    const r2 = await p2
    expect(acquired).toBe(true)
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 1, queueLen: 0 })
    r2()
  })

  it('默认不设 timeout(timeoutMs=0)→ 排队不超时,等到前面 release 才返回', async () => {
    vi.useFakeTimers()
    const r1 = await acquireImageSlot(1, { limit: 1 })
    let resolved = false
    const p2 = acquireImageSlot(1, { limit: 1 /* timeoutMs 默认 0 */ }).then((release) => {
      resolved = true
      return release
    })

    // 推进 1 小时,不应触发任何 timeout
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(resolved).toBe(false)
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 1, queueLen: 1 })

    vi.useRealTimers()
    r1()
    const r2 = await p2
    expect(resolved).toBe(true)
    r2()
  })

  it('显式 timeoutMs > 0 仍可启用,超时 throw ImageConcurrencyTimeoutError', async () => {
    vi.useFakeTimers()
    const r1 = await acquireImageSlot(1, { limit: 1 })

    const p2 = acquireImageSlot(1, { limit: 1, timeoutMs: 5_000 })
    // 5s 内没 release → reject
    const failed = p2.catch((e) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const err = await failed
    expect(err).toBeInstanceOf(ImageConcurrencyTimeoutError)
    expect((err as Error).message).toContain('user=1')

    vi.useRealTimers()
    r1()
  })

  it('release 幂等:多次调用只生效一次,不影响 active 计数', async () => {
    const r1 = await acquireImageSlot(1, { limit: 2 })
    const r2 = await acquireImageSlot(1, { limit: 2 })
    expect(__getImageSemaphoreStateForTesting(1).active).toBe(2)
    r1()
    r1() // 重复调
    r1() // 再调
    expect(__getImageSemaphoreStateForTesting(1).active).toBe(1)
    r2()
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  it('不同用户独立计数,互不干扰', async () => {
    const r1a = await acquireImageSlot(1, { limit: 1 })
    const r2a = await acquireImageSlot(2, { limit: 1 })
    expect(__getImageSemaphoreStateForTesting(1).active).toBe(1)
    expect(__getImageSemaphoreStateForTesting(2).active).toBe(1)
    r1a()
    r2a()
  })
})
