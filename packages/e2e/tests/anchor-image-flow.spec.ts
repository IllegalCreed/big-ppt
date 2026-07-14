/**
 * Phase 17:预设优先的配图风格全链路 E2E。
 *
 * stub 模式:
 * - BIG_PPT_TEST_IMAGE_MODE=stub:generateImage 跳真 OpenAI 读 fixture PNG
 * 系统预设选择不调用 mood-board；普通生图继续用 BIG_PPT_TEST_IMAGE_MODE=stub。
 *
 * 覆盖:
 *  (a) 系统预设一键应用并 materialize 为 deck-local anchor
 *  (b) 自由生成路径解除首次决策
 *  (c) 系统预设 anchor 继续透传给 generate_slide_image
 *  (d) deck A 显式 AI 探索并保存 → deck B 从“我的风格”即时复用
 */
import { test, expect } from '@playwright/test'
import mysql from 'mysql2/promise'
import { AGENT_BASE, disposeDb, truncateAllTables } from './helpers/db'

let db: mysql.Connection

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set (e2e 需 .env.test.local)')
  db = await mysql.createConnection(url)
})
test.afterAll(async () => {
  await db?.end()
  await disposeDb()
})
test.beforeEach(async () => {
  await truncateAllTables()
})

async function configureImageLlm(page: import('@playwright/test').Page) {
  const res = await page.request.put(`${AGENT_BASE}/api/image-llm-settings`, {
    headers: { Origin: AGENT_BASE },
    data: { provider: 'openai', apiKey: 'sk-stub-fake' },
  })
  expect(res.ok()).toBe(true)
}

async function configureMainLlm(page: import('@playwright/test').Page) {
  // mood-board stub 模式不 strictly 要求主 LLM key(BIG_PPT_TEST_MOOD_BOARD_MODE=stub
  // 跳过 loadUserLlmSettings),但配上让代码路径接近 prod。
  const res = await page.request.put(`${AGENT_BASE}/api/auth/llm-settings`, {
    headers: { Origin: AGENT_BASE, 'Content-Type': 'application/json' },
    data: {
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'glm-stub', model: 'GLM-5.1' } },
    },
  })
  expect(res.ok()).toBe(true)
}

async function registerAndConfigure(page: import('@playwright/test').Page) {
  const email = `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
  await configureImageLlm(page)
  await configureMainLlm(page)
}

async function createDeck(page: import('@playwright/test').Page, title: string): Promise<number> {
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]')).toHaveCount(2, { timeout: 10_000 })
  await page.locator('[data-template-card]').filter({ hasText: '北投集团汇报模板' }).click()
  await page.getByLabel('标题').fill(title)
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  return Number(page.url().match(/\/decks\/(\d+)/)![1])
}

async function openStyleLibrary(page: import('@playwright/test').Page): Promise<void> {
  const button = page.locator('[data-image-style-library-btn]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(page.locator('[data-image-style-library]')).toBeVisible({ timeout: 30_000 })
}

test.describe('Phase 17 配图风格库闭环', () => {
  test('系统预设即时应用 → DB 写入 deck-local anchor 与来源', async ({ page }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor happy-path')

    await openStyleLibrary(page)

    // 系统预设立即出现，不等待 AI 抽卡。
    const cards = page.locator('[data-style-source="system"]')
    await expect(cards.first()).toBeVisible({ timeout: 10_000 })

    // 点第 1 张直接应用。
    const firstCard = cards.first()
    const targetStyleId = await firstCard.getAttribute('data-style-id')
    expect(targetStyleId).toMatch(/^[a-z0-9-]+$/)
    await firstCard.click()

    // modal 关闭
    await expect(page.locator('[data-image-style-library]')).toBeHidden({ timeout: 10_000 })

    // DB 验证:deck 指向 materialized asset。
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id, anchor_skipped FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(Boolean(deckRow!.anchor_skipped)).toBe(true)

    // 系统 preset 只复制一份 anchor，不会先生成 3 张 mood-board candidate。
    const [assets] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, purpose, style_source, style_source_id FROM deck_assets WHERE deck_id = ?`,
      [deckId],
    )
    expect(assets).toHaveLength(1)
    expect(assets[0]!.id).toBe(deckRow!.anchor_asset_id)
    expect(assets[0]!.purpose).toBe('style-preset-anchor')
    expect(assets[0]!.style_source).toBe('system')
    expect(assets[0]!.style_source_id).toBe(targetStyleId)
  })

  test('开风格库 → 使用自由生成 → anchor 为空且决策已完成', async ({ page }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor skip-path')

    await openStyleLibrary(page)
    await page.locator('[data-free-style]').click()
    await expect(page.locator('[data-image-style-library]')).toBeHidden({ timeout: 5_000 })

    // 没有抽卡，也不会制造 deck asset。
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id, anchor_skipped FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toBeNull()
    expect(Boolean(deckRow!.anchor_skipped)).toBe(true)

    const [assets] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id FROM deck_assets WHERE deck_id = ?`,
      [deckId],
    )
    expect(assets).toHaveLength(0)
  })

  test('应用系统预设后调 generate_slide_image → 工具透传 materialized anchor', async ({ page }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor tool inject')

    await openStyleLibrary(page)
    await page.locator('[data-style-source="system"]').first().click()
    await expect(page.locator('[data-image-style-library]')).toBeHidden({ timeout: 5_000 })
    const [[selectedDeck]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [deckId],
    )
    const targetAssetId = selectedDeck!.anchor_asset_id as string

    // 直接调 /api/call-tool 触发 generate_slide_image(slideIndex=2)
    const callRes = await page.request.post(`${AGENT_BASE}/api/call-tool`, {
      headers: {
        'content-type': 'application/json',
        Origin: AGENT_BASE,
        'X-Deck-Id': String(deckId),
      },
      data: {
        name: 'generate_slide_image',
        args: {
          slideIndex: 2,
          prompt: 'a futuristic city',
          fallbackSummary: 'E2E anchor 透传测试用占位摘要',
        },
        turnId: `e2e-anchor-${Date.now()}`,
      },
    })
    expect(callRes.ok()).toBe(true)
    const callBody = await callRes.json()
    const inner =
      typeof callBody.result === 'string'
        ? JSON.parse(callBody.result)
        : (callBody.result ?? callBody)
    expect(inner.success).toBe(true)
    const jobId = inner.jobId as string

    // 轮询 job 至 done(stub 模式 ~1-2s 内完成)
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${AGENT_BASE}/api/image-jobs/${jobId}`)
          if (!r.ok()) return 'pending'
          const j = await r.json()
          return j.job.state
        },
        { timeout: 30_000, intervals: [200, 500] },
      )
      .toMatch(/done|fallback-rewrote/)

    // worker 完成后 deck_assets 应有:1 preset anchor + 1 普通生图产物。
    const [assets] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, purpose FROM deck_assets WHERE deck_id = ? ORDER BY created_at`,
      [deckId],
    )
    expect(assets.length).toBe(2)
    const purposeCount = assets.reduce<Record<string, number>>((acc, a) => {
      const k = a.purpose ?? 'null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    expect(purposeCount['style-preset-anchor']).toBe(1)
    expect(purposeCount['null']).toBe(1)

    // **anchor 仍是当时选定的 assetId**
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toBe(targetAssetId)
  })

  test('deck A 探索并保存 → deck B 从我的风格直接复用', async ({ page }) => {
    test.setTimeout(60_000)
    await registerAndConfigure(page)
    const sourceDeckId = await createDeck(page, 'style source deck')

    await openStyleLibrary(page)
    await page.locator('[data-style-tab="explore"]').click()
    await page.locator('[data-explore-styles]').click()

    const exploredCard = page.locator('[data-style-source="explore"]').first()
    await expect(exploredCard).toBeVisible({ timeout: 20_000 })
    const sourceAssetId = await exploredCard.getAttribute('data-style-id')
    expect(sourceAssetId).toMatch(/^[0-9a-f-]{36}$/i)

    const exploredArticle = page
      .locator(`[data-style-source="explore"][data-style-id="${sourceAssetId}"]`)
      .locator('xpath=ancestor::article')
    await exploredArticle.getByRole('button', { name: /^保存.+到我的风格$/ }).click()
    await expect(exploredArticle.getByText('已保存')).toBeVisible({ timeout: 10_000 })

    const [[preset]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, source_asset_id FROM user_style_presets WHERE source_asset_id = ?`,
      [sourceAssetId],
    )
    expect(preset!.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(preset!.source_asset_id).toBe(sourceAssetId)

    await page.locator('[data-close-style-library]').click()
    await expect(page.locator('[data-image-style-library]')).toBeHidden({ timeout: 5_000 })
    await page.getByRole('button', { name: '返回列表' }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    const targetDeckId = await createDeck(page, 'style target deck')
    await openStyleLibrary(page)
    await page.locator('[data-style-tab="user"]').click()
    const savedCard = page.locator('[data-style-source="user"][data-style-id]').first()
    await expect(savedCard).toBeVisible({ timeout: 10_000 })
    expect(await savedCard.getAttribute('data-style-id')).toBe(preset!.id)
    await savedCard.click()
    await expect(page.locator('[data-image-style-library]')).toBeHidden({ timeout: 10_000 })

    const [[targetDeck]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [targetDeckId],
    )
    const [[targetAnchor]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT style_source, style_source_id, purpose FROM deck_assets WHERE id = ? AND deck_id = ?`,
      [targetDeck!.anchor_asset_id, targetDeckId],
    )
    expect(targetAnchor).toMatchObject({
      style_source: 'user',
      style_source_id: preset!.id,
      purpose: 'style-preset-anchor',
    })

    // 源 deck 与用户级 preset 均保持原状，目标 deck 只有自己的 materialized 副本。
    expect(sourceDeckId).not.toBe(targetDeckId)
    expect(targetDeck!.anchor_asset_id).not.toBe(sourceAssetId)
  })
})
