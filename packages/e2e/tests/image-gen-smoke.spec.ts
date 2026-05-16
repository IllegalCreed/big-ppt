/**
 * Phase 11.5 / 11.6 / 12.7：generate_slide_image 真打 OpenAI smoke。
 *
 * 全链路验:
 *   注册 + 登录 → 建 deck → 配 OpenAI image-llm-settings(API key + baseUrl)
 *   → 调 /api/call-tool generate_slide_image → 后台 worker 真打 OpenAI
 *   → 写 deck_assets BLOB + updateSlide → 标 done(或 fallback-rewrote 也算成功)
 *   → 验 DB.deck_assets + slides.md frontmatter + GET /api/assets 200 image/png
 *
 * Gate: 未设 OPENAI_IMAGE_TEST_KEY 跳过(防 CI / 平时本地烧 OpenAI 配额)。
 * 真打容忍中转抖动:test timeout 180s,polling interval 2s,fallback-rewrote 也算 pass。
 *
 * # 跑法 (需真 OpenAI key)
 *   OPENAI_IMAGE_TEST_KEY=sk-... pnpm -F @big-ppt/e2e test image-gen-smoke
 *   # baseUrl 默认走 duckcoding 中转;可显式 OPENAI_IMAGE_TEST_BASE_URL=... 覆盖
 *   # 不设 env 自动跳过
 *
 * playwright.config.ts 的 BIG_PPT_TEST_IMAGE_MODE 在 OPENAI_IMAGE_TEST_KEY 设置时自动
 * unset(走真 OpenAI 而非 stub);本 spec 假设该机制生效,起 webServer 时已是真路径。
 */
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  AGENT_BASE,
  truncateAllTables,
  disposeDb,
  getCurrentVersionContent,
  countAssetsByDeck,
  listAssetsByDeckSql,
  extractLayouts,
} from './helpers/db'

test.describe.configure({ mode: 'serial' })

const OPENAI_IMAGE_TEST_KEY = process.env.OPENAI_IMAGE_TEST_KEY
const OPENAI_IMAGE_TEST_BASE_URL =
  process.env.OPENAI_IMAGE_TEST_BASE_URL ?? 'https://www.duckcoding.ai/v1'

const SLIDES_FILE = '/tmp/lumideck-e2e-slides.md'

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test.describe('generate_slide_image 真打 OpenAI smoke(需 OPENAI_IMAGE_TEST_KEY)', () => {
  test.skip(
    !OPENAI_IMAGE_TEST_KEY,
    'OPENAI_IMAGE_TEST_KEY env not set; skip real OpenAI image smoke (set OPENAI_IMAGE_TEST_KEY=... pnpm -F @big-ppt/e2e test image-gen-smoke)',
  )

  test('真打 OpenAI → deck_assets 写入 + slides.md imageSrc + GET /api/assets 200', async ({
    page,
  }) => {
    // 真 OpenAI gpt-5.5 reasoning + image gen + 中转,实测可能 2-3 分钟,留 300s buffer
    test.setTimeout(300_000)

    // 1. 注册 + 自动登录
    const email = `u-imgreal-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 2. 配生图模型(直走 API,UI 流程已被 SettingsModal 单测覆盖;
    //    PUT 字段:provider / apiKey / baseUrl,详见 image-llm-settings.ts)
    const settingsRes = await page.request.put(`${AGENT_BASE}/api/image-llm-settings`, {
      headers: { Origin: AGENT_BASE, 'content-type': 'application/json' },
      data: {
        provider: 'openai',
        apiKey: OPENAI_IMAGE_TEST_KEY,
        baseUrl: OPENAI_IMAGE_TEST_BASE_URL,
      },
    })
    expect(settingsRes.ok()).toBe(true)

    // 3. 走 picker 创 beitou deck(走第一个模板卡片即可,starter.md 至少 5 页)
    await page.getByRole('button', { name: /新建 Deck/ }).click()
    const cards = page.locator('[data-template-card]')
    await expect(cards).toHaveCount(2, { timeout: 10_000 })
    await cards.first().click()
    await page.getByLabel('标题').fill('image-gen smoke')
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
    const deckId = Number(page.url().match(/\/decks\/(\d+)/)![1])

    // 4. 等编辑器加载完
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 5. 调 /api/call-tool 触发 generate_slide_image。第 2 页是 starter 的内容页,
    //    用 X-Deck-Id 传 activeDeckId(Phase 10.5 后 middleware 由 header 覆写 ALS)。
    //    fallbackSummary 必填(Phase 11.6 dogfood 后),真打失败兜底输入。
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
          prompt: 'mars surface with rover tracks, expansive landscape view',
          fallbackSummary: '展示火星地表与探测车足迹的全景图,体现荒凉与探索主题',
        },
        turnId: `e2e-smoke-${Date.now()}`,
      },
    })
    expect(callRes.ok()).toBe(true)
    const callBody = await callRes.json()
    expect(callBody.success).toBe(true)
    // call-tool route wraps tool result in { result: <stringified JSON> };兼容两种 wrapper
    const inner =
      typeof callBody.result === 'string'
        ? JSON.parse(callBody.result)
        : (callBody.result ?? callBody)
    expect(inner.success).toBe(true)
    expect(inner.jobId).toMatch(/^[0-9a-f-]{36}$/)
    expect(inner.status).toBe('queued')

    // 6. 轮询 /api/image-jobs/:id 至终态。done / fallback-rewrote 都算成功(后者也
    //    会写 slides.md 切回组件版,但本测仅当 happy path 走通时才主断言 image-content
    //    layout + assetId,fallback 路径只断终态合理性)。
    const jobId: string = inner.jobId
    let terminalState: string | null = null
    let assetId: string | null = null
    let pollCount = 0
    await expect
      .poll(
        async () => {
          pollCount++
          const r = await page.request.get(`${AGENT_BASE}/api/image-jobs/${jobId}`)
          if (!r.ok()) return 'pending'
          const j = await r.json()
          // 每 10 次 poll 打一行,便于 e2e log 看 reasoning 进度 + 排查卡死
          if (pollCount === 1 || pollCount % 10 === 0) {
            console.log(
              `[smoke-poll ${pollCount}] state=${j.job.state} assetId=${j.job.assetId ?? '-'}`,
            )
          }
          if (
            j.job.state === 'done' ||
            j.job.state === 'fallback-rewrote' ||
            j.job.state === 'failed' ||
            j.job.state === 'fallback-failed'
          ) {
            terminalState = j.job.state
            if (j.job.assetId) assetId = j.job.assetId as string
          }
          return j.job.state
        },
        {
          // poll 间隔 2s,总 timeout 270s(留 30s buffer 给后续断言 + cleanup);
          // gpt-5.5 reasoning 模型一张图实测 1-3 分钟,中转再加 30s 抖动
          timeout: 270_000,
          intervals: [2_000],
        },
      )
      .toMatch(/^(done|fallback-rewrote|failed|fallback-failed)$/)

    expect(['done', 'fallback-rewrote']).toContain(terminalState)

    // 7. done 路径:验 DB + slides.md + GET /api/assets 200。
    //    fallback-rewrote 路径:不产 asset(图没生成),slides.md 切回组件版,放更宽松断言。
    if (terminalState === 'done') {
      expect(assetId).toMatch(/^[0-9a-f-]{36}$/)

      // DB:deck_assets 多一行
      expect(await countAssetsByDeck(deckId)).toBe(1)
      const assets = await listAssetsByDeckSql(deckId)
      expect(assets[0]?.mime_type).toBe('image/png')
      expect(assets[0]?.bytes_size).toBeGreaterThan(0)

      // slides.md:frontmatter 切到 image-content layout + imageSrc 引用 asset
      const slidesContent = fs.readFileSync(SLIDES_FILE, 'utf-8')
      expect(slidesContent).toContain('layout: beitou-image-content')
      expect(slidesContent).toContain(`/api/assets/${assetId}`)
      const layouts = extractLayouts(slidesContent)
      expect(layouts).toContain('beitou-image-content')

      // deck_versions:也应被 persist 持久化(currentVersion 已切到新 content)
      const dbContent = await getCurrentVersionContent(deckId)
      expect(dbContent).toContain('layout: beitou-image-content')
      expect(dbContent).toContain(`/api/assets/${assetId}`)

      // GET /api/assets/<id>:owner 200 + Content-Type image/(png|jpeg)
      const assetRes = await page.request.get(`${AGENT_BASE}/api/assets/${assetId}`)
      expect(assetRes.status()).toBe(200)
      const contentType = assetRes.headers()['content-type'] ?? ''
      expect(contentType).toMatch(/^image\/(png|jpeg)/)
      const buf = await assetRes.body()
      expect(buf.length).toBe(assets[0]!.bytes_size)
    } else {
      // fallback-rewrote:真打 OpenAI 仍可能因模型 quota / 中转限速失败 → 兜底重写
      //   slides.md 该页 layout 切回 *-content,不再有 *-image-content + imageSrc 引用
      //   asset 表为空(图没生成)
      //   该路径仍代表 graceful-degradation 成功(用户拿到了组件版内容,不是 *-image-content 空壳)
      const slidesContent = fs.readFileSync(SLIDES_FILE, 'utf-8')
      const layouts = extractLayouts(slidesContent)
      expect(layouts.filter((l) => l === 'beitou-image-content')).toEqual([])
    }
  })
})
