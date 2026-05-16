/** Phase 12.7 commit 3f33d76:Settings 应用按钮 + 跨 tab 持久化 E2E。 */
import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

async function registerAndLogin(page: import('@playwright/test').Page): Promise<string> {
  const email = `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
  return email
}

async function createDeck(page: import('@playwright/test').Page, title: string): Promise<number> {
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('标题').fill(title)
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
  return Number(page.url().match(/\/decks\/(\d+)/)![1])
}

test('一次打开 Settings 跨 LLM + 生图 两 tab 配完 + 关闭后重开验持久化', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page, 'Settings 应用按钮 E2E')

  // 1) 进 Settings(齿轮按钮 aria-label=「设置」)
  // 等首次 GET /api/auth/llm-settings 完成再交互,避免 mount 触发的 loadSettings()
  // 还没收到 response 就被用户的 fill() 抢跑(loadSettings 后置 reset 把 input 清空)。
  const initialGetPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/auth/llm-settings') &&
      resp.request().method() === 'GET',
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: /^设置$/ }).click()
  await initialGetPromise
  await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })

  // 默认 active=zhipu(empty 状态),把 zhipu API Key 填入然后点「应用」
  // 注:默认 LLM tab 已渲染,zhipu 作为 active 卡片在置顶,data-test=apikey-zhipu 可直查
  const zhipuKeyInput = page.locator('[data-test="apikey-zhipu"]')
  await expect(zhipuKeyInput).toBeVisible({ timeout: 5_000 })
  await zhipuKeyInput.fill('sk-fake-zhipu-for-e2e')
  await expect(zhipuKeyInput).toHaveValue('sk-fake-zhipu-for-e2e')

  // 点「应用」(LLM tab footer 第 2 按钮,data-test=apply-button)
  // 等 PUT /api/auth/llm-settings 完成,确保 saveLlm 已 await api.put + hasApiKey 升级完
  const llmPutPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/auth/llm-settings') &&
      resp.request().method() === 'PUT',
    { timeout: 10_000 },
  )
  await page.locator('[data-test="apply-button"]').click()
  const llmPutResp = await llmPutPromise
  expect(llmPutResp.status()).toBe(200)

  // 2) 断言:modal 仍开 + ✓ 已应用 flash 出现
  await expect(page.locator('.applied-flash')).toBeVisible({ timeout: 3_000 })
  await expect(page.locator('.applied-flash')).toContainText('已应用')
  // modal 仍渲染(save-button 仍可见 = footer 没消失)
  await expect(page.locator('[data-test="save-button"]')).toBeVisible()
  // PUT 成功后视图升级:zhipu active 卡片 .state-ok 出现
  await expect(
    page.locator('[data-provider-id="zhipu"].active .state-ok'),
  ).toBeVisible({ timeout: 3_000 })

  // 3) Flash 2s 后自动消失(animation 收尾后 v-if=false 移除节点)
  await expect(page.locator('.applied-flash')).not.toBeVisible({ timeout: 5_000 })

  // 4) 切到 生图模型 tab
  await page.getByRole('tab', { name: /生图模型/ }).click()
  // image tab 加载 GET → 显示 provider=openai
  await expect(page.locator('select').filter({ hasText: 'OpenAI' }).first()).toBeVisible({
    timeout: 5_000,
  })

  // 5) 填 OpenAI Image API Key + 点「应用」
  // image tab 没有 data-test,按 footer 内文案锚定。先填唯一 .input-group__input
  // 注:image 设置的 GET 是 mount 时调一次,这里直接填(切 tab 不重新 GET)
  const imageKeyInput = page.locator('.input-group__input')
  await imageKeyInput.fill('sk-fake-openai-image-for-e2e')
  await expect(imageKeyInput).toHaveValue('sk-fake-openai-image-for-e2e')

  const imagePutPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/image-llm-settings') &&
      resp.request().method() === 'PUT',
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: /^应用$/ }).click()
  const imagePutResp = await imagePutPromise
  expect(imagePutResp.status()).toBe(200)

  // 6) 断言:modal 仍开 + flash 出现
  await expect(page.locator('.applied-flash')).toBeVisible({ timeout: 3_000 })
  await expect(page.locator('.applied-flash')).toContainText('已应用')
  await expect(page.getByRole('tab', { name: /生图模型/ })).toBeVisible()

  // 7) 切回 LLM tab 验数据保留(hasApiKey 视图升级 + input 清空)
  await page.getByRole('tab', { name: /^LLM$/ }).click()
  const zhipuActiveCard = page.locator('[data-provider-id="zhipu"].active')
  await expect(zhipuActiveCard).toBeVisible({ timeout: 3_000 })
  // 已配置徽章在 hasApiKey=true 时显示
  await expect(zhipuActiveCard.locator('.state-ok')).toBeVisible({ timeout: 3_000 })
  // apiKey input 清空(saveLlm 成功后清 input,占位符变成「留空表示不修改」)
  await expect(zhipuKeyInput).toHaveValue('')
  await expect(zhipuKeyInput).toHaveAttribute('placeholder', /留空表示不修改/)

  // 8) 点「保存并关闭」(LLM tab 上,虽然没新内容,API 走一遍验证 close)
  const lastPutPromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/auth/llm-settings') &&
      resp.request().method() === 'PUT',
    { timeout: 10_000 },
  )
  await page.locator('[data-test="save-button"]').click()
  await lastPutPromise
  await expect(page.locator('[data-test="save-button"]')).not.toBeVisible({ timeout: 5_000 })

  // 9) 重开 Settings 验持久化:zhipu hasApiKey=true + image hasApiKey=true
  await page.getByRole('button', { name: /^设置$/ }).click()
  await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })

  // LLM tab zhipu 仍是「已配置」徽章
  const zhipuCardReopen = page.locator('[data-provider-id="zhipu"].active')
  await expect(zhipuCardReopen.locator('.state-ok')).toBeVisible()

  // 切到 image tab 验 has stored key 的 hint
  await page.getByRole('tab', { name: /生图模型/ }).click()
  // image hasApiKey=true 时 section-hint 显「已保存(服务端加密)。如需更换请重新输入」
  await expect(page.getByText(/已保存.*服务端加密/)).toBeVisible({ timeout: 3_000 })
})
