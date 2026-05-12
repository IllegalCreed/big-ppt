import { test, expect, request as pwRequest } from '@playwright/test'
import { AGENT_BASE, truncateAllTables, disposeDb } from './helpers/db'

test.beforeEach(async () => {
  await truncateAllTables()
})
test.afterAll(async () => {
  await disposeDb()
})

/**
 * Phase 10.5 lock-conflict 场景（rewrite from Task 25-D-2）：
 *
 * 编辑路径已不抢锁 → 用户 A、B 同时进同一 deck 都秒进。锁仅在「全屏放映」
 * （POST /api/present/:id）取，故冲突场景变成：
 *
 *   1. A 通过 API 直接 present 抢锁
 *   2. B 浏览器进自己的 deck 编辑页 → 直接进，**不** 看到 OccupiedWaitingPage
 *   3. B 点「放映」按钮 → SlidePreview 内 banner 显示「{A.email} 正在放映该 deck」
 *   4. A 调 release → B 再点放映成功
 */
test('A present 抢锁；B 编辑零等待但放映显示 banner', async ({ page, baseURL }) => {
  const aReq = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: { Origin: AGENT_BASE },
  })
  const bReq = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: { Origin: AGENT_BASE },
  })

  // A 注册 + 创建 deck + present 抢锁
  const aEmail = `a-${Date.now()}@a.com`
  await aReq.post('/api/auth/register', { data: { email: aEmail, password: 'pw123456' } })
  const aDeckRes = await aReq.post('/api/decks', { data: { title: 'A Deck' } })
  expect(aDeckRes.status()).toBe(201)
  const { deck: aDeck } = await aDeckRes.json()

  const presentRes = await aReq.post(`/api/present/${aDeck.id}`)
  expect(presentRes.status()).toBe(200)

  // B 注册 + 自己创建 deck
  const bEmail = `b-${Date.now()}@a.com`
  await bReq.post('/api/auth/register', { data: { email: bEmail, password: 'pw123456' } })
  const bDeckRes = await bReq.post('/api/decks', { data: { title: 'B Deck' } })
  const { deck: bDeck } = await bDeckRes.json()

  // 把 B 的 cookie 注入浏览器
  const bState = await bReq.storageState()
  const bSessionCookie = bState.cookies.find((c) => c.name === 'lumideck_session')
  expect(bSessionCookie).toBeTruthy()
  await page.context().addCookies([
    { name: 'lumideck_session', value: bSessionCookie!.value, url: baseURL! },
  ])

  // B 打开自己的 deck → **直接进编辑器**，编辑路径无锁
  await page.goto(`/decks/${bDeck.id}`)
  // 编辑器关键 UI：标题 + 放映按钮可见，且 **没有** OccupiedWaitingPage
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: /放映/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '当前有人在编辑' })).toHaveCount(0)

  // B 点放映按钮 → 后端返 409 → toolbar 下 banner 显示 A 的 email
  await page.getByRole('button', { name: /放映/ }).click()
  await expect(page.getByText(aEmail)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/正在放映|放映/)).toBeVisible()

  // A 释放
  const releaseRes = await aReq.post('/api/release-deck')
  expect(releaseRes.status()).toBe(200)

  // B 再点放映 → 应该 200；不实际验 window.open（Playwright 默认拦新 tab）
  // 关键断言：banner 消失（之前的 a@email 不再可见）
  // 重新点放映按钮触发新一轮 fetch
  await page.getByRole('button', { name: /放映/ }).click()
  // banner 不应再含 aEmail（present 这次成功了）
  // 注：Playwright 对 window.open 默认弹新 page，捕获不易；我们只断 banner 状态
  await expect(page.getByText(aEmail)).toHaveCount(0, { timeout: 5_000 })

  await aReq.dispose()
  await bReq.dispose()
})
