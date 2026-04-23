import { test, expect, request as pwRequest } from '@playwright/test'
import { AGENT_BASE, truncateAllTables, disposeDb } from './helpers/db'

test.beforeEach(async () => {
  await truncateAllTables()
})
test.afterAll(async () => {
  await disposeDb()
})

test.describe('Negative auth', () => {
  test('错密码登录 → 显示错误提示', async ({ page }) => {
    // 先用 API 注册一个真实用户
    const ctx = await pwRequest.newContext({ baseURL: AGENT_BASE })
    const email = `neg-${Date.now()}@a.com`
    await ctx.post('/api/auth/register', { data: { email, password: 'goodpw1' } })
    await ctx.dispose()

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill('wrongpw')
    await page.getByRole('button', { name: /登录/ }).click()

    // 错误文案展示（兼容多种渲染：toast / inline error / page text）
    await expect(page.getByText(/密码错误|邮箱或密码|失败/)).toBeVisible({ timeout: 10_000 })
    // 应停留在 /login
    await expect(page).toHaveURL(/\/login/)
  })

  test('重复邮箱注册 → 显示已注册提示', async ({ page }) => {
    const ctx = await pwRequest.newContext({ baseURL: AGENT_BASE })
    const email = `dup-${Date.now()}@a.com`
    await ctx.post('/api/auth/register', { data: { email, password: 'pw123456' } })
    await ctx.dispose()

    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('pw123456')
    await pwInputs.nth(1).fill('pw123456')
    await page.getByRole('button', { name: /^注册/ }).click()

    await expect(page.getByText(/已注册|已存在/)).toBeVisible({ timeout: 10_000 })
  })

  test('未登录访问 /decks → 跳到 /login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/decks')
    await expect(page).toHaveURL(/\/login(\?.*)?$/, { timeout: 10_000 })
  })
})
