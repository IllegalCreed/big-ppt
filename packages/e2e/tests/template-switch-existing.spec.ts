/**
 * Phase 7D-2：已有 beitou deck → 顶栏切换到 jingyeda → AI 重写（skeleton mode 跳 LLM）→ DB 合规。
 *
 * skeleton mode 由 playwright.config.ts 注入到 agent webServer 的 BIG_PPT_TEST_REWRITE_MODE=skeleton 触发，
 * rewriteForTemplate 会直接读 templates/jingyeda-standard/starter.md 而非调真 LLM。
 */
import { expect, test } from '@playwright/test'
import {
  truncateAllTables,
  disposeDb,
  getDeckByIdSql,
  getCurrentVersionContent,
  getTemplateLayoutNames,
  extractLayouts,
} from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('beitou deck 切到 jingyeda：state 走完 → DB.templateId=jingyeda + content 全合规 + UndoToast 出现', async ({
  page,
}) => {
  // 注册
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(`u-7d2-${Date.now()}@test.com`)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 走 picker UI 创 beitou deck
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  const cards = page.locator('[data-template-card]')
  await expect(cards).toHaveCount(2, { timeout: 10_000 })
  await cards.filter({ hasText: '北投集团汇报模板' }).click()
  await page.getByLabel('标题').fill('7D-2 待切换 deck')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])

  // 顶栏点切换模板 → picker 弹出（switch mode）
  await page.getByRole('button', { name: '切换模板' }).click()
  const cards2 = page.locator('[data-template-card]')
  await expect(cards2).toHaveCount(2, { timeout: 10_000 })

  // 选 jingyeda → 主按钮变"切换（AI 重写）"
  await cards2.filter({ hasText: '竞业达汇报模板' }).click()
  await page.getByRole('button', { name: /切换（AI 重写）/ }).click()

  // 等切换完成（skeleton mode 几乎瞬间走完）→ success view
  await expect(page.getByText(/切换完成/)).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-success-view]').click() // 关弹窗

  // UndoToast 出现
  await expect(page.locator('[data-undo-link]')).toBeVisible({ timeout: 5_000 })

  // ── DB 验证 ──────────────────────────────────────────────
  const deck = await getDeckByIdSql(deckId)
  expect(deck!.template_id).toBe('jingyeda-standard')

  const content = await getCurrentVersionContent(deckId)
  const layouts = extractLayouts(content!)
  expect(layouts.length).toBeGreaterThan(0)
  const allowed = await getTemplateLayoutNames('jingyeda-standard')
  for (const l of layouts) {
    expect(allowed, `layout ${l} 应属 jingyeda-standard 白名单`).toContain(l)
  }
})
