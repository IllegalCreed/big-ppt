/** MCP 预置(智谱)服务 toggle E2E:注册 → 进 Settings → 启用 zhipu-web-search → 验 DB + UI。 */
import { test, expect } from '@playwright/test'
import { AGENT_BASE, truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

/**
 * 注册并登录新用户,返回邮箱(可用于后续接口的 audit / 调试)。
 * 注册成功后会自动跳转到 /decks,登录态由 HttpOnly session cookie 携带。
 */
async function registerAndLogin(page: import('@playwright/test').Page): Promise<string> {
  const email = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
  return email
}

async function createDeck(page: import('@playwright/test').Page, title: string): Promise<number> {
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('标题').fill(title)
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
  return Number(page.url().match(/\/decks\/(\d+)/)![1])
}

test('打开 Settings → MCP tab → 列出 3 个智谱预置卡 + reuseLlmKey 默认勾选', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page, '预置 MCP 列表测试')

  // 进入设置弹窗
  await page.getByRole('button', { name: /^设置$/ }).click()
  await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })

  // 切到 MCP Servers tab
  await page.getByRole('tab', { name: /MCP Servers/ }).click()

  // 三张预置卡可见(seedPresets 首次 list 触发,内含 zhipu-web-search / web-reader / zread)
  const presetCards = page.locator('.mcp-list .mcp-card')
  await expect(presetCards).toHaveCount(3, { timeout: 5_000 })
  await expect(presetCards.filter({ hasText: '联网搜索(智谱)' })).toBeVisible()
  await expect(presetCards.filter({ hasText: '网页读取(智谱)' })).toBeVisible()
  await expect(presetCards.filter({ hasText: 'GitHub 仓库读取(智谱 Zread)' })).toBeVisible()

  // 全部初始未启用,toggle 关闭态(.mcp-toggle input not checked)
  for (let i = 0; i < 3; i++) {
    const toggleInput = presetCards.nth(i).locator('.mcp-toggle input')
    expect(await toggleInput.evaluate((el) => (el as HTMLInputElement).checked)).toBe(false)
  }
})

test('toggle 预置卡 enable + 填入 LLM Key → PATCH 返 200 → UI 显示启用 + DB 记录 enabled=true', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page, '预置 MCP 启用测试')

  // 先通过 API 配置一个有效 LLM key,让 sentinel 替换路径可工作
  const llmRes = await page.request.put(`${AGENT_BASE}/api/auth/llm-settings`, {
    headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
    data: {
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'sk-test-zhipu-fake-for-mcp-toggle' } },
    },
  })
  expect(llmRes.ok()).toBe(true)

  // 进 Settings → MCP tab
  await page.getByRole('button', { name: /^设置$/ }).click()
  await page.getByRole('tab', { name: /MCP Servers/ }).click()

  // 选 zhipu-web-search 卡
  const webSearchCard = page.locator('.mcp-list .mcp-card').filter({ hasText: '联网搜索(智谱)' })
  await expect(webSearchCard).toBeVisible({ timeout: 5_000 })

  // 等待 PATCH /api/mcp/servers/zhipu-web-search 完成
  // headers 默认含 sentinel(presets.ts 默认带 'Bearer $LLM_KEY'),
  // hasUsableKey 直接 true,点 toggle 不弹 alert,直接 emit update.enabled=true
  // 注意:input[type=checkbox] 在 .mcp-toggle 内被 clip 隐藏(只是无障碍语义入口),
  // 用户实际点击的是 .mcp-toggle__track。Playwright 走相同路径才避免 pointer-events
  // 被父 span 拦截。
  const patchPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/mcp/servers/zhipu-web-search') &&
      resp.request().method() === 'PATCH',
    { timeout: 10_000 },
  )
  await webSearchCard.locator('.mcp-toggle').click()
  const patchResp = await patchPromise
  expect(patchResp.status()).toBe(200)
  const patchJson = await patchResp.json()
  expect(patchJson.success).toBe(true)

  // useMCP.refresh() 在 PATCH 成功后会重 GET,等 toggle 反映 enabled 态
  await expect
    .poll(
      async () =>
        await webSearchCard
          .locator('.mcp-toggle input')
          .evaluate((el) => (el as HTMLInputElement).checked),
      { timeout: 5_000 },
    )
    .toBe(true)

  // 用 API 二次断言(代替直接读 DB,避免在 e2e helper 加 MCP 专用 query)
  const verify = await page.request.get(`${AGENT_BASE}/api/mcp/servers`, {
    headers: { Origin: AGENT_BASE },
  })
  expect(verify.ok()).toBe(true)
  const verifyJson = (await verify.json()) as {
    servers: Array<{ id: string; enabled: boolean; reuseLlmKey: boolean }>
  }
  const found = verifyJson.servers.find((s) => s.id === 'zhipu-web-search')!
  expect(found.enabled).toBe(true)
  // headers 默认带 sentinel,enable 后 reuseLlmKey=true(后端计算)
  expect(found.reuseLlmKey).toBe(true)
})

test('toggle 已启用预置卡 → off 路径不需 key,直接 PATCH enabled=false', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page, '预置 MCP 关闭测试')

  // 先配 LLM key 让 enable 路径合法
  await page.request.put(`${AGENT_BASE}/api/auth/llm-settings`, {
    headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
    data: {
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'sk-test-zhipu-disable-path' } },
    },
  })

  // 通过 API 把 zhipu-web-reader 启用(模拟用户已经开过)
  // 注意:GET 是必须的,因为 routes/mcp.ts 不会在写入时自动 seed preset
  await page.request.get(`${AGENT_BASE}/api/mcp/servers`, { headers: { Origin: AGENT_BASE } })
  const enableRes = await page.request.patch(
    `${AGENT_BASE}/api/mcp/servers/zhipu-web-reader`,
    {
      headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
      data: { enabled: true, headers: { Authorization: 'Bearer $LLM_KEY' } },
    },
  )
  expect(enableRes.ok()).toBe(true)

  // 进 UI 关闭 toggle
  await page.getByRole('button', { name: /^设置$/ }).click()
  await page.getByRole('tab', { name: /MCP Servers/ }).click()
  const webReaderCard = page.locator('.mcp-list .mcp-card').filter({ hasText: '网页读取(智谱)' })
  await expect(webReaderCard).toBeVisible({ timeout: 5_000 })

  // 等 toggle 初始反映 enabled 态(GET 拉到的)
  await expect
    .poll(
      async () =>
        await webReaderCard
          .locator('.mcp-toggle input')
          .evaluate((el) => (el as HTMLInputElement).checked),
      { timeout: 5_000 },
    )
    .toBe(true)

  // 点击关闭(input 被 clip,用户实际点 .mcp-toggle 容器)
  const patchPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/mcp/servers/zhipu-web-reader') &&
      resp.request().method() === 'PATCH',
    { timeout: 10_000 },
  )
  await webReaderCard.locator('.mcp-toggle').click()
  const patchResp = await patchPromise
  expect(patchResp.status()).toBe(200)

  // toggle 回到关闭态
  await expect
    .poll(
      async () =>
        await webReaderCard
          .locator('.mcp-toggle input')
          .evaluate((el) => (el as HTMLInputElement).checked),
      { timeout: 5_000 },
    )
    .toBe(false)

  // API 二次确认
  const verify = await page.request.get(`${AGENT_BASE}/api/mcp/servers`, {
    headers: { Origin: AGENT_BASE },
  })
  const verifyJson = (await verify.json()) as { servers: Array<{ id: string; enabled: boolean }> }
  const found = verifyJson.servers.find((s) => s.id === 'zhipu-web-reader')!
  expect(found.enabled).toBe(false)
})
