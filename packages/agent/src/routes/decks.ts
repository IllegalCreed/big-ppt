/**
 * Deck 相关路由：CRUD + 版本 + 对话历史。
 * 单实例占用锁相关端点在 routes/lock.ts。
 *
 * 所有端点都要求登录；且所有 deckId 操作都会先校验 ownership。
 */
import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb, decks, deckVersions, deckChats } from '../db/index.js'
import type { AuthVars } from '../middleware/auth.js'
import { DEFAULT_DECK_CONTENT } from '../deck/default-content.js'

type UserVars = AuthVars

export const decksRoute = new Hono<{ Variables: UserVars }>()

// ─── 辅助：查当前用户的 deck，附带 ownership 检查 ───────────────────────

async function getOwnedDeck(userId: number, deckId: number) {
  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return { ok: false as const, status: 404 as const, error: 'deck 不存在' }
  if (deck.userId !== userId) return { ok: false as const, status: 403 as const, error: '无权访问该 deck' }
  return { ok: true as const, deck }
}

async function getCurrentVersion(deckId: number, versionId: number | null) {
  if (!versionId) return null
  const db = getDb()
  const [v] = await db
    .select()
    .from(deckVersions)
    .where(and(eq(deckVersions.id, versionId), eq(deckVersions.deckId, deckId)))
    .limit(1)
  return v ?? null
}

// ─── List / Create ─────────────────────────────────────────────────────

decksRoute.get('/decks', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const db = getDb()
  const rows = await db
    .select({
      id: decks.id,
      title: decks.title,
      themeId: decks.themeId,
      status: decks.status,
      currentVersionId: decks.currentVersionId,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .where(and(eq(decks.userId, user.id), inArray(decks.status, ['active', 'archived'])))
    .orderBy(desc(decks.updatedAt))
  return c.json({ decks: rows })
})

decksRoute.post('/decks', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  type CreateBody = { title?: string; initialContent?: string }
  const body = await c.req.json<CreateBody>().catch((): CreateBody => ({}))
  const title = body.title?.trim() || '未命名幻灯片'
  const initialContent = body.initialContent ?? DEFAULT_DECK_CONTENT

  const db = getDb()

  // 事务：插 deck → 插初始 version → 更新 deck.current_version_id
  await db.insert(decks).values({ userId: user.id, title })
  const [created] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, user.id), eq(decks.title, title)))
    .orderBy(desc(decks.id))
    .limit(1)
  if (!created) return c.json({ error: '创建失败' }, 500)

  await db.insert(deckVersions).values({
    deckId: created.id,
    content: initialContent,
    message: 'initial',
    authorId: user.id,
  })
  const [firstVersion] = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, created.id))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  if (firstVersion) {
    await db.update(decks).set({ currentVersionId: firstVersion.id }).where(eq(decks.id, created.id))
  }

  const [withVersion] = await db.select().from(decks).where(eq(decks.id, created.id)).limit(1)
  return c.json({ deck: withVersion }, 201)
})

// ─── Get / Update / Delete ────────────────────────────────────────────

decksRoute.get('/decks/:id{[0-9]+}', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  const currentVersion = await getCurrentVersion(check.deck.id, check.deck.currentVersionId)

  const versions = await db
    .select({
      id: deckVersions.id,
      message: deckVersions.message,
      turnId: deckVersions.turnId,
      authorId: deckVersions.authorId,
      createdAt: deckVersions.createdAt,
    })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, check.deck.id))
    .orderBy(desc(deckVersions.createdAt))
    .limit(100)

  return c.json({
    deck: check.deck,
    currentVersion,
    versions,
  })
})

decksRoute.put('/decks/:id{[0-9]+}', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  type PutBody = { title?: string; status?: 'active' | 'archived' }
  const body = await c.req.json<PutBody>().catch((): PutBody => ({}))
  const patch: PutBody = {}
  if (body.title !== undefined) {
    const t = body.title.trim()
    if (!t) return c.json({ error: 'title 不能为空' }, 400)
    patch.title = t
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'archived') {
      return c.json({ error: "status 只能是 'active' 或 'archived'" }, 400)
    }
    patch.status = body.status
  }
  if (Object.keys(patch).length === 0) return c.json({ error: '没有可更新字段' }, 400)

  const db = getDb()
  await db.update(decks).set(patch).where(eq(decks.id, deckId))
  const [updated] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  return c.json({ deck: updated })
})

decksRoute.delete('/decks/:id{[0-9]+}', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  await db.update(decks).set({ status: 'deleted' }).where(eq(decks.id, deckId))
  return c.json({ ok: true })
})

// ─── Versions ───────────────────────────────────────────────────────────

decksRoute.get('/decks/:id{[0-9]+}/versions', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  const versions = await db
    .select({
      id: deckVersions.id,
      message: deckVersions.message,
      turnId: deckVersions.turnId,
      authorId: deckVersions.authorId,
      createdAt: deckVersions.createdAt,
    })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deckId))
    .orderBy(desc(deckVersions.createdAt))
    .limit(200)
  return c.json({ versions })
})

/** 回滚：把 current_version_id 指到指定历史 version（不新增 version） */
decksRoute.post('/decks/:id{[0-9]+}/restore/:vid{[0-9]+}', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const versionId = Number(c.req.param('vid'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  const [version] = await db
    .select()
    .from(deckVersions)
    .where(and(eq(deckVersions.id, versionId), eq(deckVersions.deckId, deckId)))
    .limit(1)
  if (!version) return c.json({ error: '版本不存在' }, 404)

  await db.update(decks).set({ currentVersionId: versionId }).where(eq(decks.id, deckId))

  // 若当前 session 正占用该 deck，mirror 到 fs，让 Slidev 热重载
  const session = c.get('session')
  if (session?.activeDeckId === deckId) {
    const { mirrorSlidesContent } = await import('../deck/mirror.js')
    mirrorSlidesContent(version.content)
  }

  return c.json({ version })
})

// ─── Chats ──────────────────────────────────────────────────────────────

decksRoute.get('/decks/:id{[0-9]+}/chats', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  const chats = await db
    .select()
    .from(deckChats)
    .where(eq(deckChats.deckId, deckId))
    .orderBy(deckChats.createdAt)
    .limit(1000)
  return c.json({ chats })
})

decksRoute.post('/decks/:id{[0-9]+}/chats', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  type ChatBody = {
    role?: 'system' | 'user' | 'assistant' | 'tool'
    content?: string
    toolCallId?: string
  }
  const body = await c.req.json<ChatBody>().catch((): ChatBody => ({}))
  if (!body.role || !['system', 'user', 'assistant', 'tool'].includes(body.role)) {
    return c.json({ error: 'role 非法' }, 400)
  }
  if (body.content === undefined || body.content === null) {
    return c.json({ error: 'content 不能为空' }, 400)
  }

  const db = getDb()
  await db.insert(deckChats).values({
    deckId,
    role: body.role,
    content: body.content,
    toolCallId: body.toolCallId ?? null,
  })
  return c.json({ ok: true }, 201)
})
