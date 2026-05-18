/**
 * Phase 13:vision input 真打 E2E(OpenAI gpt-5.5 + duckcoding 中转)。
 *
 * 覆盖原生多模态读图链路:
 *   注册 → 建 deck → PUT /api/auth/llm-settings 配 OpenAI(apiKey/model/baseUrl)
 *     → setInputFiles 喂 beitou thumbnail.png buffer → 等 chip + extractStatus
 *     → chat 让 agent 用 read_uploaded_file mode=image → 等 turn 结束
 *     → 断 assistant bubble 含图片专有 token(「北投」/「红」/「品牌」/「BIG」)
 *
 * Fixture 用仓库 git-tracked `packages/slidev/templates/beitou-standard/thumbnail.png`,
 * 每个 dev 都有,内容独特(BIG 红 logo + 北投集团字样 + 请填写标题标语),不依赖
 * gitignored `packages/e2e/files/`。
 *
 * 为什么 PUT 而非 UI Settings 配:
 *   - file-upload-flow.spec.ts (GLM gated) 走 UI Settings 配 zhipu 默认 active 一字段
 *     就行;但 openai 不是默认 active,UI 流要:点 configure-openai 展开 unconfigured
 *     form → 填 apiKey → Vue 自动把 openai 从 unconfigured 移到 other-configured 区
 *     (DOM 重新分类、原 input detach) → 在新区填 model+baseUrl → 点 set-active-openai
 *     → save。中间 detach 会让 Playwright 定位失败。PUT 一次性原子配完更稳。
 *   - 上传 + chat 仍走 UI(setInputFiles + sender submit + DOM 等 status-bar),
 *     保持跟 file-upload-flow 同一套 stable 模式。
 *
 * 跑法(env gated;无 key 跳):
 *   OPENAI_TEST_KEY=sk-... pnpm -F @big-ppt/e2e test file-upload-image-vision
 *
 * 时间预算:
 *   - gpt-5.5 是 reasoning(thinking)模型 + duckcoding 中转 + vision base64 input,
 *     2026-05-18 manual MCP dogfood 实测整轮 ~3 min。
 *   - 留 5 min wall-time(test.setTimeout(300_000)) + 240s status-bar wait,留够余量。
 *   - 比 file-upload-flow GLM 90s 严松一档,因为 vision + reasoning 比纯文本 GLM-flash 慢得多。
 *
 * model id 必须小写 `gpt-5.5`(pi-ai 0.74.0 MODELS 表);
 * baseURL 必含 `/v1`(OpenAI SDK 当 prefix 直接拼 `/chat/completions`);
 * duckcoding 中转走 `https://www.duckcoding.ai/v1`。
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { truncateAllTables, disposeDb, AGENT_BASE } from './helpers/db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 走 git-tracked 模板 thumbnail,任意 dev 都有。约 60KB,默认 quota 10KB 会撞 413,
// 所以本 spec 默认 quota 10KB → 命令行必须像 file-upload-real-docs 一样开 prod-like cap:
//   LUMIDECK_QUOTA_PER_FILE_BYTES=10485760 pnpm test file-upload-image-vision
const FIXTURE_PNG = path.resolve(
  __dirname,
  '../../slidev/templates/beitou-standard/thumbnail.png',
)
const FIXTURE_EXISTS = fs.existsSync(FIXTURE_PNG)
const PROD_LIKE_FILE_CAP =
  Number(process.env.LUMIDECK_QUOTA_PER_FILE_BYTES ?? 0) >= 1_048_576

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test.describe('Phase 13 vision input 真打(OPENAI_TEST_KEY gated)', () => {
  test.skip(
    !process.env.OPENAI_TEST_KEY,
    'OPENAI_TEST_KEY env 未设;跳 vision 真打。本地: OPENAI_TEST_KEY=sk-... LUMIDECK_QUOTA_PER_FILE_BYTES=10485760 pnpm -F @big-ppt/e2e test file-upload-image-vision',
  )
  test.skip(
    !FIXTURE_EXISTS,
    `fixture 缺(${FIXTURE_PNG}),应该是 git-tracked 模板 thumbnail`,
  )
  test.skip(
    !PROD_LIKE_FILE_CAP,
    'LUMIDECK_QUOTA_PER_FILE_BYTES env 未设或 < 1MB;thumbnail 60KB 撞默认 10KB cap。命令: LUMIDECK_QUOTA_PER_FILE_BYTES=10485760 LUMIDECK_QUOTA_PER_USER_BYTES=104857600 pnpm test file-upload-image-vision',
  )

  test('上传北投 thumbnail PNG → agent 走 read_uploaded_file mode=image → assistant 回复含图中专有 token', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    // 1. 注册 + 自动登录到 /decks
    const email = `vision-${Date.now()}@test.lumideck.local`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pws = page.locator('input[type="password"]')
    await pws.nth(0).fill('test1234')
    await pws.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 2. 拿 session cookie 给后续 PUT/GET 用
    const cookies = await page.context().cookies()
    const session = cookies.find((c) => c.name === 'lumideck_session')
    if (!session) throw new Error('lumideck_session cookie 没拿到')
    const cookieHeader = `${session.name}=${session.value}`

    // 3. PUT 配 OpenAI(activeProvider=openai + duckcoding baseURL + gpt-5.5)
    //    跟 manual MCP dogfood 同一份配置(2026-05-18 已验)
    const openaiKey = process.env.OPENAI_TEST_KEY!
    const llmRes = await page.request.put(`${AGENT_BASE}/api/auth/llm-settings`, {
      headers: {
        Cookie: cookieHeader,
        Origin: 'http://localhost:3030',
        'Content-Type': 'application/json',
      },
      data: {
        activeProvider: 'openai',
        providers: {
          openai: {
            apiKey: openaiKey,
            model: 'gpt-5.5',
            baseUrl: 'https://www.duckcoding.ai/v1',
          },
        },
      },
    })
    expect(llmRes.status(), 'PUT /api/auth/llm-settings').toBe(200)

    // 4. 建 deck(默认模板 picker)
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })

    // 5. setInputFiles 把 git-tracked thumbnail.png buffer 喂进 sender 区的隐藏 file input
    //    UploadButton 是 `<input type="file" hidden data-testid="upload-button-input">`
    const buffer = fs.readFileSync(FIXTURE_PNG)
    await page.locator('[data-testid="upload-button-input"]').setInputFiles({
      name: 'beitou-thumbnail.png',
      mimeType: 'image/png',
      buffer,
    })

    // 6. 等 chip ✓ 出现(上传完触发 done chip)
    const doneChip = page.locator('.upload-chip-done')
    await expect.poll(async () => await doneChip.count(), { timeout: 15_000 }).toBeGreaterThan(0)

    // 7. 轮询 GET /api/uploads 等 extractor 跳过 image(图片不抽文本,直接 done/skipped)
    //    image/* 走 skipped 路径(parsers/index.ts),没有 worker 实际跑,基本 0s 内 final
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${AGENT_BASE}/api/uploads`, {
            headers: { Cookie: cookieHeader },
          })
          const body = (await res.json()) as {
            assets: Array<{ filename: string; extractStatus: string }>
          }
          const our = body.assets.find((a) => a.filename === 'beitou-thumbnail.png')
          return our?.extractStatus ?? 'missing'
        },
        { timeout: 15_000, intervals: [300, 500, 1000] },
      )
      .toMatch(/^(done|skipped)$/)

    // 8. 发提示让 agent 用 read_uploaded_file mode=image 看图描述
    //    明确「不要做 PPT,只回答」防 system prompt Point 5 anti-pattern 误触发起图工具
    const sender = page.locator('.sender-area textarea').first()
    await expect(sender).toBeVisible({ timeout: 5_000 })
    await sender.fill(
      '请用 read_uploaded_file 以 mode=\'image\' 读取我刚上传的 beitou-thumbnail.png,然后用一段话描述图中你看到的文字内容、颜色、品牌元素。不要做 PPT,只回答。',
    )
    await page.locator('.sender-area .ant-btn-primary').first().click()

    // 9. 等 status-bar 消失(turn 结束)。gpt-5.5 thinking + vision 真打 ~2-3 min,留 240s
    await expect(page.locator('.status-bar')).toHaveCount(0, { timeout: 240_000 })

    // 10. assistant bubble 含图片专有 token(「北投」/「红」/「品牌」/「BIG」/「Beijing」)
    //     2026-05-18 manual MCP 实测 gpt-5.5 回复:"北投品牌感:整体以深红色...北投体系统一品牌形象",
    //     5 个 token 至少命中 1 个(若命中 0 个说明 LLM 实际没看图或描错了图)
    const aiBubbles = page.locator('.message-list .antd-bubble-start')
    await expect.poll(async () => await aiBubbles.count(), { timeout: 10_000 }).toBeGreaterThan(0)
    const aiText = (await aiBubbles.allTextContents()).join('\n')
    expect(aiText, 'assistant 应描述出图中专有 token').toMatch(/北投|红|品牌|BIG|Beijing/)
  })
})
