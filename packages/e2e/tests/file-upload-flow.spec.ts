/**
 * Phase 13 Task G:file-upload-flow E2E happy path(真打 GLM)。
 *
 * 覆盖完整链路:
 *   注册 + 登录 → 创建 deck → 进 Settings 配 GLM key →
 *   点 paperclip 触发隐藏 file input → 上传一个 deterministic .md →
 *   等 chip ✓ 出现 + 轮询 GET /api/uploads 直到 extractStatus='done' →
 *   chat 发提示 → 等 turn.end →
 *   断言 assistant 气泡含 .md 内容的某个 deterministic token(LLM 实际读到了文件)
 *
 * 真打路径环境变量:`GLM_TEST_KEY` 注入测试用智谱 GLM API Key。
 *   GLM_TEST_KEY=<key> pnpm -F @big-ppt/e2e test file-upload-flow
 * env 未设时整 describe 走 test.skip 跳过(CI / 平时本地都不烧 token)。
 *
 * 选 .md 不选 .pdf 的理由:
 *   - parsers/text.ts 解析简单零依赖,fixture deterministic 字节
 *   - playwright.config 收紧的 per-file 10KB limit 足够装短 .md
 *   - 同样覆盖「upload → extractor enqueue → status=done → tool 读到」全链路
 *
 * 为什么不用 fixture 文件 + setInputFiles 路径:`page.setInputFiles` 接 buffer
 * 选项可以直接喂内存字节,fixture 文件入仓库浪费空间。
 */
import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

const GLM_TEST_KEY = process.env.GLM_TEST_KEY

/** 文件内容里的 deterministic token,assistant 回复必须能命中。 */
const FILE_TOKEN = 'PhaseThirteenSecretToken2026'
const MD_CONTENT = [
  '# Lumideck Phase 13 测试文档',
  '',
  '这是一个用于 E2E 测试的最小 markdown 文档。',
  '关键词:' + FILE_TOKEN,
  '',
  '## 目标',
  '验证文件上传 → 抽取 → LLM 引用全链路。',
  '',
].join('\n')

test.describe('file-upload-flow 真打 happy path(需要 GLM_TEST_KEY)', () => {
  test.skip(
    !GLM_TEST_KEY,
    'GLM_TEST_KEY env not set; skipping real file-upload-flow smoke (set GLM_TEST_KEY=... pnpm -F @big-ppt/e2e test file-upload-flow)',
  )

  test('注册 → 建 deck → 配 GLM key → 上传 .md → 等 done → chat 引用 → 断言 token', async ({ page }) => {
    // 1. 注册 + 自动登录
    const email = `file-upload-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 2. 建 deck(模板 picker 默认)
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 3. 配 GLM key
    await page.getByRole('button', { name: /^设置$/ }).click()
    await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })
    const zhipuKey = page.locator('[data-test="apikey-zhipu"]')
    await expect(zhipuKey).toBeVisible({ timeout: 5_000 })
    await zhipuKey.fill(GLM_TEST_KEY!)
    await page.locator('[data-test="save-button"]').click()
    await expect(page.locator('[data-test="save-button"]')).toHaveCount(0, { timeout: 5_000 })

    // 4. 上传 .md 文件,走 sender 区 paperclip 的隐藏 input
    //    UploadButton 是 `<input type="file" hidden data-testid="upload-button-input">`
    const fileInput = page.locator('[data-testid="upload-button-input"]')
    await fileInput.setInputFiles({
      name: 'phase13-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(MD_CONTENT, 'utf-8'),
    })

    // 5. 等 chip ✓ 出现(2s 内变 done 后会被 ChatPanel 自动 fade,但出现期 ≥ 短瞬可断)
    //    用 expect.poll 等任何「✓」chip 短暂存在过
    //    注:chip 出现到 fade 之间窗口最快约 ~1-3s(上传 + 渲染),poll interval 200ms
    const doneChip = page.locator('.upload-chip-done')
    await expect.poll(async () => await doneChip.count(), { timeout: 15_000 }).toBeGreaterThan(0)

    // 6. 轮询 GET /api/uploads,等 extractor worker 跑完(status=done)
    //    extractor 同进程 queue,text/markdown 解析 < 1s,留 30s buffer 容忍 CI / load
    await expect
      .poll(
        async () => {
          const res = await page.request.get('/api/uploads')
          if (!res.ok()) return 'not-ok'
          const body = (await res.json()) as {
            assets: Array<{ filename: string; extractStatus: string }>
          }
          const our = body.assets.find((a) => a.filename === 'phase13-notes.md')
          return our?.extractStatus ?? 'missing'
        },
        { timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe('done')

    // 7. 发提示让 LLM 读这个文件
    //    用 list_uploaded_files → read_uploaded_file 工具链;提示明确要求引用文件内 token
    const senderInput = page.locator('.sender-area textarea').first()
    await expect(senderInput).toBeVisible({ timeout: 5_000 })
    await senderInput.fill(
      '我刚上传了一个 markdown 文件,请用 list_uploaded_files 和 read_uploaded_file 工具读它的内容,然后告诉我文件里的关键词(以「关键词:」开头的那行)是什么。',
    )

    await page.locator('.sender-area .ant-btn-primary').first().click()

    // 8. 等 turn 结束(status-bar 消失)— GLM 通常 5-15s,留 90s buffer 容忍 2 轮 tool call
    await expect(page.locator('.status-bar')).toHaveCount(0, { timeout: 90_000 })

    // 9. assistant 气泡含 deterministic token
    const aiBubbles = page.locator('.message-list .antd-bubble-start')
    await expect
      .poll(async () => await aiBubbles.count(), { timeout: 10_000 })
      .toBeGreaterThan(0)
    const aiText = (await aiBubbles.allTextContents()).join('\n')
    expect(aiText).toContain(FILE_TOKEN)
  })
})
