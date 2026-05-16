/**
 * Deck 版本历史 E2E。
 *
 * 验收:
 * - 新建 deck → deck_versions 至少 1 行(初始 starter)
 * - 调 generate_slide_image stub → worker 更新 slide → deck_versions 追加新行
 * - GET /api/decks/:id/versions → 倒序返回版本列表(最新在前)
 * - 点版本历史 drawer(toolbar History 按钮)→ 列表可见
 * - 点旧版本「恢复」按钮 → POST /api/decks/:id/restore/:vid → currentVersion 指回旧 content
 * - 验 slides 内容跟 v1 一致(回滚成功)
 *
 * 不用真 LLM:走 /api/call-tool 触发 generate_slide_image stub job,worker 跑完
 * 后端会 updateSlide → persistVersion → deck_versions 加行,实现"工具调用产生版本"。
 */
import { expect, test } from '@playwright/test'
import {
  AGENT_BASE,
  truncateAllTables,
  disposeDb,
  countVersionsByDeck,
  listVersionsByDeckSql,
  getCurrentVersionContent,
} from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('版本时间线:工具调用累积版本 + GET /versions 倒序 + restore 回旧 content', async ({
  page,
}) => {
  const email = `ver-${Date.now()}@test.com`

  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 配生图模型(stub 不真打 OpenAI)
  await page.request.put(`${AGENT_BASE}/api/image-llm-settings`, {
    headers: { Origin: AGENT_BASE },
    data: { provider: 'openai', apiKey: 'sk-stub-fake' },
  })

  // 创建 deck(beitou-standard)
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill('version-test')
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // ── v1: 初始版本(starter)─────────────────────────────────────
  const v1Count = await countVersionsByDeck(deckId)
  expect(v1Count).toBeGreaterThanOrEqual(1)
  const v1Content = await getCurrentVersionContent(deckId)
  expect(v1Content).toBeTruthy()
  // beitou-standard starter 含 beitou-cover layout(starter.md head)
  expect(v1Content).toContain('layout: beitou-cover')

  // ── v2: 触发 generate_slide_image stub → worker 写 deck_assets + updateSlide + persistVersion ─
  const callRes = await page.request.post(`${AGENT_BASE}/api/call-tool`, {
    headers: {
      'content-type': 'application/json',
      Origin: AGENT_BASE,
      'X-Deck-Id': String(deckId),
    },
    data: {
      name: 'generate_slide_image',
      args: {
        slideIndex: 3, // 第 3 页是 starter 的 beitou-content 页
        prompt: 'version-test placeholder image',
        fallbackSummary: '版本历史测试占位摘要',
      },
      turnId: `e2e-ver-${Date.now()}`,
    },
  })
  expect(callRes.ok()).toBe(true)
  const innerRaw = await callRes.json()
  const inner = typeof innerRaw.result === 'string' ? JSON.parse(innerRaw.result) : innerRaw.result ?? innerRaw
  expect(inner.success).toBe(true)
  const jobId: string = inner.jobId

  // poll 至 done(worker 在 done 路径上会 updateSlide → persistVersion)
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

  // 等 deck_versions 涨到 ≥ v1Count + 1(worker 异步,可能稍晚 commit)
  await expect
    .poll(async () => await countVersionsByDeck(deckId), { timeout: 5_000, intervals: [200, 500] })
    .toBeGreaterThan(v1Count)

  // ── 验 currentVersion 指向新版本(content 含 image-content layout)─
  const v2Content = await getCurrentVersionContent(deckId)
  expect(v2Content).toContain('beitou-image-content') // worker updateSlide 切了 layout
  expect(v2Content).not.toBe(v1Content) // 内容已变

  // ── GET /api/decks/:id/versions 倒序 ─────────────────────────
  const versionsRes = await page.request.get(`${AGENT_BASE}/api/decks/${deckId}/versions`)
  expect(versionsRes.ok()).toBe(true)
  const { versions } = (await versionsRes.json()) as {
    versions: Array<{ id: number; createdAt: string; message: string | null }>
  }
  expect(versions.length).toBeGreaterThanOrEqual(2)
  // 倒序:第一条 createdAt 应不早于第二条
  const t0 = new Date(versions[0]!.createdAt).getTime()
  const t1 = new Date(versions[1]!.createdAt).getTime()
  expect(t0).toBeGreaterThanOrEqual(t1)

  // ── 点版本历史按钮打开 drawer ────────────────────────────────
  await page.getByRole('button', { name: '版本历史' }).click()
  // drawer 内 <h3>版本历史</h3>
  await expect(page.getByRole('heading', { name: '版本历史' })).toBeVisible({ timeout: 5_000 })

  // ── restore v1: 调 API 验回滚契约(UI 按钮点击在 drawer 内,留给单测)─
  //
  // 拿 SQL 直读的 v1 id(versions 最早一条 = 倒序最后一个 = v1)
  const dbVersions = await listVersionsByDeckSql(deckId)
  const v1Id = dbVersions[dbVersions.length - 1]!.id // 最早

  const restoreRes = await page.request.post(
    `${AGENT_BASE}/api/decks/${deckId}/restore/${v1Id}`,
    {
      headers: { Origin: AGENT_BASE },
    },
  )
  expect(restoreRes.ok()).toBe(true)

  // 验:current_version_id 回 v1,content 跟最初的 starter 一致
  const afterRestore = await getCurrentVersionContent(deckId)
  expect(afterRestore).toBe(v1Content)
  expect(afterRestore).toContain('layout: beitou-cover')
  expect(afterRestore).not.toContain('beitou-image-content')
})
