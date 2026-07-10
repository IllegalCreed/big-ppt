/** Undo/redo routes: authentication, explicit deck scope and cross-user isolation. */
import { describe, expect, it } from 'vitest'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { slides } from '../src/routes/slides.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { getDb, decks, deckVersions } from '../src/db/index.js'
import { useTestDb } from './_setup/test-db.js'
import { createDeckDirect, createLoggedInUser } from './_setup/factories.js'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', slides)
  return app
}

function post(path: string, cookie?: string, deckId?: number | string) {
  return makeApp().request(path, {
    method: 'POST',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(deckId !== undefined ? { 'X-Deck-Id': String(deckId) } : {}),
    },
  })
}

async function appendVersion(deckId: number, userId: number, content: string): Promise<number> {
  const db = getDb()
  await db.insert(deckVersions).values({
    deckId,
    content,
    message: 'second',
    authorId: userId,
  })
  const [version] = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, deckId))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  await db.update(decks).set({ currentVersionId: version!.id }).where(eq(decks.id, deckId))
  return version!.id
}

describe('routes/slides deck-scoped history', () => {
  it('未登录时拒绝 undo/redo', async () => {
    expect((await post('/api/restore-slides', undefined, 1)).status).toBe(401)
    expect((await post('/api/redo-slides', undefined, 1)).status).toBe(401)
  })

  it('缺少或非法 X-Deck-Id 时返回 400', async () => {
    const { cookie } = await createLoggedInUser()
    expect((await post('/api/restore-slides', cookie)).status).toBe(400)
    expect((await post('/api/restore-slides', cookie, 'invalid')).status).toBe(400)
  })

  it('undo/redo 只移动指定 deck 的版本指针', async () => {
    const { user, cookie } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id, 'History', 'v1')
    const secondVersionId = await appendVersion(deck.id, user.id, 'v2')

    const undo = await post('/api/restore-slides', cookie, deck.id)
    expect(undo.status).toBe(200)
    expect(await undo.json()).toMatchObject({ success: true, position: { index: 1, total: 2 } })
    let [row] = await getDb().select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(row!.currentVersionId).toBe(initialVersionId)

    const redo = await post('/api/redo-slides', cookie, deck.id)
    expect(redo.status).toBe(200)
    expect(await redo.json()).toMatchObject({ success: true, position: { index: 2, total: 2 } })
    ;[row] = await getDb().select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(row!.currentVersionId).toBe(secondVersionId)
  })

  it('无可撤销/重做历史时返回 404', async () => {
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'Single')
    expect((await post('/api/restore-slides', cookie, deck.id)).status).toBe(404)
    expect((await post('/api/redo-slides', cookie, deck.id)).status).toBe(404)
  })

  it('跨用户 deck id 返回 404 且不移动版本指针', async () => {
    const owner = await createLoggedInUser('owner@a.com')
    const attacker = await createLoggedInUser('attacker@a.com')
    const { deck } = await createDeckDirect(owner.user.id, 'Private', 'v1')
    const secondVersionId = await appendVersion(deck.id, owner.user.id, 'v2')

    const res = await post('/api/restore-slides', attacker.cookie, deck.id)
    expect(res.status).toBe(404)
    const [row] = await getDb().select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(row!.currentVersionId).toBe(secondVersionId)
  })

  it('已删除 deck 返回 404', async () => {
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'Deleted')
    await getDb().update(decks).set({ status: 'deleted' }).where(eq(decks.id, deck.id))
    expect((await post('/api/restore-slides', cookie, deck.id)).status).toBe(404)
  })

  it('旧 /read-slides runtime endpoint 已删除', async () => {
    const { cookie } = await createLoggedInUser()
    expect(
      (await makeApp().request('/api/read-slides', { headers: { Cookie: cookie } })).status,
    ).toBe(404)
  })
})
