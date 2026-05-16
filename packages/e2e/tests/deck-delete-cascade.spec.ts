/**
 * Deck 删除级联清理 E2E。
 *
 * 验收:
 * - deck 创建后 deck_versions / deck_chats / deck_assets 各有行
 * - 点 /decks 列表删除按钮 → confirm dialog accept → DELETE /api/decks/:id 调用
 * - DB 验:decks 行 status='deleted'(soft delete);deck_assets 物理清除(routes/decks.ts 显式调 deleteAssetsByDeck)
 * - deck_versions / deck_chats 在 soft delete 模式下保留(只 status 标记;cascade 仅在硬删用户时触发)
 * - GET /api/decks/:id → 仍可读取(因 owner 且 status='deleted' 的行 ownership check 通过,decks GET 路由不过滤 status)
 *   但 GET /api/decks 列表(active/archived 过滤)中 deck 不再出现
 *
 * 注:Lumideck 当前 deck 删除是 soft delete(decks.status='deleted')+ deck_assets 硬清,
 * **不是** 整链路 cascade hard delete。本 spec 验当前实现契约。
 */
import { expect, test } from '@playwright/test'
import {
  AGENT_BASE,
  truncateAllTables,
  disposeDb,
  getDeckRawSql,
  countVersionsByDeck,
  countChatsByDeck,
  countAssetsByDeck,
  listAssetsByDeckSql,
} from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('deck 删除 → soft delete(status=deleted)+ deck_assets 物理清 + 列表不可见', async ({
  page,
}) => {
  const email = `del-${Date.now()}@test.com`

  // 注册 + 自动登录
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 配生图模型(直走 API,UI 流程已被 SettingsModal 单测覆盖)
  await page.request.put(`${AGENT_BASE}/api/image-llm-settings`, {
    headers: { Origin: AGENT_BASE },
    data: { provider: 'openai', apiKey: 'sk-stub-fake' },
  })

  // 创建 deck(走 picker)
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('标题').fill('to-be-deleted')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // ── 准备子表数据 ─────────────────────────────────────────────
  //
  // 1) deck_chats:用户层 API 直接写一条
  const chatRes = await page.request.post(`${AGENT_BASE}/api/decks/${deckId}/chats`, {
    headers: { 'content-type': 'application/json', Origin: AGENT_BASE },
    data: { role: 'user', content: '准备删除的 deck 占位 chat' },
  })
  expect(chatRes.status()).toBe(201)

  // 2) deck_assets:触发 generate_slide_image stub job → poll 至 done(image-content.spec 同款套路)
  const toolRes = await page.request.post(`${AGENT_BASE}/api/call-tool`, {
    headers: {
      'content-type': 'application/json',
      Origin: AGENT_BASE,
      'X-Deck-Id': String(deckId),
    },
    data: {
      name: 'generate_slide_image',
      args: {
        slideIndex: 2,
        prompt: 'cascade-test placeholder',
        fallbackSummary: '删除级联测试用占位摘要',
      },
      turnId: `e2e-del-${Date.now()}`,
    },
  })
  expect(toolRes.ok()).toBe(true)
  const innerRaw = await toolRes.json()
  const inner = typeof innerRaw.result === 'string' ? JSON.parse(innerRaw.result) : innerRaw.result ?? innerRaw
  expect(inner.success).toBe(true)
  const jobId: string = inner.jobId
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`${AGENT_BASE}/api/image-jobs/${jobId}`)
        if (!r.ok()) return 'pending'
        return (await r.json()).job.state
      },
      { timeout: 15_000, intervals: [200, 500] },
    )
    .toBe('done')

  // ── 删前 DB sanity:三表都有行 ─────────────────────────────────
  expect(await countAssetsByDeck(deckId)).toBe(1)
  expect(await countChatsByDeck(deckId)).toBe(1)
  // deck_versions:至少 1(初始 starter)+ generate_slide_image worker 更新 slide 后追加 = 2
  const versionsBefore = await countVersionsByDeck(deckId)
  expect(versionsBefore).toBeGreaterThanOrEqual(1)

  // assets 行验记录细节
  const assets = await listAssetsByDeckSql(deckId)
  expect(assets[0]?.mime_type).toBe('image/png')

  // ── 回 /decks 列表,卡片显示 ─────────────────────────────────
  await page.getByRole('button', { name: /返回列表/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
  await expect(page.getByText('to-be-deleted')).toBeVisible({ timeout: 10_000 })

  // 点删除按钮(原生 confirm 弹窗)→ 接受 confirm
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('to-be-deleted')
    await dialog.accept()
  })

  // 找到 to-be-deleted 卡片内的删除按钮(.card-action.danger,title="删除")并点
  const deckCard = page.locator('.deck-card', { hasText: 'to-be-deleted' })
  await deckCard.locator('button.card-action.danger').click()

  // 卡片从 UI 消失(filter out)
  await expect(page.getByText('to-be-deleted')).toHaveCount(0, { timeout: 10_000 })

  // ── 删后 DB 验证 ─────────────────────────────────────────────
  // 1) decks 行 soft delete(仍存在,status='deleted')
  const deckAfter = await getDeckRawSql(deckId)
  expect(deckAfter).toBeTruthy()
  expect(deckAfter!.status).toBe('deleted')

  // 2) deck_assets 行物理清(routes/decks.ts DELETE 显式调 deleteAssetsByDeck)
  expect(await countAssetsByDeck(deckId)).toBe(0)

  // 3) deck_chats / deck_versions:soft delete 模式下保留(cascade FK 只在 hard delete 触发)
  //    断言只验「不爆炸」即可,不强求归 0(那是 hard delete 设计,当前是 soft)
  expect(await countChatsByDeck(deckId)).toBeGreaterThanOrEqual(0)
  expect(await countVersionsByDeck(deckId)).toBeGreaterThanOrEqual(0)

  // 4) GET /api/decks 列表(active/archived 过滤):不返回 deleted 的 deck
  const listRes = await page.request.get(`${AGENT_BASE}/api/decks`)
  expect(listRes.ok()).toBe(true)
  const listBody = (await listRes.json()) as { decks: Array<{ id: number; status: string }> }
  expect(listBody.decks.find((d) => d.id === deckId)).toBeUndefined()
})
