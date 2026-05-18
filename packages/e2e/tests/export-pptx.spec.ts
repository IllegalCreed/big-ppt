/**
 * Phase 14 Task C:PPTX 导出 happy-path E2E。
 *
 * 同 export-pdf.spec.ts 套路,只切到 PPTX radio。
 * 阈值 size > 100_000:PPTX 是 zip 含 5 张全幅 PNG,实测产物数百 KB ~ MB 级,
 * 100KB 极保守。
 */
import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('导出 PPTX → 切 radio → confirm → 浏览器下载 + size > 100KB', async ({ page }) => {
  const email = `export-pptx-${Date.now()}@test.com`

  // 注册 + 自动登录
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 创建 deck
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill('export-pptx-test')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title').first()).toBeVisible({ timeout: 15_000 })

  // 点导出
  const exportBtn = page.getByRole('button', { name: '导出', exact: true })
  await expect(exportBtn).toBeVisible({ timeout: 10_000 })
  await exportBtn.click()
  await expect(page.locator('.modal-overlay').last()).toBeVisible({ timeout: 5_000 })

  // 切到 PPTX radio(antdv-native radio:点 label 即触发)
  await page.locator('[data-test="format-pptx"]').check()
  await expect(page.locator('[data-test="format-pptx"]')).toBeChecked()

  // 确认下载
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.locator('[data-test="confirm-button"]').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.pptx$/)
  expect(download.suggestedFilename()).toMatch(/^export-pptx-test-\d+\.pptx$/)

  const path = await download.path()
  expect(path).toBeTruthy()
  const { statSync } = await import('node:fs')
  const stat = statSync(path!)
  // PPTX 含 5 张全幅 PNG(每张 ~ 数十 KB),100KB 极保守下限
  expect(stat.size).toBeGreaterThan(100_000)
})
