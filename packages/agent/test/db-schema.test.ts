import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, users, sessions, decks, deckVersions, deckChats } from '../src/db/index.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

/**
 * 这些测试验证 schema.ts 里声明的 FK onDelete 语义真的落到了 DB 层：
 * - users → sessions / decks 是 CASCADE
 * - decks → deck_versions / deck_chats 是 CASCADE
 * - users → deck_versions.author_id 是 SET NULL
 */
describe('db/schema FK 级联行为', () => {
  it('删 user → 其 session 和 deck 被 CASCADE 删', async () => {
    const db = getDb()
    const { user, sid } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    await db.delete(users).where(eq(users.id, user.id))

    const sessionRows = await db.select().from(sessions).where(eq(sessions.id, sid))
    const deckRows = await db.select().from(decks).where(eq(decks.id, deck.id))
    expect(sessionRows.length).toBe(0)
    expect(deckRows.length).toBe(0)
  })

  it('删 deck → deck_versions 与 deck_chats 被 CASCADE 删', async () => {
    const db = getDb()
    const { user } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id)
    await db.insert(deckChats).values({ deckId: deck.id, role: 'user', content: 'hi' })
    await db.insert(deckChats).values({ deckId: deck.id, role: 'assistant', content: 'hello' })

    await db.delete(decks).where(eq(decks.id, deck.id))

    const versionRows = await db.select().from(deckVersions).where(eq(deckVersions.id, initialVersionId))
    const chatRows = await db.select().from(deckChats).where(eq(deckChats.deckId, deck.id))
    expect(versionRows.length).toBe(0)
    expect(chatRows.length).toBe(0)
  })

  it('删 user → 其写过的 deck_versions.author_id 被 SET NULL，版本记录本身保留', async () => {
    const db = getDb()
    // 两个用户：A 创建 deck；B 以合作者身份写了一个 version
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck, initialVersionId } = await createDeckDirect(a.user.id)
    await db.insert(deckVersions).values({
      deckId: deck.id,
      content: 'by B',
      message: 'edit by b',
      authorId: b.user.id,
    })

    // 删 B
    await db.delete(users).where(eq(users.id, b.user.id))

    // 原 deck 不受影响
    const deckRows = await db.select().from(decks).where(eq(decks.id, deck.id))
    expect(deckRows.length).toBe(1)

    // B 写过的 version 还在，但 author_id 置 NULL
    const bVersion = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.content, 'by B'))
    expect(bVersion.length).toBe(1)
    expect(bVersion[0]?.authorId).toBeNull()

    // A 的初始 version 也保留
    const aVersion = await db.select().from(deckVersions).where(eq(deckVersions.id, initialVersionId))
    expect(aVersion.length).toBe(1)
    expect(aVersion[0]?.authorId).toBe(a.user.id)
  })
})
