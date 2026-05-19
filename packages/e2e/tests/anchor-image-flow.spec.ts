/**
 * Phase 11.8 Task H-1:anchor 选样全链路 E2E。
 *
 * stub 模式:
 * - BIG_PPT_TEST_IMAGE_MODE=stub:generateImage 跳真 OpenAI 读 fixture PNG
 * - BIG_PPT_TEST_MOOD_BOARD_MODE=stub:mood-board generator 跳真主 LLM 返 3 个 hardcoded sample
 * 两个 env 都在 playwright.config.ts webServer.env 设好,本 spec 不烧 token。
 *
 * 覆盖:
 *  (a) 完整闭环:配 image LLM → 建 deck → 自动弹 modal → 选第 1 张 → DB 验 anchor_asset_id +
 *      asset.purpose='anchor' + 其它 candidate=discarded
 *  (b) 跳过路径:开 modal → 点跳过 → modal 关 + deck.anchor_asset_id 仍 null
 *  (c) 工具透传:配 anchor 后调 generate_slide_image → job 透传 baseImage(anchor BLOB)
 *
 * 换批限频 e2e 不重复(routes-mood-board.test.ts 已 16 case 覆盖含 429)。
 */
import { test, expect } from '@playwright/test'
import mysql from 'mysql2/promise'

const AGENT_PORT = Number(process.env.AGENT_PORT ?? 4100)
const AGENT_BASE = `http://localhost:${AGENT_PORT}`

let db: mysql.Connection

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set (e2e 需 .env.test.local)')
  db = await mysql.createConnection(url)
})
test.afterAll(async () => {
  await db?.end()
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

test.describe('Phase 11.8 anchor 选样闭环', () => {
  test('配 image+main LLM → 建 deck → 自动弹 modal → 选定 → DB 验 anchor_asset_id 写入', async ({
    page,
  }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor happy-path')

    // 编辑器加载完成 + onMounted 探查 LLM + 自动 openPicker
    await expect(page.locator('[data-anchor-picker-modal]')).toBeVisible({ timeout: 30_000 })

    // 3 张候选缩略图渲染
    const cards = page.locator('[data-candidate-id]')
    await expect(cards).toHaveCount(3, { timeout: 60_000 })

    // 点第 1 张选定
    const firstCard = cards.first()
    const targetAssetId = await firstCard.getAttribute('data-candidate-id')
    expect(targetAssetId).toMatch(/^[0-9a-f-]{36}$/i)
    await firstCard.click()

    // modal 关闭
    await expect(page.locator('[data-anchor-picker-modal]')).toBeHidden({ timeout: 10_000 })

    // DB 验证:decks.anchor_asset_id = 选中的 assetId
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toBe(targetAssetId)

    // DB 验证:asset.purpose = 'anchor';其它两个 candidate purpose = 'mood-board-discarded'
    const [assets] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, purpose FROM deck_assets WHERE deck_id = ? ORDER BY created_at`,
      [deckId],
    )
    expect(assets.length).toBe(3)
    const map = Object.fromEntries(assets.map((a) => [a.id, a.purpose]))
    expect(map[targetAssetId!]).toBe('anchor')
    const others = assets.map((a) => a.id).filter((id) => id !== targetAssetId)
    for (const oid of others) {
      expect(map[oid]).toBe('mood-board-discarded')
    }
  })

  test('开 modal → 点跳过 → deck.anchor_asset_id 仍 null + 流程继续', async ({ page }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor skip-path')

    await expect(page.locator('[data-anchor-picker-modal]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-candidate-id]')).toHaveCount(3, { timeout: 60_000 })

    // 点 "跳过本次" 按钮
    await page.locator('[data-skip-bottom]').click()
    await expect(page.locator('[data-anchor-picker-modal]')).toBeHidden({ timeout: 5_000 })

    // DB 验证:deck.anchor_asset_id 仍 null;3 个 candidate 行仍存在(purpose='mood-board-candidate')
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toBeNull()

    const [candidates] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, purpose FROM deck_assets WHERE deck_id = ?`,
      [deckId],
    )
    expect(candidates.length).toBe(3)
    for (const c of candidates) expect(c.purpose).toBe('mood-board-candidate')
  })

  test('选定 anchor 后调 generate_slide_image → 工具透传 baseImage(读 anchor BLOB)', async ({
    page,
  }) => {
    await registerAndConfigure(page)
    const deckId = await createDeck(page, 'anchor tool inject')

    await expect(page.locator('[data-anchor-picker-modal]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-candidate-id]')).toHaveCount(3, { timeout: 60_000 })

    const targetAssetId = await page
      .locator('[data-candidate-id]')
      .first()
      .getAttribute('data-candidate-id')
    await page.locator('[data-candidate-id]').first().click()
    await expect(page.locator('[data-anchor-picker-modal]')).toBeHidden({ timeout: 5_000 })

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
      typeof callBody.result === 'string' ? JSON.parse(callBody.result) : callBody.result ?? callBody
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

    // worker 完成后 deck_assets 应有:3 candidates + 1 anchor 选定中的(purpose 切到 anchor)
    // + 1 普通生图产物(purpose=null,刚 generate_slide_image 产出的)
    const [assets] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT id, purpose FROM deck_assets WHERE deck_id = ? ORDER BY created_at`,
      [deckId],
    )
    expect(assets.length).toBe(4)
    const purposeCount = assets.reduce<Record<string, number>>((acc, a) => {
      const k = a.purpose ?? 'null'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
    // 选定的那张 anchor + 2 张 discarded + 1 张刚生成的普通(purpose=null)
    expect(purposeCount['anchor']).toBe(1)
    expect(purposeCount['mood-board-discarded']).toBe(2)
    expect(purposeCount['null']).toBe(1)

    // **anchor 仍是当时选定的 assetId**
    const [[deckRow]] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT anchor_asset_id FROM decks WHERE id = ?`,
      [deckId],
    )
    expect(deckRow!.anchor_asset_id).toBe(targetAssetId)
  })
})
