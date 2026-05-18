/**
 * Phase 15 Task 31-E:`.lumideck` 归档包导出 E2E。
 *
 * 走 export-pdf.spec.ts 同套路:
 * - 注册 + 自动登录
 * - 创建 deck(beitou-standard 5 页 starter)
 * - 等编辑器加载
 * - 点顶栏「导出」按钮(aria-label="导出")
 * - modal 内点 [data-test="format-lumideck"] radio
 * - 点 [data-test="confirm-button"] 触发同步导出
 * - page.waitForEvent('download') 拿 .lumideck 文件
 * - 断 filename ext = .lumideck + 文件大小 > 100B(manifest + content.md 至少这么大)
 * - 验文件前 4 字节 = `PK\x03\x04`(zip 头 magic bytes,plan 31 Task A 输出
 *   的 .lumideck 本质是 zip,但扩展名换成 .lumideck 让用户视觉区分)
 *
 * 不走 capture-pages 截图链路(那是 PDF/PPTX/PNG-zip 的事);useExport.ts
 * lumideck 分支直接 fetch /api/decks/:id/export-archive 拿 backend 打包的 zip。
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

test('导出 .lumideck → 顶栏按钮 → modal radio → confirm → 下载 + zip 头校验', async ({ page }) => {
  const email = `export-archive-${Date.now()}@test.com`

  // 1. 注册 + 自动登录
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 2. 创建 deck
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill('archive-export-test')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // 3. 等编辑器顶栏导出按钮可见
  const exportBtn = page.getByRole('button', { name: '导出', exact: true })
  await expect(exportBtn).toBeVisible({ timeout: 10_000 })

  // 4. 点导出按钮 → modal 打开
  await exportBtn.click()
  await expect(page.locator('.modal-overlay').last()).toBeVisible({ timeout: 5_000 })

  // 5. 点 lumideck radio
  const lumideckRadio = page.locator('[data-test="format-lumideck"]')
  await expect(lumideckRadio).toBeVisible()
  await lumideckRadio.check()
  await expect(lumideckRadio).toBeChecked()

  // 6. 点确认 → 触发后端 export-archive + 浏览器 download 事件
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await page.locator('[data-test="confirm-button"]').click()
  const download = await downloadPromise

  // 7. 断文件名 ext = .lumideck
  expect(download.suggestedFilename()).toMatch(/\.lumideck$/)
  expect(download.suggestedFilename()).toMatch(/^archive-export-test-\d+\.lumideck$/)

  // 8. 断文件大小 > 100B(manifest.json + content.md 最少这么多;空 deck 也满足)
  const path = await download.path()
  expect(path).toBeTruthy()
  const { statSync, readFileSync } = await import('node:fs')
  const stat = statSync(path!)
  expect(stat.size).toBeGreaterThan(100)

  // 9. 断 zip magic bytes 前 4 字节 = `PK\x03\x04`(本质是 zip,扩展名换成 .lumideck)
  const buf = readFileSync(path!)
  expect(buf[0]).toBe(0x50) // 'P'
  expect(buf[1]).toBe(0x4b) // 'K'
  expect(buf[2]).toBe(0x03)
  expect(buf[3]).toBe(0x04)
})
