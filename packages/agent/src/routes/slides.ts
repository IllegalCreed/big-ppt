import fs from 'node:fs'
import { Hono, type Context } from 'hono'
import { redoSlides, restoreSlides, NoActiveDeckError } from '../slides-store/index.js'
import { setActiveDeckId } from '../context.js'
import { type AuthVars } from '../middleware/auth.js'
import { getHolder, isHeldBy } from '../slidev-lock.js'
import { getPaths } from '../workspace.js'
import { mirrorSlidesContent } from '../deck/mirror.js'
import { getDb, decks, deckVersions } from '../db/index.js'
import { eq, and } from 'drizzle-orm'

export const slides = new Hono<{ Variables: AuthVars }>()

/**
 * Phase 9-B（A01）：slides.md 是 server-wide mirror（lock holder 持有），
 * 仅 lock holder 可读 / undo / redo —— 否则 B 用户读到 A 的 deck 内容。
 *
 * 守卫策略：
 *   - 未登录 → 401
 *   - 登录但未持锁 → 403（前端会显示 OccupiedWaitingPage）
 *
 * 不用 `slides.use('*', mw)`：Hono 子 router 通过 `app.route('/api', slides)`
 * 挂载后，`*` 会匹配 /api/* 所有路径（影响 list-templates 等其他子 router 的公开
 * 端点）。改为显式列三条 path —— `*` middleware 只在 sub-router 是顶层 app 时安全。
 *
 * P0 security fix(2026-05-18,2026-05-18):slides-store 改 DB-based 后,这三条路由的语义:
 *   - /read-slides:返回 slides.md 文件 mirror 内容(给 Slidev SPA 放映 tab 用);
 *     lock holder POST /present/:id 时已 mirrorSlidesContent,文件是其 DB 内容快照。
 *     **不再调用 readSlides()**(它现在读 DB,需要 ALS deckId),直接从文件读。
 *   - /restore-slides /redo-slides:从 lock holder 的 lock object 拿 deckId,注入 ALS,
 *     再调 DB-based 的 restoreSlides / redoSlides。成功后把新 currentVersion 内容
 *     mirror 回 slides.md(否则 Slidev SPA tab 还在显示老版本)。
 */
const requireLockHolder: import('hono').MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const session = c.get('session')
  if (!session) return c.json({ success: false, error: 'unauthorized' }, 401)
  if (!isHeldBy(session.id)) {
    return c.json({ success: false, error: '需要先 present（全屏放映）占用 Slidev 实例' }, 403)
  }
  const holder = getHolder()
  if (!holder) return c.json({ success: false, error: '未持有放映锁' }, 403)
  const [deck] = await getDb()
    .select({ id: decks.id, status: decks.status })
    .from(decks)
    .where(and(eq(decks.id, holder.deckId), eq(decks.userId, holder.userId)))
    .limit(1)
  if (!deck || deck.status === 'deleted') {
    return c.json({ success: false, error: 'deck 已删除' }, 404)
  }
  await next()
}
slides.use('/read-slides', requireLockHolder)
slides.use('/restore-slides', requireLockHolder)
slides.use('/redo-slides', requireLockHolder)

// 返回 slides.md mirror 文件原文(由 lock holder POST /present/:id 时写入)。
// 给 Slidev SPA 放映 tab 用的纯 mirror 视图,不走 DB。
function readMirrorFile(): string {
  const { slidesPath } = getPaths()
  try {
    return fs.readFileSync(slidesPath, 'utf-8')
  } catch {
    return ''
  }
}

slides.post('/read-slides', (c) => {
  try {
    const content = readMirrorFile()
    return c.text(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
// GET 兼容
slides.get('/read-slides', (c) => {
  try {
    const content = readMirrorFile()
    return c.text(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

/** undo/redo 完成后把新 currentVersion 内容 mirror 回 slides.md,让 Slidev SPA HMR 推到放映 tab。 */
async function mirrorAfterMutation(deckId: number, userId: number): Promise<void> {
  const db = getDb()
  const [deck] = await db
    .select({ currentVersionId: decks.currentVersionId })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1)
  if (!deck?.currentVersionId) return
  const [version] = await db
    .select({ content: deckVersions.content })
    .from(deckVersions)
    .where(eq(deckVersions.id, deck.currentVersionId))
    .limit(1)
  if (version) mirrorSlidesContent(version.content)
}

async function handleHistoryAction(
  c: Context<{ Variables: AuthVars }>,
  action: () => Promise<{ success: boolean; error?: string; message?: string }>,
) {
  const holder = getHolder()
  if (!holder) {
    return c.json({ success: false, error: '未持有放映锁' }, 403)
  }
  setActiveDeckId(holder.deckId)
  try {
    const result = await action()
    if (result.success) {
      await mirrorAfterMutation(holder.deckId, holder.userId)
    }
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    if (err instanceof NoActiveDeckError) {
      return c.json({ success: false, error: err.message }, 404)
    }
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
}

// /undo 斜杠指令：回到上一个历史版本
slides.post('/restore-slides', (c) => handleHistoryAction(c, () => restoreSlides()))
// GET 兼容
slides.get('/restore-slides', (c) => handleHistoryAction(c, () => restoreSlides()))

// /redo 斜杠指令：前进到下一个历史版本
slides.post('/redo-slides', (c) => handleHistoryAction(c, () => redoSlides()))
slides.get('/redo-slides', (c) => handleHistoryAction(c, () => redoSlides()))
