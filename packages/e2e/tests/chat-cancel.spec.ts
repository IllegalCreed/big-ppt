/**
 * Chat 取消 mid-turn E2E(需要真 GLM_TEST_KEY env)。
 *
 * 验收:
 * - 真打 GLM:发短提示 → status='sending'/'streaming' → status-bar 可见
 * - 点「取消」按钮 → frontend AbortController.abort() → backend agent.abort()
 * - 验:status 回 'idle'(不是 'error')+ status-bar 消失
 * - 验:slot 释放 — 下一轮 sendMessage 不被卡住(Chat input 可再次发送)
 *
 * 跟 chat-turn-happy-path.spec.ts 同套路 gate `GLM_TEST_KEY` env:
 *   GLM_TEST_KEY=<key> pnpm -F @big-ppt/e2e test chat-cancel
 * env 未设时 skip 跳过(CI 默认 + 本地非 GLM 测试者无影响)。
 *
 * 不通过 backend stub:agent 没暴露 chat-turn 的 fake-stream 模式(无 BIG_PPT_TEST_CHAT_MODE),
 * 单测路径已在 packages/agent/test/integration/chat-turn.test.ts 端到端验 abort 信号反向
 * 传播到 agent.abort();本 spec 验前后端真正接起来的 UI 链路是否畅通。
 */
import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb, AGENT_BASE } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

const GLM_TEST_KEY = process.env.GLM_TEST_KEY

test.describe('chat cancel mid-turn(需要 GLM_TEST_KEY)', () => {
  test.skip(
    !GLM_TEST_KEY,
    'GLM_TEST_KEY env not set; skipping real chat-cancel smoke (set GLM_TEST_KEY=... pnpm -F @big-ppt/e2e test chat-cancel)',
  )

  // healthz 验 e2e agent 跑着(防误判 chat 取消未生效)
  test.beforeAll(async ({ request }) => {
    const r = await request.get(`${AGENT_BASE}/healthz`)
    expect(r.ok()).toBe(true)
  })

  test('发消息 → status-bar 显示 → 点取消 → status 回 idle + 再发可用', async ({ page }) => {
    // 注册 + 自动登录
    const email = `chat-cancel-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 创建 deck
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 进 Settings 配 GLM key(默认 zhipu provider)
    await page.getByRole('button', { name: /^设置$/ }).click()
    await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })
    const zhipuKey = page.locator('[data-test="apikey-zhipu"]')
    await expect(zhipuKey).toBeVisible({ timeout: 5_000 })
    await zhipuKey.fill(GLM_TEST_KEY!)
    await page.locator('[data-test="save-button"]').click()
    await expect(page.locator('[data-test="save-button"]')).toHaveCount(0, { timeout: 5_000 })

    // 第一轮:发消息 + 立刻取消
    const senderInput = page.locator('.sender-area textarea').first()
    await expect(senderInput).toBeVisible({ timeout: 5_000 })
    // 让 GLM 多写点(增加 streaming 窗口便于 cancel 时还在 streaming 状态)
    await senderInput.fill('请写一篇 300 字的关于人工智能的文章。')
    await page.locator('.sender-area .ant-btn-primary').first().click()

    // status-bar 出现(sending 或 streaming)
    const statusBar = page.locator('.status-bar')
    await expect(statusBar).toBeVisible({ timeout: 5_000 })

    // 「取消」按钮可见
    const cancelBtn = statusBar.locator('button.cancel-btn')
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 })
    await expect(cancelBtn).toContainText('取消')

    // 点取消 → AbortController.abort() → agent.abort() → status 回 idle
    await cancelBtn.click()

    // status-bar 消失(status === 'idle' 且 !isGenerating)
    // 注:cancel 触发 AbortError 走 status='idle',不是 'error'(useAIChat.ts:341-343)
    await expect(statusBar).toHaveCount(0, { timeout: 10_000 })

    // 确认 .status-bar.status-bar-error 不出现(cancel 是 silent 不计错)
    await expect(page.locator('.status-bar.status-bar-error')).toHaveCount(0)

    // 第二轮:slot 已释放,可再次发消息(slot leak 时 sender 输入框可能仍 disabled 或
    // 发送按钮无响应)
    await senderInput.fill('简短回答 hi 即可。')
    // 发送按钮可点击(slot 已释)
    const sendBtn = page.locator('.sender-area .ant-btn-primary').first()
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 })
    await sendBtn.click()

    // 第二轮也出现 status-bar
    await expect(statusBar).toBeVisible({ timeout: 5_000 })

    // 不等完整结束(留给 happy path),只验「再次发送」链路通。
    // 给 GLM 时间真返一帧再做下个 case 不污染,等 turn 完(超时容忍中转抖动)
    await expect(statusBar).toHaveCount(0, { timeout: 60_000 })
  })
})
