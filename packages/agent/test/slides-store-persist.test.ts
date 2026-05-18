/**
 * Phase 15.x P0 security hotfix(2026-05-18):persist.ts 已删,功能合并到
 * slides-store/history.ts 的 `appendHistoryDb`(包含同 turn 合并 / redo 截断 / ring buffer 裁剪)。
 *
 * 本测试覆盖原 persistVersionIfActive 行为,改用 appendHistoryDb 走 DB-based 路径,
 * 并新增 IDOR guard 断言(跨用户调 → throw NoActiveDeckError)。
 */
import { describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { appendHistoryDb } from '../src/slides-store/history.js'
import { NoActiveDeckError } from '../src/slides-store/errors.js'
import { runInRequest, type RequestContext } from '../src/context.js'
import { getDb, decks, deckVersions } from '../src/db/index.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

function ctxOf(overrides: Partial<RequestContext>): RequestContext {
  return { userId: null, sessionId: null, activeDeckId: null, turnId: null, ...overrides }
}

async function countVersions(deckId: number): Promise<number> {
  const db = getDb()
  const rows = await db.select({ id: deckVersions.id }).from(deckVersions).where(eq(deckVersions.deckId, deckId))
  return rows.length
}

describe('slides-store/history.appendHistoryDb', () => {
  it('无 activeDeckId / userId → throw NoActiveDeckError', async () => {
    const { user } = await createLoggedInUser()
    await createDeckDirect(user.id)
    await expect(
      runInRequest(ctxOf({ userId: user.id }), () => appendHistoryDb('whatever', 'write')),
    ).rejects.toThrow(NoActiveDeckError)
    await expect(
      runInRequest(ctxOf({ activeDeckId: 1 }), () => appendHistoryDb('whatever', 'write')),
    ).rejects.toThrow(NoActiveDeckError)
  })

  it('IDOR guard:跨用户调用同 deckId → throw NoActiveDeckError', async () => {
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(a.user.id)
    // user B 试图用 A 的 deckId 写入 → 拒
    await expect(
      runInRequest(ctxOf({ userId: b.user.id, activeDeckId: deck.id }), () =>
        appendHistoryDb('cross-user-attack', 'write'),
      ),
    ).rejects.toThrow(NoActiveDeckError)
    // 验证 deck 内容未被污染
    const db = getDb()
    const rows = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deck.id))
    expect(rows.every((r) => !r.content.includes('cross-user-attack'))).toBe(true)
  })

  it('同 content → 跳过不插', async () => {
    const { user } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id)
    const db = getDb()
    const [cur] = await db.select().from(deckVersions).where(eq(deckVersions.id, initialVersionId)).limit(1)
    const sameContent = cur!.content

    const before = await countVersions(deck.id)
    await runInRequest(ctxOf({ userId: user.id, activeDeckId: deck.id }), () =>
      appendHistoryDb(sameContent, 'write'),
    )
    expect(await countVersions(deck.id)).toBe(before)
  })

  it('新 content → 插入新 version，deck.currentVersionId 前移', async () => {
    const { user } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id)

    await runInRequest(ctxOf({ userId: user.id, activeDeckId: deck.id }), () =>
      appendHistoryDb('---\nfoo: bar\n---\n\n# new content', 'edit'),
    )

    const db = getDb()
    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated!.currentVersionId).not.toBe(initialVersionId)
    const [latest] = await db
      .select()
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), eq(deckVersions.message, 'edit')))
      .orderBy(asc(deckVersions.id))
      .limit(1)
    expect(latest?.content).toBe('---\nfoo: bar\n---\n\n# new content')
    expect(updated!.currentVersionId).toBe(latest!.id)
  })

  it('有 turnId → 写入 deck_versions.turn_id', async () => {
    const { user } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    await runInRequest(
      ctxOf({ userId: user.id, activeDeckId: deck.id, turnId: 'turn-abc' }),
      () => appendHistoryDb('turn-tagged content', 'write'),
    )

    const db = getDb()
    const [v] = await db
      .select({ turnId: deckVersions.turnId })
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), eq(deckVersions.content, 'turn-tagged content')))
      .limit(1)
    expect(v?.turnId).toBe('turn-abc')
  })

  it('Phase 7D fix：写入新 version 时 templateId 同步当前 deck.template_id', async () => {
    const { user } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    const db = getDb()
    await db.update(decks).set({ templateId: 'jingyeda-standard' }).where(eq(decks.id, deck.id))

    await runInRequest(ctxOf({ userId: user.id, activeDeckId: deck.id }), () =>
      appendHistoryDb('after-llm-edit', 'update_slide'),
    )

    const [v] = await db
      .select({ templateId: deckVersions.templateId })
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), eq(deckVersions.content, 'after-llm-edit')))
      .limit(1)
    expect(v?.templateId).toBe('jingyeda-standard')
  })

  it('同 turn 第二次写 → UPDATE 当前 row(不新增)', async () => {
    const { user } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    await runInRequest(ctxOf({ userId: user.id, activeDeckId: deck.id, turnId: 'turn-merge' }), async () => {
      await appendHistoryDb('first write turn-merge', 'create')
    })
    const afterFirst = await countVersions(deck.id)

    await runInRequest(ctxOf({ userId: user.id, activeDeckId: deck.id, turnId: 'turn-merge' }), async () => {
      await appendHistoryDb('second write turn-merge', 'update')
    })
    // 第二次同 turn 不新增行,直接覆盖
    expect(await countVersions(deck.id)).toBe(afterFirst)
    const db = getDb()
    const [latest] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deck.id))
      .orderBy(asc(deckVersions.id))
    // 注:initial + 第一次 = 2 行,第二次 update 覆盖最后那行
    const all = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deck.id))
      .orderBy(asc(deckVersions.id))
    expect(all[all.length - 1]!.content).toBe('second write turn-merge')
    void latest
  })

  it('userId=null → 走 IDOR guard 拒掉(不再允许"匿名" anyway)', async () => {
    const { user } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    await expect(
      runInRequest(ctxOf({ userId: null, activeDeckId: deck.id }), () =>
        appendHistoryDb('anon-content', 'write'),
      ),
    ).rejects.toThrow(NoActiveDeckError)
  })
})
