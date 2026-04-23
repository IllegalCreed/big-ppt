/**
 * Integration test 共享 factory。
 *
 * 所有函数假设 test DB 已 reset（`resetDb()` 被 beforeEach 调用过）。
 */
import bcrypt from 'bcrypt'
import { desc, eq } from 'drizzle-orm'
import { getDb, users, sessions, decks, deckVersions } from '../../src/db/index.js'
import { SESSION_COOKIE, SESSION_TTL_MS } from '../../src/middleware/auth.js'
import { randomBytes } from 'node:crypto'

export async function createTestUser(
  email = 'test@a.com',
  password = 'pw123456',
): Promise<{ user: { id: number; email: string }; password: string }> {
  const db = getDb()
  const passwordHash = await bcrypt.hash(password, 4) // rounds=4 够测试用且比默认 10 快 ~60x
  await db.insert(users).values({ email, passwordHash })
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1)
  if (!u) throw new Error('createTestUser: insert 后回查失败')
  return { user: u, password }
}

/** 直接在 DB 里插一条合法 session，返回 cookie 头字符串 */
export async function createSessionFor(userId: number): Promise<{ sid: string; cookie: string }> {
  const db = getDb()
  const sid = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ id: sid, userId, expiresAt })
  return { sid, cookie: `${SESSION_COOKIE}=${sid}` }
}

/** 构造一个"已登录"的 session：createTestUser + createSessionFor */
export async function createLoggedInUser(
  email = 'test@a.com',
  password = 'pw123456',
): Promise<{ user: { id: number; email: string }; sid: string; cookie: string }> {
  const { user } = await createTestUser(email, password)
  const { sid, cookie } = await createSessionFor(user.id)
  return { user, sid, cookie }
}

/** 直接在 DB 里建 deck + 初始 version，返回 { deck, initialVersionId } */
export async function createDeckDirect(
  userId: number,
  title = 'Test Deck',
  initialContent = '---\ntheme: seriph\n---\n\n# test',
): Promise<{ deck: typeof decks.$inferSelect; initialVersionId: number }> {
  const db = getDb()
  await db.insert(decks).values({ userId, title })
  const [created] = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, userId))
    .orderBy(desc(decks.id))
    .limit(1)
  if (!created) throw new Error('createDeckDirect: 回查 deck 失败')

  await db.insert(deckVersions).values({
    deckId: created.id,
    content: initialContent,
    message: 'initial',
    authorId: userId,
  })
  const [version] = await db
    .select({ id: deckVersions.id })
    .from(deckVersions)
    .where(eq(deckVersions.deckId, created.id))
    .orderBy(desc(deckVersions.id))
    .limit(1)
  if (!version) throw new Error('createDeckDirect: 回查 version 失败')

  await db.update(decks).set({ currentVersionId: version.id }).where(eq(decks.id, created.id))
  const [withVersion] = await db.select().from(decks).where(eq(decks.id, created.id)).limit(1)
  return { deck: withVersion!, initialVersionId: version.id }
}
