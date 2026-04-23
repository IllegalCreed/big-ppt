/**
 * 单实例占用锁路由：activate / release / heartbeat / status。
 *
 * `slidev_lock` 表只有 id=1 的单行，原子抢占通过
 *   UPDATE ... WHERE id=1 AND (holder IS NULL OR holder=me OR heartbeat 超时)
 * 的 affectedRows 判定。
 */
import { Hono } from 'hono'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { getDb, decks, deckVersions, sessions, slidevLock, users } from '../db/index.js'
import type { AuthVars } from '../middleware/auth.js'
import { mirrorSlidesContent } from '../deck/mirror.js'
import { setActiveDeckId } from '../context.js'

/** 心跳超时阈值（秒）；超过此时长未心跳自动判定为释放 */
const HEARTBEAT_TIMEOUT_SECONDS = 5 * 60
const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_TIMEOUT_SECONDS * 1000

export const lockRoute = new Hono<{ Variables: AuthVars }>()

/** 组装 holder 详情，包含邮箱 + deck 标题 + 持有时长信息，用于等待页 */
async function getHolderInfo() {
  const db = getDb()
  const [row] = await db
    .select({
      holderSessionId: slidevLock.holderSessionId,
      holderUserId: slidevLock.holderUserId,
      holderDeckId: slidevLock.holderDeckId,
      lockedAt: slidevLock.lockedAt,
      lastHeartbeatAt: slidevLock.lastHeartbeatAt,
    })
    .from(slidevLock)
    .where(eq(slidevLock.id, 1))
    .limit(1)
  if (!row || !row.holderSessionId) return null

  let email: string | null = null
  if (row.holderUserId) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.holderUserId)).limit(1)
    email = u?.email ?? null
  }
  let deckTitle: string | null = null
  if (row.holderDeckId) {
    const [d] = await db.select({ title: decks.title }).from(decks).where(eq(decks.id, row.holderDeckId)).limit(1)
    deckTitle = d?.title ?? null
  }
  return {
    sessionId: row.holderSessionId,
    userId: row.holderUserId,
    email,
    deckId: row.holderDeckId,
    deckTitle,
    lockedAt: row.lockedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
  }
}

/**
 * 激活 deck：原子抢占 slidev_lock，成功则把 deck 当前版本内容写回 slides.md。
 * 冲突返回 409 + holder 信息，前端据此渲染等待页。
 */
lockRoute.post('/activate-deck/:id{[0-9]+}', async (c) => {
  const user = c.get('user')
  const session = c.get('session')
  if (!user || !session) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const db = getDb()

  // 1. 验 deck 存在且归当前用户
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return c.json({ error: 'deck 不存在' }, 404)
  if (deck.userId !== user.id) return c.json({ error: '无权访问该 deck' }, 403)
  if (deck.status === 'deleted') return c.json({ error: 'deck 已删除' }, 404)

  // 2. 原子抢占：WHERE holder NULL | holder=me | 心跳超时
  // 阈值用 MySQL 原生 NOW() - INTERVAL；客户端+服务端会话均 UTC（见 db/client.ts），避免时区错位
  const now = new Date()
  const result = await db
    .update(slidevLock)
    .set({
      holderSessionId: session.id,
      holderUserId: user.id,
      holderDeckId: deckId,
      lockedAt: now,
      lastHeartbeatAt: now,
    })
    .where(
      and(
        eq(slidevLock.id, 1),
        or(
          isNull(slidevLock.holderSessionId),
          eq(slidevLock.holderSessionId, session.id),
          sql`${slidevLock.lastHeartbeatAt} < (NOW() - INTERVAL ${HEARTBEAT_TIMEOUT_SECONDS} SECOND)`,
        ),
      ),
    )

  // mysql2 返回 ResultSetHeader, drizzle 包成 [header, fields]；affectedRows 在 header[0].affectedRows
  const affected =
    Array.isArray(result) && result[0] && typeof (result[0] as { affectedRows?: number }).affectedRows === 'number'
      ? (result[0] as { affectedRows: number }).affectedRows
      : 0

  if (affected === 0) {
    // 抢占失败，返回当前持有者
    const holder = await getHolderInfo()
    return c.json({ error: 'occupied', holder }, 409)
  }

  // 3. 更新 session.active_deck_id + 心跳 + ALS
  await db
    .update(sessions)
    .set({ activeDeckId: deckId, lastHeartbeatAt: now })
    .where(eq(sessions.id, session.id))
  setActiveDeckId(deckId)

  // 4. 把当前版本内容 mirror 到 slides.md
  if (deck.currentVersionId) {
    const [version] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, deck.currentVersionId))
      .limit(1)
    if (version) {
      mirrorSlidesContent(version.content)
    }
  }

  return c.json({ ok: true, deckId })
})

/** 主动释放自己占用的锁（幂等）。 */
lockRoute.post('/release-deck', async (c) => {
  const session = c.get('session')
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const db = getDb()
  // 仅清理自己持有的锁（别人的锁不动）
  await db
    .update(slidevLock)
    .set({
      holderSessionId: null,
      holderUserId: null,
      holderDeckId: null,
      lockedAt: null,
      lastHeartbeatAt: null,
    })
    .where(and(eq(slidevLock.id, 1), eq(slidevLock.holderSessionId, session.id)))

  // 清 session.active_deck_id + ALS
  await db.update(sessions).set({ activeDeckId: null }).where(eq(sessions.id, session.id))
  setActiveDeckId(null)

  return c.json({ ok: true })
})

/** 刷新心跳（如果自己当前持有锁）。 */
lockRoute.post('/heartbeat', async (c) => {
  const session = c.get('session')
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const db = getDb()
  const now = new Date()
  await db.update(sessions).set({ lastHeartbeatAt: now }).where(eq(sessions.id, session.id))
  await db
    .update(slidevLock)
    .set({ lastHeartbeatAt: now })
    .where(and(eq(slidevLock.id, 1), eq(slidevLock.holderSessionId, session.id)))

  return c.json({ ok: true })
})

/** 查询当前锁状态（用于等待页轮询）。 */
lockRoute.get('/lock-status', async (c) => {
  const session = c.get('session')
  const holder = await getHolderInfo()
  if (!holder) return c.json({ locked: false })

  // 检查心跳是否过期；过期则视为"未锁定"，前端可直接再次 activate
  if (holder.lastHeartbeatAt) {
    const age = Date.now() - holder.lastHeartbeatAt.getTime()
    if (age > HEARTBEAT_TIMEOUT_MS) {
      return c.json({ locked: false, stale: true })
    }
  }

  const isMe = !!session && holder.sessionId === session.id
  return c.json({ locked: true, holder, isMe })
})
