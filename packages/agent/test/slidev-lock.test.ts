import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetForTesting,
  getHolder,
  heartbeat,
  isHeldBy,
  release,
  tryAcquire,
} from '../src/slidev-lock.js'

function holderPayload(sessionId: string, deckId = 1) {
  return {
    sessionId,
    userId: 10,
    userEmail: 'a@test.com',
    deckId,
    deckTitle: 'Deck #' + deckId,
  }
}

describe('slidev-lock', () => {
  beforeEach(() => {
    __resetForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('空锁下 tryAcquire 成功', () => {
    const result = tryAcquire(holderPayload('s1'))
    expect(result.ok).toBe(true)
    expect(getHolder()?.sessionId).toBe('s1')
  })

  it('同 session 再次 tryAcquire（换 deck）仍返回 ok', () => {
    expect(tryAcquire(holderPayload('s1', 1)).ok).toBe(true)
    const second = tryAcquire(holderPayload('s1', 2))
    expect(second.ok).toBe(true)
    expect(getHolder()?.deckId).toBe(2)
  })

  it('不同 session 抢占 → 返回 holder 信息', () => {
    tryAcquire(holderPayload('s1', 1))
    const result = tryAcquire(holderPayload('s2', 2))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.holder.sessionId).toBe('s1')
      expect(result.holder.deckId).toBe(1)
    }
  })

  it('heartbeat 持有者返回 true 且刷新 lastHeartbeatAt', async () => {
    tryAcquire(holderPayload('s1'))
    const before = getHolder()!.lastHeartbeatAt.getTime()
    await new Promise((r) => setTimeout(r, 5))
    expect(heartbeat('s1')).toBe(true)
    expect(getHolder()!.lastHeartbeatAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('heartbeat 非持有者返回 false', () => {
    tryAcquire(holderPayload('s1'))
    expect(heartbeat('sX')).toBe(false)
  })

  it('release 持有者后 getHolder 为 null', () => {
    tryAcquire(holderPayload('s1'))
    release('s1')
    expect(getHolder()).toBeNull()
  })

  it('release 非持有者 → 不报错不改状态（幂等）', () => {
    tryAcquire(holderPayload('s1'))
    release('sX')
    expect(getHolder()?.sessionId).toBe('s1')
    release('sX') // 再来一次仍然幂等
    expect(getHolder()?.sessionId).toBe('s1')
  })

  it('fakeTimer：超过 5 分钟心跳未刷新 → 自动视为释放', () => {
    vi.useFakeTimers()
    tryAcquire(holderPayload('s1'))
    expect(getHolder()?.sessionId).toBe('s1')
    vi.advanceTimersByTime(5 * 60 * 1000 + 100) // 5 分 100ms
    expect(getHolder()).toBeNull() // sweep 在 getter 内触发
  })

  it('fakeTimer 边界：4 分 59 秒仍持有', () => {
    vi.useFakeTimers()
    tryAcquire(holderPayload('s1'))
    vi.advanceTimersByTime(4 * 60 * 1000 + 59_000)
    expect(getHolder()?.sessionId).toBe('s1')
  })

  it('isHeldBy 三态：持有自己 / 他人持有 / 无锁', () => {
    expect(isHeldBy('s1')).toBe(false) // 无锁
    tryAcquire(holderPayload('s1'))
    expect(isHeldBy('s1')).toBe(true)
    expect(isHeldBy('s2')).toBe(false)
  })
})
