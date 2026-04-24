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
import { getManifest, readStarter } from '../templates/registry.js'
import {
  createJob,
  getJob,
  runSwitchJob,
  validateSwitchTarget,
  type RewriteFn,
} from '../template-switch-job.js'
import { rewriteForTemplate } from '../prompts/rewriteForTemplate.js'
import { getHolder } from '../slidev-lock.js'

type UserVars = AuthVars

export const decksRoute = new Hono<{ Variables: UserVars }>()

// Phase 6D：switch-template 的 LLM 重写函数，生产走 rewriteForTemplate，测试可注入 mock
let rewriteFnOverride: RewriteFn | null = null
export function __setRewriteFnForTesting(fn: RewriteFn | null): void {
  rewriteFnOverride = fn
}
function currentRewriteFn(): RewriteFn {
  return rewriteFnOverride ?? rewriteForTemplate
}

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
      templateId: decks.templateId,
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

  type CreateBody = { title?: string; initialContent?: string; templateId?: string }
  const body = await c.req.json<CreateBody>().catch((): CreateBody => ({}))
  const title = body.title?.trim() || '未命名幻灯片'
  const templateId = body.templateId?.trim() || 'company-standard'

  // 白名单校验：未知 templateId 直接拒绝，避免老 deck 后续激活时读不到 manifest
  const manifest = getManifest(templateId)
  if (!manifest) {
    return c.json({ error: `未知模板 ${templateId}` }, 400)
  }

  // 未显式传 initialContent 时，默认从模板 starter.md 加载（3 页骨架）
  let initialContent: string
  try {
    initialContent = body.initialContent ?? readStarter(templateId)
  } catch (err) {
    return c.json({ error: `读取模板 starter 失败: ${(err as Error).message}` }, 500)
  }

  const db = getDb()

  // 事务：插 deck → 插初始 version → 更新 deck.current_version_id；任一步失败整体回滚
  let createdId: number
  try {
    createdId = await db.transaction(async (tx) => {
      await tx.insert(decks).values({ userId: user.id, title, templateId })
      const [created] = await tx
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.userId, user.id), eq(decks.title, title)))
        .orderBy(desc(decks.id))
        .limit(1)
      if (!created) throw new Error('创建失败：deck 回查为空')

      await tx.insert(deckVersions).values({
        deckId: created.id,
        content: initialContent,
        message: `从模板 ${templateId} 初始化`,
        authorId: user.id,
      })
      const [firstVersion] = await tx
        .select({ id: deckVersions.id })
        .from(deckVersions)
        .where(eq(deckVersions.deckId, created.id))
        .orderBy(desc(deckVersions.id))
        .limit(1)
      if (!firstVersion) throw new Error('创建失败：version 回查为空')

      await tx
        .update(decks)
        .set({ currentVersionId: firstVersion.id })
        .where(eq(decks.id, created.id))
      return created.id
    })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500)
  }

  const [withVersion] = await db.select().from(decks).where(eq(decks.id, createdId)).limit(1)
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

// ─── Template Switch ───────────────────────────────────────────────────

/**
 * 发起模板切换：校验通过后创建 job 并异步跑流水，返回 jobId 供前端轮询。
 * 要求 body `{ targetTemplateId, confirmed: true }`，且 deck 当前若被他人占用 Slidev 则 409。
 */
decksRoute.post('/decks/:id{[0-9]+}/switch-template', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  type Body = { targetTemplateId?: string; confirmed?: boolean }
  const body = await c.req.json<Body>().catch((): Body => ({}))
  if (body.confirmed !== true) {
    return c.json({ error: '必须带 confirmed=true 才能切换模板' }, 400)
  }

  const targetTemplateId = body.targetTemplateId?.trim() ?? ''
  const validation = validateSwitchTarget(check.deck.templateId, targetTemplateId)
  if (!validation.ok) return c.json({ error: validation.error }, validation.status)

  // 单实例锁冲突：有人占用此 deck 且不是当前用户 → 拒绝（避免跟 mirror/活跃编辑竞态）
  const holder = getHolder()
  if (holder && holder.deckId === deckId && holder.userId !== user.id) {
    return c.json(
      {
        error: '该 deck 正被占用',
        holder: { userId: holder.userId, email: holder.userEmail },
      },
      409,
    )
  }

  const job = createJob({
    deckId,
    userId: user.id,
    from: check.deck.templateId,
    to: targetTemplateId,
  })

  // 异步执行流水：route 立即返回 jobId，前端轮询 GET /switch-template-jobs/:id
  void runSwitchJob(job.id, currentRewriteFn())

  return c.json({ jobId: job.id, state: job.state })
})

decksRoute.get('/switch-template-jobs/:jobId', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const jobId = c.req.param('jobId')
  const job = getJob(jobId)
  if (!job) return c.json({ error: 'job 不存在' }, 404)
  if (job.userId !== user.id) return c.json({ error: '无权访问该 job' }, 403)
  return c.json({ job })
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
