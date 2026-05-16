/**
 * Phase 12.7 Task F/G：chat-turn 端到端真打。
 *
 * 跑通 pi-agent-core 在 backend 接管 agent loop 之后的最小 happy path:
 *   注册 + 登录 → 创建 deck → 进 Settings 配 GLM key → 发消息 →
 *   等 turn.end → 验首条 assistant 气泡可见;
 * 并加 error-visibility 回归 case(commit c2e79de):
 *   未配 LLM key 时 backend 返 400 → frontend status='error' →
 *   红色 .status-bar-error 可见 + 提示 "请先在设置中配置 LLM API Key"。
 *
 * 真打路径用环境变量 `GLM_TEST_KEY` 注入测试用 GLM API Key。
 *   GLM_TEST_KEY=<key> pnpm -F @big-ppt/e2e test chat-turn
 * env 未设时 happy-path 走 test.skip 跳过(不阻塞 CI / 平时本地);
 * error-visibility case 不依赖真 key,任何 run 都跑。
 *
 * 不打 GPT / Anthropic 是因为:
 * - 智谱 GLM 在国内中转通道更稳,timeout 概率低
 * - 单一 provider 跑通就足够 catch backend agent loop /
 *   useAIChat consumer 的端到端集成回归(其他 provider 已被 unit/smoke 覆盖)
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

test.describe('chat-turn 真打 happy path（需要 GLM_TEST_KEY）', () => {
  test.skip(
    !GLM_TEST_KEY,
    'GLM_TEST_KEY env not set; skipping real chat-turn smoke (set GLM_TEST_KEY=... pnpm -F @big-ppt/e2e test chat-turn)',
  )

  test('注册 → 建 deck → 配 GLM key → 发短提示 → 等 assistant 气泡', async ({ page }) => {
    // 1. 注册 + 自动登录
    const email = `chat-turn-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 2. 创建 deck(picker 默认选第一套模板 + 默认标题)
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 3. 打开 Settings → LLM tab → 填 GLM key(默认 active provider 已是 zhipu)
    await page.getByRole('button', { name: /^设置$/ }).click()
    await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })
    // 默认在 LLM tab,zhipu 是默认 active provider → apikey-zhipu input 可直接定位
    const zhipuKey = page.locator('[data-test="apikey-zhipu"]')
    await expect(zhipuKey).toBeVisible({ timeout: 5_000 })
    await zhipuKey.fill(GLM_TEST_KEY!)

    // 4. 点「保存并关闭」(close modal)
    await page.locator('[data-test="save-button"]').click()
    // modal 关闭(save-button 不再可见)
    await expect(page.locator('[data-test="save-button"]')).toHaveCount(0, { timeout: 5_000 })

    // 5. 进 chat sender 输入框,发短提示
    //    Sender 是 @antdv-next/x 组件,内部 textarea + ArrowUp 主按钮(type=primary, shape=circle)
    const senderInput = page.locator('.sender-area textarea').first()
    await expect(senderInput).toBeVisible({ timeout: 5_000 })
    await senderInput.fill('你好,请用一句话简短回答。')

    // 主按钮(发送)在 sender 内部由 SendButton 渲染(ArrowUpOutlined icon)
    // 用 .ant-btn[type="button"].ant-btn-primary 在 sender-area 内定位
    await page.locator('.sender-area .ant-btn-primary').first().click()

    // 6. 状态栏出现「正在思考...」(sending)
    await expect(page.locator('.status-bar')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.status-text')).toContainText(/正在思考|正在调用/, {
      timeout: 5_000,
    })

    // 7. 等 turn.end → status idle → 状态栏隐藏
    //    GLM 在线响应一般 < 15s;真打留 60s buffer 容忍中转抖动
    await expect(page.locator('.status-bar')).toHaveCount(0, { timeout: 60_000 })

    // 8. assistant 气泡出现
    //    Bubble.List 用 @antdv-next/x 的 XBubble(prefixCls='antd-bubble' 默认),
    //    placement=start 给 ai role,placement=end 给 user。检查 message-list 内
    //    至少有一条非空 placement=start 气泡(LLM 至少回一个字)。
    //    用 expect.poll 避免立即抓取就 read 空字符串(LLM 流式入 chatMessages 在 turn.end 后)
    const aiBubbles = page.locator('.message-list .antd-bubble-start')
    await expect
      .poll(async () => await aiBubbles.count(), { timeout: 10_000 })
      .toBeGreaterThan(0)
    // 至少一条 assistant 文字非空。LLM 应答内容不能为空字符串,只要返一个字符就 OK
    const aiBubbleText = await aiBubbles.allTextContents()
    const hasAssistantResponse = aiBubbleText.some((t) => t.trim().length > 0)
    expect(hasAssistantResponse).toBe(true)
  })
})

test.describe('chat-turn error 可见性回归(commit c2e79de)', () => {
  test('未配 LLM key → backend 400 → status-bar-error 可见 + 重试按钮', async ({ page }) => {
    // 注册 + 登录,但 **不** 配 LLM key
    const email = `chat-turn-noerr-${Date.now()}@test.com`
    await page.goto('/register')
    await page.locator('input[type="email"]').fill(email)
    const pwInputs = page.locator('input[type="password"]')
    await pwInputs.nth(0).fill('test1234')
    await pwInputs.nth(1).fill('test1234')
    await page.getByRole('button', { name: /^注册/ }).click()
    await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

    // 直接建 deck(skip Settings 配 key 步骤)
    await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
    await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: /^创建$/ }).click()
    await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
    await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
      timeout: 15_000,
    })

    // 进 chat sender 直接发,不配 key
    const senderInput = page.locator('.sender-area textarea').first()
    await expect(senderInput).toBeVisible({ timeout: 5_000 })
    await senderInput.fill('测试错误显示')
    await page.locator('.sender-area .ant-btn-primary').first().click()

    // backend POST /api/chat/turn → 400 { error.message: "请先在设置中配置 LLM API Key" }
    // frontend useAIChat 把 error.message 写进 errorMessage,status='error',
    // ChatPanel v-if="isGenerating || status === 'error'" 展示带 .status-bar-error 的红条
    const errorBar = page.locator('.status-bar.status-bar-error')
    await expect(errorBar).toBeVisible({ timeout: 10_000 })

    // 文案包含 backend 的错误描述
    await expect(errorBar).toContainText(/请先在设置中配置 LLM API Key/)

    // 重试按钮出现(.cancel-btn 在 error 态下文案是「重试」,见 ChatPanel.vue)
    await expect(errorBar.locator('button')).toBeVisible()
    await expect(errorBar.locator('button')).toContainText(/重试/)
  })

  // 健康检查:确保 e2e webserver agent 跑着(否则后端 unreachable 错会被误判成 chat 错)
  test.beforeAll(async ({ request }) => {
    const r = await request.get(`${AGENT_BASE}/healthz`)
    expect(r.ok()).toBe(true)
  })
})
