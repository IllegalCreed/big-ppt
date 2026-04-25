/**
 * Slidev 反代的鉴权守卫。独立模块方便单元测试（不启动 http server）。
 */
import { eq, and } from 'drizzle-orm'
import { validateSessionFromCookie } from './middleware/auth.js'
import { isHeldBy, getHolder, tryAcquire } from './slidev-lock.js'
import { getDb, decks } from './db/index.js'

export type SlidevAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string }

/**
 * 反代前置鉴权规则：
 * 1. 必须有有效 session（未登录 → 401）
 * 2. 必须是当前单实例锁持有者（登录但非持有 → 403）
 *
 * Phase 7D fix（dev 重启失锁兜底）：
 *   tsx watch / dev agent 重启后内存锁清零，但用户 session.activeDeckId 仍在 DB。
 *   如果当前没人持锁、且当前 session 已激活过 deck、且 deck 仍属于这个用户，
 *   视为 agent 重启复位，自动 reacquire 锁——避免用户每次改代码都得手动重 activate。
 *   被别人抢了 / 用户从未 activate 过 / deck 已删 → 仍走 403 走正常 activate 流。
 *
 * HTTP 与 WebSocket upgrade 两条路径都应用同一套规则。
 */
export async function authorizeSlidevAccess(cookieHeader: string | undefined): Promise<SlidevAuthResult> {
  const row = await validateSessionFromCookie(cookieHeader)
  if (!row) return { ok: false, status: 401, message: 'unauthorized' }

  if (isHeldBy(row.session.id)) return { ok: true }

  // 自动复位：仅在锁完全空闲时尝试，不抢别人的锁
  if (getHolder() === null && row.session.activeDeckId != null) {
    const db = getDb()
    const [deck] = await db
      .select({ id: decks.id, title: decks.title, status: decks.status })
      .from(decks)
      .where(and(eq(decks.id, row.session.activeDeckId), eq(decks.userId, row.user.id)))
      .limit(1)
    if (deck && deck.status === 'active') {
      const acq = tryAcquire({
        sessionId: row.session.id,
        userId: row.user.id,
        userEmail: row.user.email,
        deckId: deck.id,
        deckTitle: deck.title,
      })
      if (acq.ok) return { ok: true }
    }
  }

  return { ok: false, status: 403, message: 'slidev 实例当前未被你占用；请先 activate-deck' }
}
