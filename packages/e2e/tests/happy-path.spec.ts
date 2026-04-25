import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.beforeEach(async () => {
  await truncateAllTables()
})
test.afterAll(async () => {
  await disposeDb()
})

test.describe('Happy path: 注册 → 登录 → 新建 deck → 编辑器渲染', () => {
  test('完整流程跑通', async ({ page }) => {
    const email = `e2e-${Date.now()}@a.com`
    const password = 'pw123456'

    // 1. /register（两个密码输入框：密码 + 确认密码）
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill(password)
    await pwInputs.nth(1).fill(password)
    await page.getByRole('button', { name: /^注册/ }).click()

    // 2. 注册成功 → 跳到 /decks
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 3. 新建 deck（v7C: 点"新建 Deck"打开 picker modal，默认标题 + 任选模板 + 点"创建"）
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    // 等 picker 里模板卡片加载出来
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    // 直接点"创建"（默认标题"未命名幻灯片"，默认选中第一套模板）
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 10_000 })

    // 4. 编辑器加载（标题在顶栏可见）
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({ timeout: 15_000 })

    // 5. 返回列表（顶栏 ArrowLeft 按钮），刚建的 deck 还在
    await page.getByRole('button', { name: /返回列表/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
    await expect(page.getByText(/未命名幻灯片/)).toBeVisible()
  })
})
