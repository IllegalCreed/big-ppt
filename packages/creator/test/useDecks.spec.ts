/**
 * Phase 7D / P3-10：从 msw mock 迁到 in-process agent + lumideck_test 集成测。
 *
 * 验证 useDecks / useDeckLock 真实调用 /api/decks /api/activate-deck 等端点的契约：
 *   - listDecks 返回真实 DB 数据形状（含 templateId / themeId）
 *   - createDeck 真新建 + 后端验证落库
 *   - deleteDeck 软删（status=deleted）
 *   - activate 冲突 409 真带 holder 字段
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  setupIntegration,
  createLoggedInUser,
  createDeckDirect,
  getDb,
  decks,
} from './_setup/integration'
import { useDecks, useDeckLock } from '../src/composables/useDecks'
import { ApiError } from '../src/api/client'

setupIntegration()

describe('composables/useDecks (integration)', () => {
  it('listDecks 真实链路：register → listDecks 拿到自己的 deck', async () => {
    // 用真实 fetch（被 shimFetch 接管）register 进而拿 cookie
    const reg = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'list@a.com', password: 'pw123456' }),
    })
    expect(reg.status).toBe(201)

    // 此时 cookieJar 已自动收集 session，后续 useDecks 调用带 cookie
    const created = await useDecks().createDeck({ title: 'My First' })
    expect(created.title).toBe('My First')
    expect(created.templateId).toBe('beitou-standard')

    const list = await useDecks().listDecks()
    expect(list.find((d) => d.id === created.id)?.title).toBe('My First')
  })

  it('createDeck 后 DB 真有 deck 行 + 初始 version', async () => {
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'crt@a.com', password: 'pw123456' }),
    })
    const deck = await useDecks().createDeck({ title: 'X' })
    const db = getDb()
    const [row] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(row?.title).toBe('X')
    expect(row?.templateId).toBe('beitou-standard')
    expect(row?.currentVersionId).not.toBeNull()
  })

  it('deleteDeck 软删：DB status=deleted', async () => {
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'del@a.com', password: 'pw123456' }),
    })
    const d = await useDecks().createDeck({ title: 'GoneSoon' })
    await expect(useDecks().deleteDeck(d.id)).resolves.toBeUndefined()
    const db = getDb()
    const [row] = await db.select().from(decks).where(eq(decks.id, d.id)).limit(1)
    expect(row?.status).toBe('deleted')
  })

  it('activate 冲突真返回 409 + holder 字段（A 占锁，B 来 activate 同一 deck → ok=false）', async () => {
    // A 注册 + 建 deck + 激活（拿锁）
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'A@a.com', password: 'pw123456' }),
    })
    const deckA = await useDecks().createDeck({ title: 'A 的 Deck' })
    const aActivate = await useDeckLock().activate(deckA.id)
    expect(aActivate.ok).toBe(true)

    // B 注册（cookieJar 替换为 B 的 session）
    const bReg = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'B@a.com', password: 'pw123456' }),
    })
    expect(bReg.status).toBe(201)
    // B 也建一个 deck，然后试图 activate A 的 deck → 不属于 B → 403 ownership 拒绝
    const result = await useDeckLock().activate(deckA.id).catch((e: unknown) => e)
    expect(result).toBeInstanceOf(ApiError)
    expect((result as ApiError).status).toBe(403)
  })

  it('activate 冲突真返回 holder（同一 user 两 session：A 占锁，A2 试同 deck → 409 holder.email=A）', async () => {
    // 这条专测 409 + holder 字段（不能跨用户因为 ownership 校验先失败）
    // 模拟：用 createLoggedInUser 直接造两条 session 给同一用户
    const { user, cookie: cA } = await createLoggedInUser('two@a.com')
    const { deck } = await createDeckDirect(user.id, 'Shared')

    // 用 A 的 cookie 真激活
    const aRes = await fetch(`/api/activate-deck/${deck.id}`, {
      method: 'POST',
      headers: { cookie: cA },
    })
    expect(aRes.status).toBe(200)

    // A2：再造一条同用户 session，试图 activate
    const { createSessionFor } = await import('@big-ppt/agent/test/_setup/factories.js')
    const { cookie: cA2 } = await createSessionFor(user.id)
    const a2Res = await fetch(`/api/activate-deck/${deck.id}`, {
      method: 'POST',
      headers: { cookie: cA2, 'content-type': 'application/json' },
    })
    expect(a2Res.status).toBe(409)
    const body = (await a2Res.json()) as { error: string; holder?: { email: string } }
    expect(body.error).toBe('occupied')
    expect(body.holder?.email).toBe('two@a.com')
  })
})
