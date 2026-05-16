/** Phase 11/12 era：chat sender 斜杠指令 E2E。/clear /help /undo /redo /log /retry 不打 LLM。 */
import { test, expect, type Page } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  await truncateAllTables()
  // 清浏览器 cookies(serial mode + truncate 配合下,旧 session cookie 残留可能让
  // 后续 register 走异常路径,虽然 backend 会覆写但 router 缓存的页面态会卡)
  await context.clearCookies()
})

test.afterAll(async () => {
  await disposeDb()
})

async function registerAndLogin(page: Page): Promise<void> {
  const email = `slash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
}

async function createDeckAndOpenChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
  // sender 可见
  await expect(page.locator('.sender-area textarea').first()).toBeVisible({ timeout: 10_000 })
}

/** 在 chat sender 输入指令并按 Enter（submitType=enter）。 */
async function submitSlash(page: Page, text: string): Promise<void> {
  const input = page.locator('.sender-area textarea').first()
  await input.click()
  await input.fill(text)
  await input.press('Enter')
}

/** assistant 气泡列表（@antdv-next/x XBubble placement=start）。 */
function aiBubbles(page: Page) {
  return page.locator('.message-list .antd-bubble-start')
}

test('/help 在 sender 直发 → 列出全部 6 指令', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  await submitSlash(page, '/help')

  // 等 assistant bubble 出现(local message,非 LLM 响应,立即到位)
  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 5_000 })
    .toBeGreaterThan(0)

  const helpText = await aiBubbles(page).first().textContent()
  for (const cmd of ['/clear', '/retry', '/undo', '/redo', '/log', '/help']) {
    expect(helpText ?? '').toContain(cmd)
  }
})

test('/clear 在 sender 直发 → 清空当前 chat + 留「对话已清空」', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  // 先发几条 local 消息(不打 LLM,通过 /help 注入)增加历史
  await submitSlash(page, '/help')
  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 5_000 })
    .toBeGreaterThan(0)

  // 然后 /clear → 历史清空,新增一条「对话已清空。」
  await submitSlash(page, '/clear')
  // 清空后只剩「对话已清空。」一条 assistant bubble
  await expect
    .poll(
      async () => {
        const texts = await aiBubbles(page).allTextContents()
        return texts.some((t) => t.includes('对话已清空'))
      },
      { timeout: 5_000 },
    )
    .toBe(true)

  // user 输入气泡也都清完(/help 跟 /clear 都不入 user message——是 local 指令,
  // 见 ChatPanel handleSubmit 走 slash.handleSlashSubmit 早返 true,不调 sendMessage)
  // 所以这里检查 chat 气泡总数应该恰好 1 条(就是「对话已清空。」)
  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 3_000 })
    .toBe(1)
})

test('/undo 在 sender 直发 → 调 /api/restore-slides 并显示错误反馈', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  // /undo 走 POST /api/restore-slides;新建 deck 还没修改过 slides,后端会返
  // success:false,UI 显「❌ 已到最早...」之类的消息。我们只验:
  //   1) API call 实际发出去了
  //   2) UI 有反馈气泡(无论 ✅ 还是 ❌ 都行)
  const restorePromise = page.waitForResponse(
    (r) => r.url().includes('/api/restore-slides') && r.request().method() === 'POST',
    { timeout: 10_000 },
  )
  await submitSlash(page, '/undo')
  await restorePromise

  // assistant 气泡出现(success 或 error 都会 appendLocalMessage)
  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 5_000 })
    .toBeGreaterThan(0)
  const lastText = (await aiBubbles(page).last().textContent()) ?? ''
  // 反馈消息前缀必含 ✅ 或 ❌(useSlashCommands.run 内统一格式)
  expect(/(✅|❌)/.test(lastText)).toBe(true)
})

test('/redo 在 sender 直发 → 调 /api/redo-slides', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  const redoPromise = page.waitForResponse(
    (r) => r.url().includes('/api/redo-slides') && r.request().method() === 'POST',
    { timeout: 10_000 },
  )
  await submitSlash(page, '/redo')
  await redoPromise

  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 5_000 })
    .toBeGreaterThan(0)
})

test('/log 在 sender 直发 → 调 GET /api/log/latest', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  const logPromise = page.waitForResponse(
    (r) => r.url().includes('/api/log/latest'),
    { timeout: 10_000 },
  )
  await submitSlash(page, '/log')
  await logPromise

  // 无论后端有无 session,UI 应该出现 assistant 气泡(empty 时显「还没有会话日志。」)
  await expect
    .poll(async () => await aiBubbles(page).count(), { timeout: 5_000 })
    .toBeGreaterThan(0)
})

test('/retry 在 sender 直发 + 无历史 user message → 显示提示「没有可重试的用户消息」', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  await submitSlash(page, '/retry')

  // retryLastUserMessage 在无 user history 时 appendLocalMessage('没有可重试的用户消息。')
  await expect
    .poll(async () => {
      const texts = await aiBubbles(page).allTextContents()
      return texts.some((t) => t.includes('没有可重试的用户消息'))
    }, { timeout: 5_000 })
    .toBe(true)
})

// 注：未知指令 /unknown 在 E2E 不易测——Suggestion popup 打开后 onKeyDown 拦截 Enter，
// 用户需 ESC 才能落到 handleSlashSubmit('/unknown')。该分支已在 useSlashCommands.test.ts
// 单测验证。

test('Suggestion popup：输入 /c 后弹出补全候选含 clear', async ({ page }) => {
  await registerAndLogin(page)
  await createDeckAndOpenChat(page)

  const input = page.locator('.sender-area textarea').first()
  await input.click()
  await input.fill('/c')

  // Suggestion 弹出 antd-suggestion-content + 浮层(antdv-next Cascader 把 popup
  // teleport 到 body)。候选项有 class .antd-suggestion-item,需匹配文本含 /clear。
  await expect(page.locator('.ant-cascader-menu-item, .antd-suggestion-item').first()).toBeVisible({
    timeout: 5_000,
  })
  // 至少一条候选包含 /clear 字面文本(label 在 Vue render h() 里包了 div + 两个 span)
  const candidateTexts = await page
    .locator('.ant-cascader-menu-item, .antd-suggestion-item')
    .allTextContents()
  expect(candidateTexts.some((t) => t.includes('/clear'))).toBe(true)
})
