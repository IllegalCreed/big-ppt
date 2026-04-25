/**
 * Phase 7D-3：切完模板后点 UndoToast 的 /undo → VersionTimeline 高亮 snapshot → 点回滚 →
 * DB.templateId 回 beitou + content 回 beitou 白名单 + 内容字符串与切前一致（双向可逆 + 无数据丢失）。
 *
 * 这是 roadmap Phase 7 验收"两套模板双向切换可逆"的硬验证。依赖 7D-A 的
 * `deckVersions.template_id` 列 + restore 端点同步 `decks.template_id` 修复。
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

test('切完 jingyeda → /undo → 回滚 snapshot → DB.templateId 回 beitou + 内容字符串完全一致', async ({
  page,
}) => {
  // 注册
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(`u-7d3-${Date.now()}@test.com`)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 走 picker 创 beitou deck
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  const cards = page.locator('[data-template-card]')
  await expect(cards).toHaveCount(2, { timeout: 10_000 })
  await cards.filter({ hasText: '北投集团汇报模板' }).click()
  await page.getByLabel('标题').fill('7D-3 双向可逆 deck')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])

  // 切前快照内容（DB 直读，避开 UI 异步）
  const beforeContent = await getCurrentVersionContent(deckId)
  expect(beforeContent).toBeTruthy()

  // 切到 jingyeda
  await page.getByRole('button', { name: '切换模板' }).click()
  const switchCards = page.locator('[data-template-card]')
  await expect(switchCards).toHaveCount(2, { timeout: 10_000 })
  await switchCards.filter({ hasText: '竞业达汇报模板' }).click()
  await page.getByRole('button', { name: /切换（AI 重写）/ }).click()
  await expect(page.getByText(/切换完成/)).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-success-view]').click()

  // 切后状态：jingyeda
  await expect.poll(async () => (await getDeckByIdSql(deckId))?.template_id).toBe('jingyeda-standard')

  // 点 UndoToast 的 /undo 链接 → VersionTimeline 打开并高亮 snapshot
  await expect(page.locator('[data-undo-link]')).toBeVisible({ timeout: 5_000 })
  await page.locator('[data-undo-link]').click()

  // 等 VersionTimeline 出现，找高亮项 → 点其回滚按钮
  const highlighted = page.locator('.version-list .item.highlighted, .item[data-highlighted="true"]').first()
  await expect(highlighted).toBeVisible({ timeout: 5_000 })
  await highlighted.locator('.restore-btn').click()

  // 等回滚完成（restore 是同步 PUT，UI 这边 DB 立刻就会更新）
  await expect.poll(async () => (await getDeckByIdSql(deckId))?.template_id, {
    timeout: 10_000,
  }).toBe('beitou-standard')

  // ── DB 验证：内容回到 snapshot（与切前完全一致）+ layout 全在 beitou 白名单 ──
  const afterContent = await getCurrentVersionContent(deckId)
  expect(afterContent).toBe(beforeContent)

  const layouts = extractLayouts(afterContent!)
  expect(layouts.length).toBeGreaterThan(0)
  const allowed = await getTemplateLayoutNames('beitou-standard')
  for (const l of layouts) {
    expect(allowed, `layout ${l} 应属 beitou-standard 白名单`).toContain(l)
  }
})
