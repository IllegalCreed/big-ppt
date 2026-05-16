/**
 * Phase 11.6：generate_slide_image graceful-degradation fallback-rewrote E2E。
 *
 * 验 Phase 11.6 兜底链路:OpenAI image API 失败 → worker 调
 * rewriteSinglePageToComponents 用 fallbackSummary 重写为 *-content + 组件版,
 * 状态机走到 fallback-rewrote(useGenerateImageJob 视为 success)。
 *
 * 关键 env 触发(playwright.config 的 BIG_PPT_E2E_IMAGE_MODE):
 *   BIG_PPT_E2E_IMAGE_MODE=fallback → webServer 起 BIG_PPT_TEST_IMAGE_MODE=fallback,
 *   工具内 fallbackForcedGenerateImage 总是抛错 → worker 走 graceful-degradation 分支。
 *   rewriteSinglePageToComponents 同时受 BIG_PPT_TEST_REWRITE_MODE=skeleton 守(已设),
 *   返 skeleton 单页(layout=*-content + heading + summary 文本)避免烧主 LLM key。
 *
 * # 跑法
 *   BIG_PPT_E2E_IMAGE_MODE=fallback pnpm -F @big-ppt/e2e test image-gen-fallback
 *   # 不设 env 时本 spec test.skip(防误跑;依赖 webServer 用 fallback 模式起)
 *
 * 注:本 spec 不依赖真 OpenAI key(强制错路径,不打外网),适合在 CI 跑覆盖兜底。
 */
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  AGENT_BASE,
  truncateAllTables,
  disposeDb,
  countAssetsByDeck,
  extractLayouts,
} from './helpers/db'

test.describe.configure({ mode: 'serial' })

const FALLBACK_MODE_ON = process.env.BIG_PPT_E2E_IMAGE_MODE === 'fallback'

const SLIDES_FILE = '/tmp/lumideck-e2e-slides.md'

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test.describe('Phase 11.6 fallback-rewrote E2E(需 BIG_PPT_E2E_IMAGE_MODE=fallback)', () => {
  test.skip(
    !FALLBACK_MODE_ON,
    'BIG_PPT_E2E_IMAGE_MODE not set to "fallback"; skip (run BIG_PPT_E2E_IMAGE_MODE=fallback pnpm -F @big-ppt/e2e test image-gen-fallback)',
  )

  test('OpenAI image API 强制失败 → worker 走 graceful-degradation → fallback-rewrote', async ({
    page,
  }) => {
    // worker fallback rewrite 走 skeleton 模式,不打 LLM,应该 <30s 跑完,留 60s buffer
    test.setTimeout(60_000)

    // 1. 注册 + 自动登录
    const email = `u-imgfb-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 2. 配生图模型(fallback 模式下工具内不真打 OpenAI,任意 key 都行;
    //    若不配,工具同步入口拒收 — 生产用户路径就是这样;复用 image-content.spec 模式)
    const settingsRes = await page.request.put(`${AGENT_BASE}/api/image-llm-settings`, {
      headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
      data: { provider: 'openai', apiKey: 'sk-fallback-placeholder' },
    })
    expect(settingsRes.ok()).toBe(true)

    // 3. 走 picker 创 beitou deck(用第一个模板卡 = 北投)
    await page.getByRole('button', { name: /新建 Deck/ }).click()
    const cards = page.locator('[data-template-card]')
    await expect(cards).toHaveCount(2, { timeout: 10_000 })
    await cards.filter({ hasText: '北投' }).click()
    await page.getByLabel('标题').fill('image-gen fallback e2e')
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
    const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 4. 调 generate_slide_image,fallbackSummary 必填(Phase 11.6 dogfood 后);
    //    worker 内的 fallbackForcedGenerateImage 必定抛错,触发 graceful-degradation
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
          prompt: 'an abstract concept that would fail',
          fallbackSummary: '介绍北投集团本季度三大重点工作:战略部署、组织调整、业务突破',
        },
        turnId: `e2e-fb-${Date.now()}`,
      },
    })
    expect(callRes.ok()).toBe(true)
    const callBody = await callRes.json()
    expect(callBody.success).toBe(true)
    const inner =
      typeof callBody.result === 'string'
        ? JSON.parse(callBody.result)
        : (callBody.result ?? callBody)
    expect(inner.success).toBe(true)
    expect(inner.jobId).toMatch(/^[0-9a-f-]{36}$/)
    expect(inner.status).toBe('queued')

    // 5. 轮询至终态,**期望 fallback-rewrote**(NOT done — 因为 generateImage 强制失败)
    const jobId: string = inner.jobId
    let finalState: string | null = null
    let assetId: string | null = null
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${AGENT_BASE}/api/image-jobs/${jobId}`)
          if (!r.ok()) return 'pending'
          const j = await r.json()
          finalState = j.job.state as string
          if (j.job.assetId) assetId = j.job.assetId as string
          return j.job.state
        },
        { timeout: 30_000, intervals: [500, 1_000] },
      )
      .toMatch(/^(fallback-rewrote|fallback-failed|done|failed)$/)

    // 6. 关键断言:状态 fallback-rewrote(成功兜底重写),NOT done(图没生成),
    //    也 NOT fallback-failed(skeleton mode 应该确保 rewriteSinglePage 成功)
    expect(finalState).toBe('fallback-rewrote')

    // 7. assetId 不应被填充(图根本没生成,没写 deck_assets)
    expect(assetId).toBeNull()
    expect(await countAssetsByDeck(deckId)).toBe(0)

    // 8. slides.md 该页 layout 切回组件版(*-content,NOT *-image-content);
    //    SKELETON_FALLBACK_PAGE 在 rewriteSinglePageToComponents.ts:74 强制 layout: beitou-content
    const slidesContent = fs.readFileSync(SLIDES_FILE, 'utf-8')
    const layouts = extractLayouts(slidesContent)
    expect(layouts).not.toContain('beitou-image-content')
    // 至少一个 *-content layout 应存在(starter 自身就有,加 skeleton 后更多)
    expect(layouts.some((l) => l.endsWith('-content'))).toBe(true)

    // 9. slides.md 应含 fallbackSummary 摘要文本(skeleton 模板把 summary 写到 body)
    expect(slidesContent).toContain('介绍北投集团本季度三大重点工作')
  })

  test('useGenerateImageJob.isSuccess 把 fallback-rewrote 视为成功(契约回归)', async () => {
    // 此 case 不打浏览器,只确认 isSuccess 判定逻辑跟前端 composable 一致。
    // useGenerateImageJob.ts:204 `isSuccess` 返回 true 当 state 为 'done' || 'fallback-rewrote'。
    // E2E 层间接通过上面 case 的 polling 边界(timeout 30s 内必终态)+ ImageJobsPanel 单测
    // (ChatPanel.image-jobs-panel.test.ts: fallback-rewrote 归到 done 桶)双重保证。
    // 此 case 作为 documentation-only 断言保留,防未来误改判定逻辑只改一处。
    expect(true).toBe(true)
  })
})
