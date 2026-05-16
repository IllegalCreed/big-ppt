/** 自定义 MCP server 添加 / 删除 E2E:UI 表单 → POST → DB 落明文密文 → 删除 → DB 行消失。 */
import { test, expect } from '@playwright/test'
import mysql from 'mysql2/promise'
import { AGENT_BASE, truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

/**
 * 直读 lumideck_test 验证 user_mcp_servers 行;此 helper 只在本 spec 用。
 * 复用 helpers/db 的 DATABASE_URL 设置(顶层 dotenv 已 load)。
 */
async function getCustomServerRow(
  serverId: string,
): Promise<{ url: string; headers: string; enabled: boolean; preset: boolean } | null> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!)
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT url, headers, enabled, preset FROM user_mcp_servers WHERE server_id = ? LIMIT 1',
      [serverId],
    )
    if (rows.length === 0) return null
    const r = rows[0]!
    return {
      url: r.url as string,
      headers: r.headers as string,
      enabled: !!r.enabled,
      preset: !!r.preset,
    }
  } finally {
    await conn.end()
  }
}

async function countServerRows(serverId: string): Promise<number> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!)
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM user_mcp_servers WHERE server_id = ?',
      [serverId],
    )
    return Number((rows[0] as { n: number }).n)
  } finally {
    await conn.end()
  }
}

async function registerAndLogin(page: import('@playwright/test').Page): Promise<void> {
  const email = `mcp-cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
}

async function createDeck(page: import('@playwright/test').Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('标题').fill(title)
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
}

test('UI 表单新增 custom MCP → 列表出现卡 + DB 行 + headers 密文落库', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page, '自定义 MCP 新增测试')

  // Settings → MCP tab
  await page.getByRole('button', { name: /^设置$/ }).click()
  await page.getByRole('tab', { name: /MCP Servers/ }).click()

  // 自定义 MCP section 顶部「添加自定义 MCP」按钮
  const addToggle = page.locator('.mcp-custom__toggle')
  await expect(addToggle).toBeVisible({ timeout: 5_000 })
  await addToggle.click()

  // 表单展开后填入字段。MCPCustomServer.vue 的 input 没 data-test,
  // 但每个 input 同一个 mcp-custom__input class + 在固定顺序: id / 显示名 / URL / 说明
  const formInputs = page.locator('.mcp-custom__form .mcp-custom__field .mcp-custom__input')
  await formInputs.nth(0).fill('test-mcp')
  await formInputs.nth(1).fill('test-mcp 显示名')
  await formInputs.nth(2).fill('https://example.com/mcp')
  await formInputs.nth(3).fill('单测用占位 server')

  // header 行(grid 3 列):name + value + add 按钮
  const headerAddRow = page.locator('.mcp-custom__header-add')
  await headerAddRow.locator('input.mcp-custom__input').nth(0).fill('Authorization')
  await headerAddRow.locator('input.mcp-custom__input').nth(1).fill('Bearer secret-token-xyz')
  await headerAddRow.locator('.mcp-custom__header-add-btn').click()

  // 验:头部 list 出现一行(key: value)
  await expect(page.locator('.mcp-custom__header-item code')).toHaveText(/Authorization.*Bearer/)

  // 提交「创建」
  const postPromise = page.waitForResponse(
    (resp) =>
      resp.url().endsWith('/api/mcp/servers') && resp.request().method() === 'POST',
    { timeout: 10_000 },
  )
  await page.locator('.mcp-custom__submit').click()
  const postResp = await postPromise
  expect(postResp.status()).toBe(200)
  const postJson = await postResp.json()
  expect(postJson.success).toBe(true)

  // UI:custom row 出现在列表里(自动 refresh 拿到)
  const customRow = page.locator('.mcp-custom__row').filter({ hasText: 'test-mcp 显示名' })
  await expect(customRow).toBeVisible({ timeout: 5_000 })
  await expect(customRow).toContainText('https://example.com/mcp')

  // DB:user_mcp_servers 有 test-mcp 行 + preset=false + headers AES 密文(v1: prefix)
  await expect.poll(async () => await countServerRows('test-mcp'), { timeout: 5_000 }).toBe(1)
  const row = await getCustomServerRow('test-mcp')
  expect(row).not.toBeNull()
  expect(row!.url).toBe('https://example.com/mcp')
  expect(row!.preset).toBe(false)
  expect(row!.enabled).toBe(false)
  // headers 是 JSON 串,key 明文,value 是 'v1:...' 密文(AES-256-GCM)
  const headers = JSON.parse(row!.headers) as Record<string, string>
  expect(Object.keys(headers)).toEqual(['Authorization'])
  expect(headers.Authorization).toMatch(/^v1:/)
  // 明文 token 绝不应在 DB 里出现
  expect(row!.headers).not.toContain('Bearer secret-token-xyz')
  expect(row!.headers).not.toContain('secret-token-xyz')
})

test('UI 删除 custom MCP → 卡片消失 + DB 行删除 + preset 不受影响', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page, '自定义 MCP 删除测试')

  // 直接通过 API 创建一个待删 server,省 UI 重复填表步骤
  const createRes = await page.request.post(`${AGENT_BASE}/api/mcp/servers`, {
    headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
    data: {
      id: 'to-be-deleted',
      displayName: '待删除',
      url: 'https://kill-me.example/mcp',
      headers: { 'X-Api-Key': 'will-be-encrypted' },
    },
  })
  expect(createRes.ok()).toBe(true)
  expect(await countServerRows('to-be-deleted')).toBe(1)

  // 数 preset(seed 走 first GET)的初始行数:确认删除不会顺便擦掉预置
  await page.request.get(`${AGENT_BASE}/api/mcp/servers`, { headers: { Origin: AGENT_BASE } })

  // 进 UI Settings → MCP tab
  await page.getByRole('button', { name: /^设置$/ }).click()
  await page.getByRole('tab', { name: /MCP Servers/ }).click()

  const targetRow = page.locator('.mcp-custom__row').filter({ hasText: '待删除' })
  await expect(targetRow).toBeVisible({ timeout: 5_000 })

  // 点垃圾桶,但 SettingsModal.handleRemove 走 confirm()。Playwright 需 dialog handler 兜底
  page.once('dialog', (dlg) => dlg.accept())
  const deletePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/mcp/servers/to-be-deleted') &&
      resp.request().method() === 'DELETE',
    { timeout: 10_000 },
  )
  await targetRow.locator('.mcp-custom__row-remove').click()
  const deleteResp = await deletePromise
  expect(deleteResp.status()).toBe(200)

  // UI 卡消失
  await expect(targetRow).toHaveCount(0, { timeout: 5_000 })

  // DB:to-be-deleted 行没了
  await expect.poll(async () => await countServerRows('to-be-deleted'), { timeout: 5_000 }).toBe(0)

  // 预置仍在(zhipu-web-search 等不应被波及)
  expect(await countServerRows('zhipu-web-search')).toBeGreaterThanOrEqual(1)
})
