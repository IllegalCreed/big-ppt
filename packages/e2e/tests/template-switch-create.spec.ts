/**
 * Phase 7D-1：新建 deck 选 jingyeda-standard → 编辑器渲染 → DB 落地 + layout 合规。
 *
 * 与已有的 template-picker.spec.ts 互补：那条聚焦 picker UI / 缩略图加载，
 * 本条聚焦 DB 落地（decks.template_id）+ 当前 version content 的 layout 都属新模板白名单，
 * 等价于"切到 jingyeda 后内容真的合规"。
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

test('新建 deck 走 picker 选 jingyeda → DB.templateId=jingyeda-standard + content layout 全在白名单', async ({
  page,
}) => {
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(`u-7d1-${Date.now()}@test.com`)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 通过 picker 选 jingyeda
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  const cards = page.locator('[data-template-card]')
  await expect(cards).toHaveCount(2, { timeout: 10_000 })
  await cards.filter({ hasText: '竞业达汇报模板' }).click()
  await page.getByLabel('标题').fill('7D-1 竞业达 Deck')
  await page.getByRole('button', { name: /^创建$/ }).click()

  // 跳转编辑器
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const url = page.url()
  const deckId = Number(url.match(/\/decks\/(\d+)/)![1])
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // ── DB 验证 ──────────────────────────────────────────────
  const deck = await getDeckByIdSql(deckId)
  expect(deck).not.toBeNull()
  expect(deck!.template_id).toBe('jingyeda-standard')
  expect(deck!.title).toBe('7D-1 竞业达 Deck')

  const content = await getCurrentVersionContent(deckId)
  expect(content).toBeTruthy()

  const layouts = extractLayouts(content!)
  expect(layouts.length).toBeGreaterThan(0)
  const allowed = await getTemplateLayoutNames('jingyeda-standard')
  for (const l of layouts) {
    expect(allowed, `layout ${l} 应属 jingyeda-standard 白名单`).toContain(l)
  }
})
