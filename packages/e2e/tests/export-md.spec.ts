/**
 * 导出 .md E2E。
 *
 * 验收:
 * - 编辑器顶部 SlidePreview toolbar 内「导出 .md」按钮可见
 * - 点按钮 → 浏览器触发下载(Blob URL → download event)
 * - 下载文件名 = "slides.md"(useSlideStore.exportMarkdown 写死)
 * - 文件内容 = 当前 slideStore.content(应等于 DB 当前版本 content)
 *
 * 实现细节:useSlideStore.exportMarkdown() 用 Blob + URL.createObjectURL +
 * a.click() 触发下载,不打 server 端点。Playwright `page.waitForEvent('download')`
 * 能捕获浏览器层 download 事件并读到 stream。
 */
import { expect, test } from '@playwright/test'
import { AGENT_BASE, truncateAllTables, disposeDb, getCurrentVersionContent } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('导出 .md 按钮 → 触发下载 + 文件名 slides.md + 内容等同 DB current version', async ({
  page,
}) => {
  const email = `exp-${Date.now()}@test.com`

  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 创建 deck(beitou-standard 走 picker)
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill('export-test')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // 等编辑器初始化完(SlidePreview onMounted 写入 initialContent)
  // toolbar 内导出按钮 aria-label="导出 .md"
  const exportBtn = page.getByRole('button', { name: '导出 .md' })
  await expect(exportBtn).toBeVisible({ timeout: 10_000 })

  // 拿 DB 当前 version content 做对照基准
  const dbContent = await getCurrentVersionContent(deckId)
  expect(dbContent).toBeTruthy()
  expect(dbContent).toContain('layout: beitou-cover')

  // 监听 download 事件,点击导出按钮
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 })
  await exportBtn.click()
  const download = await downloadPromise

  // ── 文件名 ────────────────────────────────────────────────────
  expect(download.suggestedFilename()).toBe('slides.md')

  // ── 内容:读流 → 跟 DB current version content 一致 ──────────
  const path = await download.path()
  expect(path).toBeTruthy()
  const { readFileSync } = await import('node:fs')
  const downloaded = readFileSync(path!, 'utf-8')
  expect(downloaded).toBe(dbContent)

  // 触底再断言下:内容含 beitou-cover layout 标识(防 dbContent / downloaded 同步空)
  expect(downloaded).toContain('layout: beitou-cover')
  expect(downloaded.length).toBeGreaterThan(50)

  // healthz: agent 必须在(防 GET /api/decks 突然挂导致前面 dbContent 空 case 误漏)
  const r = await page.request.get(`${AGENT_BASE}/healthz`)
  expect(r.ok()).toBe(true)
})
