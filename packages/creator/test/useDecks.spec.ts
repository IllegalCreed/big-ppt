/**
 * Phase 7D / P3-10：从 msw mock 迁到 in-process agent + lumideck_test 集成测。
 *
 * 验证 useDecks 真实调用 /api/decks 等端点的契约：
 *   - listDecks 返回真实 DB 数据形状（含 templateId / themeId）
 *   - createDeck 真新建 + 后端验证落库
 *   - deleteDeck 软删（status=deleted）
 *
 * Phase 10.5 Task 25-D-2：原 activate-deck 冲突 case 移除（接口已删，锁 acquire
 * 仅在 present 路径触发）；present 路径的 case 在 packages/agent/test/routes-lock.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupIntegration, getDb, decks } from './_setup/integration'
import { useDecks } from '../src/composables/useDecks'

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

  // Phase 10.5 Task 25-D-2：activate-deck 路由 + lockApi.activate 已删除；
  // 编辑器进入不再抢锁。锁的 acquire 现在只发生在「全屏放映」（POST /api/present/:id），
  // 那条路径的 4 个 case 在 packages/agent/test/routes-lock.test.ts 里覆盖。
})
