/**
 * 单实例占用锁路由：activate / release / heartbeat / status。
 *
 * 锁状态存 agent 进程内存（src/slidev-lock.ts），不进 DB。
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, decks, deckVersions, sessions } from '../db/index.js'
import type { AuthVars } from '../middleware/auth.js'
import { mirrorSlidesContent } from '../deck/mirror.js'
import { setActiveDeckId } from '../context.js'
import { getHolder, heartbeat, release, tryAcquire, type LockHolder } from '../slidev-lock.js'

export const lockRoute = new Hono<{ Variables: AuthVars }>()

function toWireHolder(h: LockHolder) {
  return {
    sessionId: h.sessionId,
    userId: h.userId,
    email: h.userEmail,
    deckId: h.deckId,
    deckTitle: h.deckTitle,
    lockedAt: h.lockedAt,
    lastHeartbeatAt: h.lastHeartbeatAt,
  }
}

/**
 * 激活 deck：内存级原子抢占，成功则把 deck 当前版本内容写回 slides.md。
 * 冲突返回 409 + holder 信息，前端据此渲染等待页。
 */
lockRoute.post('/activate-deck/:id{[0-9]+}', async (c) => {
  const user = c.get('user')
  const session = c.get('session')
  if (!user || !session) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const db = getDb()

  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return c.json({ error: 'deck 不存在' }, 404)
  if (deck.userId !== user.id) return c.json({ error: '无权访问该 deck' }, 403)
  if (deck.status === 'deleted') return c.json({ error: 'deck 已删除' }, 404)

  const result = tryAcquire({
    sessionId: session.id,
    userId: user.id,
    userEmail: user.email,
    deckId,
    deckTitle: deck.title,
  })
  if (!result.ok) {
    return c.json({ error: 'occupied', holder: toWireHolder(result.holder) }, 409)
  }

  // 更新 session.active_deck_id + ALS
  await db.update(sessions).set({ activeDeckId: deckId }).where(eq(sessions.id, session.id))
  setActiveDeckId(deckId)

  // 把当前版本内容 mirror 到 slides.md
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

  release(session.id)

  const db = getDb()
  await db.update(sessions).set({ activeDeckId: null }).where(eq(sessions.id, session.id))
  setActiveDeckId(null)

  return c.json({ ok: true })
})

/** 刷新心跳（如果自己当前持有锁）。 */
lockRoute.post('/heartbeat', async (c) => {
  const session = c.get('session')
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const held = heartbeat(session.id)
  return c.json({ ok: true, heldByMe: held })
})

/** 查询当前锁状态（用于等待页轮询）。 */
lockRoute.get('/lock-status', async (c) => {
  const session = c.get('session')
  const holder = getHolder()
  if (!holder) return c.json({ locked: false })
  const isMe = !!session && holder.sessionId === session.id
  return c.json({ locked: true, holder: toWireHolder(holder), isMe })
})
