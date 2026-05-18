/**
 * Phase 15.x P0 security hotfix(2026-05-18):history undo/redo 改为纯 DB,基于 deck_versions
 * append-only 表 + decks.currentVersionId 指针,删旧 fs ring buffer。
 *
 * 旧版(Phase 4)用 fs ring buffer(`data/slides-history/<sha1(slidesPath)>/`),全局共享
 * 跟 slides.md 一样存在跨账号/跨 deck 漏洞。新版每个 deck 自己一条版本链:
 *
 * - 写入:同 turnId 覆盖最末版本;新 turn append + 截断 `id > currentVersionId` 的 future 版本
 *   + 环形裁剪(最早行 DELETE,保留 MAX 条)。
 * - undo:在 deck 的 versions 里找 `id < currentVersionId` ORDER BY id DESC LIMIT 1。
 * - redo:在 deck 的 versions 里找 `id > currentVersionId` ORDER BY id ASC LIMIT 1。
 * - 位置:`{index: K, total: N}` where total = count by deck, K = rank-by-id-asc of currentVersionId。
 *
 * 设计选择:
 * - 不要 ON DELETE CASCADE 的反方向 — current_version_id 是 nullable;删 versions 后 deck 行
 *   保留(`currentVersionId` 可指向新的 latest 或 NULL)。
 * - "未访问过 deck"(currentVersionId NULL)→ undo / redo 都返 success:false。
 * - 没 ALS userId / activeDeckId → `NoActiveDeckError`,上游友好返错给 LLM。
 *
 * 仍保留 `BIG_PPT_HISTORY_MAX` env(默认 20),按"该 deck 总 version 行数"裁剪最早。
 */
import { and, asc, count, desc, eq, gt, lt, sql } from 'drizzle-orm'
import type { HistoryPosition } from '@big-ppt/shared'
import { getDb, decks, deckVersions } from '../db/index.js'
import { getRequestContext } from '../context.js'
import { NoActiveDeckError } from './errors.js'

function getMaxHistory(): number {
  const n = Number(process.env.BIG_PPT_HISTORY_MAX)
  return Number.isFinite(n) && n >= 2 ? n : 20
}

export interface HistoryActionResult {
  success: boolean
  message?: string
  position?: HistoryPosition
  error?: string
}

interface DeckGuard {
  id: number
  templateId: string
  currentVersionId: number | null
}

/** 从 ALS 拿 (userId, activeDeckId) + 校归属;失败抛 NoActiveDeckError。 */
async function loadDeckGuard(): Promise<DeckGuard> {
  const rc = getRequestContext()
  if (!rc.userId || !rc.activeDeckId) {
    throw new NoActiveDeckError()
  }
  const db = getDb()
  const [deck] = await db
    .select({
      id: decks.id,
      templateId: decks.templateId,
      currentVersionId: decks.currentVersionId,
    })
    .from(decks)
    .where(and(eq(decks.id, rc.activeDeckId), eq(decks.userId, rc.userId)))
    .limit(1)
  if (!deck) {
    throw new NoActiveDeckError('当前 deck 不存在或无权访问')
  }
  return deck
}

async function getVersionPosition(deckId: number, versionId: number): Promise<HistoryPosition | undefined> {
  const db = getDb()
  const [{ total }] = (await db
    .select({ total: count() })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deckId))) as [{ total: number }]
  if (total === 0) return undefined
  const [{ rank }] = (await db
    .select({ rank: count() })
    .from(deckVersions)
    .where(and(eq(deckVersions.deckId, deckId), lt(deckVersions.id, versionId)))) as [{ rank: number }]
  return { index: rank + 1, total }
}

/**
 * 写入一份新内容到当前 deck 的 deck_versions,同步推进 currentVersionId。
 *
 * 行为:
 * 1. 校 ALS userId / activeDeckId(NoActiveDeckError 在 throw)
 * 2. 同内容短路:与 currentVersionId 指向的 row 内容一致 → no-op
 * 3. 同 turn 合并:current version 的 turnId === ALS turnId,且 currentVersionId 是 max(id)
 *    → 直接 UPDATE 该 row 的 content / message / templateId,currentVersionId 不变
 * 4. 跨 turn:先 DELETE 所有 id > currentVersionId 的 future 行(redo 栈截断),
 *    再 INSERT 新行 + 推进 currentVersionId
 * 5. 环形裁剪:INSERT 完成后,若该 deck 的总 version 数 > MAX,按 id ASC 删最早的若干行
 *    (但绝不删 currentVersionId 指向的 row,避免悬空)
 */
export async function appendHistoryDb(content: string, op: string): Promise<void> {
  const deck = await loadDeckGuard()
  const rc = getRequestContext()
  const db = getDb()

  // 取 current version 的 turnId / content,用于"同内容短路"与"同 turn 合并"判断
  let curTurnId: string | null = null
  let curContent: string | null = null
  if (deck.currentVersionId) {
    const [cur] = await db
      .select({ turnId: deckVersions.turnId, content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, deck.currentVersionId))
      .limit(1)
    curTurnId = cur?.turnId ?? null
    curContent = cur?.content ?? null
  }

  // 同内容短路
  if (curContent === content) return

  // 同 turn 合并:current 必须是 max(id) 的"最新"版本(否则 undo 后位于中间,新写应起新行)
  if (
    rc.turnId &&
    curTurnId === rc.turnId &&
    deck.currentVersionId !== null
  ) {
    const [{ futureCount }] = (await db
      .select({ futureCount: count() })
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), gt(deckVersions.id, deck.currentVersionId)))) as [
      { futureCount: number },
    ]
    if (futureCount === 0) {
      await db
        .update(deckVersions)
        .set({ content, message: op, templateId: deck.templateId })
        .where(eq(deckVersions.id, deck.currentVersionId))
      return
    }
  }

  // 跨 turn:先截断 redo 栈
  if (deck.currentVersionId !== null) {
    await db
      .delete(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), gt(deckVersions.id, deck.currentVersionId)))
  }

  // append + 推进 currentVersionId
  await db.insert(deckVersions).values({
    deckId: deck.id,
    content,
    message: op,
    turnId: rc.turnId,
    templateId: deck.templateId,
    authorId: rc.userId,
  })
  const [newVersion] = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deck.id))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  if (!newVersion) return
  await db.update(decks).set({ currentVersionId: newVersion.id }).where(eq(decks.id, deck.id))

  // ring buffer 裁剪:保留最近 MAX 行,但绝不删 currentVersionId 指向的行
  const max = getMaxHistory()
  const [{ total }] = (await db
    .select({ total: count() })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deck.id))) as [{ total: number }]
  if (total > max) {
    // LIMIT 走字符串拼,因为 mysql2 prepared-statement LIMIT ? 在某些 RDS 上 ER_PARSE_ERROR
    // (CLAUDE.md 已记录过这个坑)。trimCount 是 server 内部算的数字,无 SQL injection 风险。
    const trimCount = Math.max(0, Math.floor(total - max))
    if (trimCount > 0) {
      const oldest = await db
        .select({ id: deckVersions.id })
        .from(deckVersions)
        .where(eq(deckVersions.deckId, deck.id))
        .orderBy(asc(deckVersions.id))
        .limit(trimCount)
      const ids = oldest.map((r) => r.id).filter((id) => id !== newVersion.id)
      if (ids.length > 0) {
        await db.delete(deckVersions).where(sql`id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
      }
    }
  }
}

export async function undoDb(): Promise<HistoryActionResult> {
  const deck = await loadDeckGuard()
  if (deck.currentVersionId === null) {
    return { success: false, error: '已到最早的历史，无法继续撤销' }
  }
  const db = getDb()
  const [prev] = await db
    .select({ id: deckVersions.id, templateId: deckVersions.templateId })
    .from(deckVersions)
    .where(and(eq(deckVersions.deckId, deck.id), lt(deckVersions.id, deck.currentVersionId)))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  if (!prev) {
    return { success: false, error: '已到最早的历史，无法继续撤销' }
  }
  // 把 currentVersionId 回退到 prev;templateId 同步以支持"切模板可回滚"语义(Phase 7D)
  await db
    .update(decks)
    .set({
      currentVersionId: prev.id,
      ...(prev.templateId ? { templateId: prev.templateId } : {}),
    })
    .where(eq(decks.id, deck.id))

  const pos = await getVersionPosition(deck.id, prev.id)
  return {
    success: true,
    message: pos ? `已撤销到第 ${pos.index} / ${pos.total} 版` : '已撤销到上一个版本',
    position: pos,
  }
}

export async function redoDb(): Promise<HistoryActionResult> {
  const deck = await loadDeckGuard()
  if (deck.currentVersionId === null) {
    return { success: false, error: '已到最新版本，无可重做' }
  }
  const db = getDb()
  const [next] = await db
    .select({ id: deckVersions.id, templateId: deckVersions.templateId })
    .from(deckVersions)
    .where(and(eq(deckVersions.deckId, deck.id), gt(deckVersions.id, deck.currentVersionId)))
    .orderBy(asc(deckVersions.id))
    .limit(1)
  if (!next) {
    return { success: false, error: '已到最新版本，无可重做' }
  }
  await db
    .update(decks)
    .set({
      currentVersionId: next.id,
      ...(next.templateId ? { templateId: next.templateId } : {}),
    })
    .where(eq(decks.id, deck.id))

  const pos = await getVersionPosition(deck.id, next.id)
  return {
    success: true,
    message: pos ? `已重做到第 ${pos.index} / ${pos.total} 版` : '已重做到下一个版本',
    position: pos,
  }
}

/**
 * 测试 / debug 用:返回当前 deck 的版本列表(by id asc)。
 * 注意:必须在已 runInRequest 的上下文里调,否则 throw NoActiveDeckError。
 */
export async function listHistoryDb(): Promise<{
  ids: number[]
  currentIndex: number
  currentVersionId: number | null
}> {
  const deck = await loadDeckGuard()
  const db = getDb()
  const rows = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deck.id))
    .orderBy(asc(deckVersions.id))
  const ids = rows.map((r) => r.id)
  const currentIndex = deck.currentVersionId === null ? -1 : ids.indexOf(deck.currentVersionId)
  return { ids, currentIndex, currentVersionId: deck.currentVersionId }
}
