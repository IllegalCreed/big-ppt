/** Phase 12：activeProvider 在 Settings UI 切换后跨开关持久化 + provider 间状态独立。 */
import { test, expect, type Page } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  await truncateAllTables()
  await context.clearCookies()
})

test.afterAll(async () => {
  await disposeDb()
})

async function registerAndLogin(page: Page): Promise<void> {
  const email = `multi-llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })
}

async function createDeck(page: Page): Promise<void> {
  await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
}

async function openSettings(page: Page): Promise<void> {
  // 等 GET /api/auth/llm-settings 完成再交互,避免 loadSettings 后置 reset 抢跑用户输入。
  const initialGet = page.waitForResponse(
    (r) => r.url().includes('/api/auth/llm-settings') && r.request().method() === 'GET',
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: /^设置$/ }).click()
  await initialGet
  await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })
}

async function saveAndClose(page: Page): Promise<void> {
  const putPromise = page.waitForResponse(
    (r) => r.url().includes('/api/auth/llm-settings') && r.request().method() === 'PUT',
    { timeout: 10_000 },
  )
  await page.locator('[data-test="save-button"]').click()
  const resp = await putPromise
  expect(resp.status()).toBe(200)
  await expect(page.locator('[data-test="save-button"]')).toHaveCount(0, { timeout: 5_000 })
}

test('activeProvider 在 Settings UI 切换:智谱 → OpenAI → 智谱,跨开关持久化', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page)

  // ── 步骤 1:首次进 Settings,空状态。默认 activeProvider=null,UI 渲染 zhipu 作为兜底
  // ── 第一张 active 卡片(SettingsModal 内 activeProvider ?? 'zhipu')。
  await openSettings(page)

  // 默认 zhipu 在活跃位 → apikey-zhipu 直接可填
  const zhipuKey = page.locator('[data-test="apikey-zhipu"]')
  await expect(zhipuKey).toBeVisible({ timeout: 5_000 })
  await zhipuKey.fill('sk-fake-zhipu-multi-llm')

  // 把 openai 也配上:openai 在未配置区(默认 <details> 折叠),先展开未配置组再点「配置」
  await page.locator('[data-test="unconfigured-group"] > summary').click()
  await page.locator('[data-test="configure-openai"]').click()
  const openaiKey = page.locator('[data-test="apikey-openai"]')
  await expect(openaiKey).toBeVisible({ timeout: 3_000 })
  await openaiKey.fill('sk-fake-openai-multi-llm')

  // 切 activeProvider 到 openai(下拉 select)
  await page.locator('.active-provider-select').selectOption('openai')

  // 保存关闭
  await saveAndClose(page)

  // ── 步骤 2:重开 Settings 验持久化 ── active=openai + 两家都「已配置」徽章
  await openSettings(page)

  // active openai 卡片(.provider-config-card.active[data-provider-id=openai])
  const openaiActive = page.locator('[data-provider-id="openai"].active')
  await expect(openaiActive).toBeVisible({ timeout: 3_000 })
  await expect(openaiActive.locator('.state-ok')).toBeVisible()

  // active select 当前值是 openai
  await expect(page.locator('.active-provider-select')).toHaveValue('openai')

  // zhipu 不再是 active,而是落在「其他已配置」组内(也带 .state-ok)
  const zhipuCard = page.locator('[data-test="other-configured-group"] [data-provider-id="zhipu"]')
  await expect(zhipuCard).toBeVisible()
  await expect(zhipuCard.locator('.state-ok')).toBeVisible()

  // ── 步骤 3:再切回 zhipu active ── 用 set-active-zhipu 按钮(其他已配置区的)
  await page.locator('[data-test="set-active-zhipu"]').click()

  // 切完后 zhipu 应升到 active 卡片 + select 值变为 zhipu
  await expect(page.locator('.active-provider-select')).toHaveValue('zhipu')
  await expect(page.locator('[data-provider-id="zhipu"].active')).toBeVisible()
  await expect(page.locator('[data-provider-id="zhipu"].active .state-ok')).toBeVisible()

  // 保存关闭
  await saveAndClose(page)

  // ── 步骤 4:再重开验持久化 ── active=zhipu + openai 落在其他已配置区
  await openSettings(page)
  await expect(page.locator('.active-provider-select')).toHaveValue('zhipu')
  await expect(page.locator('[data-provider-id="zhipu"].active')).toBeVisible()
  await expect(page.locator('[data-provider-id="zhipu"].active .state-ok')).toBeVisible()

  // openai 现在在「其他已配置」组,也仍带 .state-ok
  const openaiCardOther = page.locator(
    '[data-test="other-configured-group"] [data-provider-id="openai"]',
  )
  await expect(openaiCardOther).toBeVisible()
  await expect(openaiCardOther.locator('.state-ok')).toBeVisible()
})

test('未配 active provider key 直接切换 active → 保存被拒,modal 不关', async ({ page }) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)

  // 不填任何 key 直接点保存
  await page.locator('[data-test="save-button"]').click()

  // save-error 出现(client-side validation)
  await expect(page.locator('[data-test="save-error"]')).toBeVisible({ timeout: 3_000 })
  // modal 仍开
  await expect(page.locator('[data-test="save-button"]')).toBeVisible()
})

test('未配置 provider 的 option 在 active-provider-select 里 disabled,无法直接选中', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  // 第一次:配 zhipu(active)
  await openSettings(page)
  await page.locator('[data-test="apikey-zhipu"]').fill('sk-fake-zhipu-only')
  await saveAndClose(page)

  // 重开:此时只有 zhipu 已配置,active-select 下其他 11 个 option 全 disabled
  await openSettings(page)
  await expect(page.locator('.active-provider-select')).toHaveValue('zhipu')

  // 直接断 openai option disabled(SettingsModal :disabled="!configuredProviderIds.includes(meta.id)")
  // option 文本含「（未配置）」也是判定线索
  const select = page.locator('.active-provider-select')
  const disabledMap = await select.evaluate((el) => {
    const out: Record<string, boolean> = {}
    for (const opt of Array.from((el as HTMLSelectElement).options)) {
      out[opt.value] = opt.disabled
    }
    return out
  })
  expect(disabledMap.zhipu).toBe(false)
  expect(disabledMap.openai).toBe(true)
  expect(disabledMap.anthropic).toBe(true)
  expect(disabledMap.gemini).toBe(true)
})
