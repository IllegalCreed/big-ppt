/**
 * 在当前请求的 active deck 上追加一条 deck_version，并把 current_version_id 前移。
 *
 * - 没有 active deck（如未登录的 smoke / 单元测试）：静默跳过，slides-store 只做 fs mirror
 * - 新内容与当前 version.content 完全一致：跳过（no-op write）
 * - 有 turnId：写入 deck_versions.turn_id，供 UI 折叠同轮多次工具调用
 */
import { desc, eq } from 'drizzle-orm'
import { getDb, decks, deckVersions } from '../db/index.js'
import { getRequestContext } from '../context.js'

export async function persistVersionIfActive(content: string, op: string): Promise<void> {
  const rc = getRequestContext()
  if (!rc.activeDeckId) return

  const db = getDb()
  const [deck] = await db
    .select({
      id: decks.id,
      currentVersionId: decks.currentVersionId,
      templateId: decks.templateId,
    })
    .from(decks)
    .where(eq(decks.id, rc.activeDeckId))
    .limit(1)
  if (!deck) return // deck 已被删

  // 同内容短路：避免空写增量
  if (deck.currentVersionId) {
    const [cur] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, deck.currentVersionId))
      .limit(1)
    if (cur?.content === content) return
  }

  // Phase 7D fix（2026-04-25）：把 deck 当前模板写进 version，让 /restore 能正确同步
  // decks.template_id。漏了这一步会让 LLM 工具调用产出的 version templateId=NULL，
  // restore 时按"NULL 不动"分支回不到原模板，导致"内容回去了但 deck 还在新模板"。
  await db.insert(deckVersions).values({
    deckId: rc.activeDeckId,
    content,
    message: op,
    turnId: rc.turnId,
    templateId: deck.templateId,
    authorId: rc.userId,
  })

  // MySQL insert 不一定回传 id，统一回查最新一条
  const [newVersion] = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, rc.activeDeckId))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  if (!newVersion) return

  await db.update(decks).set({ currentVersionId: newVersion.id }).where(eq(decks.id, rc.activeDeckId))
}
