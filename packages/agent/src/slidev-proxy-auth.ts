/**
 * Slidev 反代的鉴权守卫。独立模块方便单元测试（不启动 http server）。
 */
import { validateSessionFromCookie } from './middleware/auth.js'
import { isHeldBy } from './slidev-lock.js'

export type SlidevAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string }

/**
 * 反代前置鉴权规则：
 * 1. 必须有有效 session（未登录 → 401）
 * 2. 必须是当前单实例锁持有者（登录但非持有 → 403）
 *
 * HTTP 与 WebSocket upgrade 两条路径都应用同一套规则。
 */
export async function authorizeSlidevAccess(cookieHeader: string | undefined): Promise<SlidevAuthResult> {
  const row = await validateSessionFromCookie(cookieHeader)
  if (!row) return { ok: false, status: 401, message: 'unauthorized' }
  if (!isHeldBy(row.session.id)) {
    return { ok: false, status: 403, message: 'slidev 实例当前未被你占用；请先 activate-deck' }
  }
  return { ok: true }
}
