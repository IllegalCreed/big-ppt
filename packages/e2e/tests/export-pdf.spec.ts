/**
 * Phase 14 Task C:PDF 导出 happy-path E2E。
 *
 * 走 export-md.spec.ts 同套路:
 * - 注册 + 自动登录
 * - 创建 deck(beitou-standard,5 页 starter)
 * - 等编辑器加载完(标题可见)
 * - 点顶栏「导出」按钮(`aria-label="导出"`)
 * - modal 内默认 PDF radio 选中,点「开始导出」
 * - `page.waitForEvent('download')` 等浏览器下载事件
 * - 断 download 文件大小 > 10KB(jsPDF + 5 页 PNG ~ 数百 KB,10KB 极保守低门槛)
 * - 文件名 ext = .pdf
 *
 * 不做像素级 diff(plan 30 minor:本 phase 不做)
 *
 * 真打 html2canvas 截图 + 真打 jsPDF 拼装,不烧 LLM token(E2E webServer 已设
 * BIG_PPT_TEST_REWRITE_MODE=skeleton,starter 直接读 fixture)
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

test('导出 PDF → 顶栏按钮 → modal → confirm → 浏览器下载 + size > 10KB', async ({ page }) => {
  const email = `export-pdf-${Date.now()}@test.com`

  // 1. 注册 + 自动登录
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 2. 创建 deck(走 picker 选第一张模板)
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill('export-pdf-test')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // 3. 等编辑器初始化完成
  // SlidePreview onMounted 调 initDeck 把 initialContent 写进 slideStore;
  // DeckRenderer 至少要渲染一次让 ExportRenderer 可用同一份 markdown 截图
  await expect(page.locator('.deck-title').first()).toBeVisible({ timeout: 10_000 })
  // 顶栏「导出」按钮可见(aria-label = "导出")
  const exportBtn = page.getByRole('button', { name: '导出', exact: true })
  await expect(exportBtn).toBeVisible({ timeout: 10_000 })

  // 4. 点导出按钮 → modal 打开
  await exportBtn.click()
  await expect(page.locator('.modal-overlay').last()).toBeVisible({ timeout: 5_000 })

  // 默认 PDF radio 选中
  const pdfRadio = page.locator('[data-test="format-pdf"]')
  await expect(pdfRadio).toBeChecked()

  // 5. 点确认 → 触发同步导出 + 浏览器 download 事件
  // 导出涉及 5 页截图,实测在 headless chromium 跑 10-15s,给 60s 上限留余量
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.locator('[data-test="confirm-button"]').click()
  const download = await downloadPromise

  // 6. 断文件名 ext = .pdf
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  expect(download.suggestedFilename()).toMatch(/^export-pdf-test-\d+\.pdf$/)

  // 7. 断文件大小 > 10KB(plan 30 写的低门槛,防 PDF 完全空)
  const path = await download.path()
  expect(path).toBeTruthy()
  const { statSync } = await import('node:fs')
  const stat = statSync(path!)
  expect(stat.size).toBeGreaterThan(10_000)
})
