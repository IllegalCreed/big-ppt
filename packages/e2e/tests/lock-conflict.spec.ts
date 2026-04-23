import { test, expect, request as pwRequest } from '@playwright/test'
import { AGENT_BASE, truncateAllTables, disposeDb } from './helpers/db'

test.beforeEach(async () => {
  await truncateAllTables()
})
test.afterAll(async () => {
  await disposeDb()
})

/**
 * 锁冲突场景：
 * - User A：用 Playwright 的 APIRequestContext 注册 + 登录 + 创建 deck +
 *   activate-deck 抢锁
 * - User B：浏览器打开同一 deck 的编辑页 → 应看到等待页（"使用中"+holder.email）
 * - User A：调 release-deck
 * - User B：等待页轮询 5s 内自动跳转到编辑器
 */
test('A 占锁，B 看等待页；A 释放后 B 5s 内自动进入', async ({ page, baseURL }) => {
  const aReq = await pwRequest.newContext({ baseURL: AGENT_BASE })
  const bReq = await pwRequest.newContext({ baseURL: AGENT_BASE })

  // A 注册 + 登录 + 创建 deck
  const aEmail = `a-${Date.now()}@a.com`
  await aReq.post('/api/auth/register', {
    data: { email: aEmail, password: 'pw123456' },
  })
  const deckRes = await aReq.post('/api/decks', { data: { title: 'Shared Deck' } })
  expect(deckRes.status()).toBe(201)
  const { deck } = await deckRes.json()
  const deckId = deck.id

  // A 抢锁
  const lockRes = await aReq.post(`/api/activate-deck/${deckId}`)
  expect(lockRes.status()).toBe(200)

  // B 注册 + 登录（共享 cookie 通过 storageState 传到 page）
  const bEmail = `b-${Date.now()}@a.com`
  await bReq.post('/api/auth/register', {
    data: { email: bEmail, password: 'pw123456' },
  })
  // B 也建一个自己的 deck（用于测在自己 deck 上 activate 时看到 A 占着的等待页）
  const bDeckRes = await bReq.post('/api/decks', { data: { title: 'B Own Deck' } })
  const bDeckId = (await bDeckRes.json()).deck.id

  // 把 B 的 cookie 注入浏览器（必须指定 url 让 Playwright 推断 domain/path）
  const bState = await bReq.storageState()
  const bSessionCookie = bState.cookies.find((c) => c.name === 'lumideck_session')
  expect(bSessionCookie).toBeTruthy()
  await page.context().addCookies([
    {
      name: 'lumideck_session',
      value: bSessionCookie!.value,
      url: baseURL!,
    },
  ])

  // B 打开自己 deck 的编辑页 → 因为 A 占着锁，应进等待页
  await page.goto(`/decks/${bDeckId}`)
  // 等待页唯一的 h1 文案：「当前有人在编辑」
  await expect(page.getByRole('heading', { name: '当前有人在编辑' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(aEmail)).toBeVisible()

  // A 释放
  const releaseRes = await aReq.post('/api/release-deck')
  expect(releaseRes.status()).toBe(200)

  // B 等待页 5s 内轮询发现已释放 → 自动进入编辑器（标题或 iframe 出现）
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({ timeout: 15_000 })

  await aReq.dispose()
  await bReq.dispose()
})
