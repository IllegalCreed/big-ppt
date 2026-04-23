/**
 * 全局单实例 Slidev 占用锁（进程内）。
 *
 * Phase 5 只有一个 agent 进程，所以锁直接放内存里最简单。
 * - Node 单线程 → 操作天然原子
 * - agent 重启 → 锁自然清零，用户重连时重新 activate
 * - 心跳超过 5 分钟未刷新 → 视为已释放（防止用户强退留下死锁）
 * - Phase 6 多实例/进程池架构启动后，单全局锁不再适用，本模块退役
 */

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000

export type LockHolder = {
  sessionId: string
  userId: number
  userEmail: string
  deckId: number
  deckTitle: string
  lockedAt: Date
  lastHeartbeatAt: Date
}

let currentLock: LockHolder | null = null

function isStale(holder: LockHolder): boolean {
  return Date.now() - holder.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS
}

/** 读取前自动清理 stale，保证 getStatus 返回的永远是有效锁 */
function sweepStale(): void {
  if (currentLock && isStale(currentLock)) currentLock = null
}

export function tryAcquire(candidate: Omit<LockHolder, 'lockedAt' | 'lastHeartbeatAt'>):
  | { ok: true }
  | { ok: false; holder: LockHolder } {
  sweepStale()
  if (!currentLock) {
    currentLock = { ...candidate, lockedAt: new Date(), lastHeartbeatAt: new Date() }
    return { ok: true }
  }
  if (currentLock.sessionId === candidate.sessionId) {
    // 同一 session 重复 activate（比如切不同 deck）→ 允许，覆盖
    currentLock = { ...candidate, lockedAt: currentLock.lockedAt, lastHeartbeatAt: new Date() }
    return { ok: true }
  }
  return { ok: false, holder: { ...currentLock } }
}

/** 刷新持有者心跳；返回 true 表示当前 session 确实持有锁 */
export function heartbeat(sessionId: string): boolean {
  sweepStale()
  if (currentLock?.sessionId === sessionId) {
    currentLock.lastHeartbeatAt = new Date()
    return true
  }
  return false
}

/** 主动释放（只有自己持有时才真释放；幂等） */
export function release(sessionId: string): void {
  if (currentLock?.sessionId === sessionId) {
    currentLock = null
  }
}

export function getHolder(): LockHolder | null {
  sweepStale()
  return currentLock ? { ...currentLock } : null
}

/** 判断某 session 是否是当前持有者（反代鉴权时用） */
export function isHeldBy(sessionId: string): boolean {
  sweepStale()
  return currentLock?.sessionId === sessionId
}

/** @internal 仅供测试：清掉模块级单例锁，保证每个 test case 独立状态 */
export function __resetForTesting(): void {
  currentLock = null
}
