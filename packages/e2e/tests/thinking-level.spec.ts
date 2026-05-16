/** Phase 12.7：thinkingLevel 6 档 select 在 Settings UI 三域（anthropic/gemini/common）保存读出 + off 不入 payload。 */
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
  const email = `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
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
  const initialGet = page.waitForResponse(
    (r) => r.url().includes('/api/auth/llm-settings') && r.request().method() === 'GET',
    { timeout: 10_000 },
  )
  await page.getByRole('button', { name: /^设置$/ }).click()
  await initialGet
  await expect(page.locator('[data-test="save-button"]')).toBeVisible({ timeout: 5_000 })
}

/** 展开 Advanced 折叠区（幂等：advancedExpanded ref 跨 open/close 不重置，需检查 aria-expanded）。 */
async function ensureAdvancedExpanded(page: Page): Promise<void> {
  const toggle = page.locator('.advanced-toggle')
  const expanded = (await toggle.getAttribute('aria-expanded')) === 'true'
  if (!expanded) await toggle.click()
  await expect(page.locator('[data-test="advanced-panel"]')).toBeVisible({ timeout: 3_000 })
}

interface CapturedPut {
  payload: unknown
}

/** 点保存并截获 PUT payload + 等 modal 关闭(save-button DOM 移除)。 */
async function saveAndCapture(page: Page): Promise<CapturedPut> {
  let payload: unknown = null
  const putPromise = page.waitForResponse(
    async (r) => {
      if (r.url().includes('/api/auth/llm-settings') && r.request().method() === 'PUT') {
        try {
          payload = JSON.parse(r.request().postData() ?? '{}')
        } catch {
          payload = null
        }
        return true
      }
      return false
    },
    { timeout: 10_000 },
  )
  await page.locator('[data-test="save-button"]').click()
  const resp = await putPromise
  expect(resp.status()).toBe(200)
  // 等 modal 真关闭(v-if=open=false → DOM 移除),避免下一次 openSettings 抢跑
  await expect(page.locator('[data-test="save-button"]')).toHaveCount(0, { timeout: 5_000 })
  return { payload }
}

test('common.thinkingLevel=medium 保存 + 重开读出 + payload 含 advanced.common.thinkingLevel', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)

  // 默认 active=zhipu(empty 起始态),先填 zhipu key 让保存通过
  await page.locator('[data-test="apikey-zhipu"]').fill('sk-zhipu-thinking-level')

  // 展开 Advanced
  await ensureAdvancedExpanded(page)
  await expect(page.locator('[data-test="advanced-panel"]')).toBeVisible()

  // common thinking level 始终可见(全局默认),改 medium
  const commonLevel = page.locator('[data-test="adv-common-thinking-level"]')
  await expect(commonLevel).toBeVisible()
  await commonLevel.selectOption('medium')

  // 保存截获 payload
  const { payload } = await saveAndCapture(page)
  const advanced = (payload as { advanced?: { common?: { thinkingLevel?: string } } })?.advanced
  expect(advanced?.common?.thinkingLevel).toBe('medium')

  // 重开验持久化
  await openSettings(page)
  await ensureAdvancedExpanded(page)
  await expect(page.locator('[data-test="adv-common-thinking-level"]')).toHaveValue('medium')
})

test('anthropic.thinkingLevel=high(active=anthropic)→ 保存读出 + payload 仅含 anthropic 子区', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)

  // 展开未配置 details → 点配置展开 inline → 填 anthropic key → 切 active
  await page.locator('[data-test="unconfigured-group"] > summary').click()
  await page.locator('[data-test="configure-anthropic"]').click()
  await page.locator('[data-test="apikey-anthropic"]').fill('sk-ant-fake')
  await page.locator('.active-provider-select').selectOption('anthropic')

  // 展开 Advanced
  await ensureAdvancedExpanded(page)

  // active=anthropic → anthropic-advanced 子区可见
  await expect(page.locator('[data-test="anthropic-advanced"]')).toBeVisible()
  await expect(page.locator('[data-test="gemini-advanced"]')).toHaveCount(0)

  // 改 anthropic thinking level 到 high
  await page.locator('[data-test="adv-thinking-level"]').selectOption('high')

  // 保存截获 payload
  const { payload } = await saveAndCapture(page)
  const advanced = (payload as {
    advanced?: { anthropic?: { thinkingLevel?: string }; gemini?: unknown }
  })?.advanced
  expect(advanced?.anthropic?.thinkingLevel).toBe('high')
  // gemini 子区不应该入 payload(active != gemini 时)
  expect(advanced?.gemini).toBeUndefined()

  // 重开验持久化:active=anthropic + advanced 展开 + thinking level=high
  await openSettings(page)
  await expect(page.locator('.active-provider-select')).toHaveValue('anthropic')
  await ensureAdvancedExpanded(page)
  await expect(page.locator('[data-test="adv-thinking-level"]')).toHaveValue('high')
})

test('gemini.thinkingLevel=low(active=gemini)→ 保存读出 + payload 仅含 gemini 子区', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)

  // 配 gemini key + 切 active
  await page.locator('[data-test="unconfigured-group"] > summary').click()
  await page.locator('[data-test="configure-gemini"]').click()
  await page.locator('[data-test="apikey-gemini"]').fill('gem-fake')
  await page.locator('.active-provider-select').selectOption('gemini')

  await ensureAdvancedExpanded(page)

  // active=gemini → gemini-advanced 子区可见,anthropic-advanced 不在
  await expect(page.locator('[data-test="gemini-advanced"]')).toBeVisible()
  await expect(page.locator('[data-test="anthropic-advanced"]')).toHaveCount(0)

  // gemini 专有的 thinking level select(注意 data-test 是 adv-gemini-thinking-level,
  // 跟 anthropic 的 adv-thinking-level 区分)
  await page.locator('[data-test="adv-gemini-thinking-level"]').selectOption('low')

  const { payload } = await saveAndCapture(page)
  const advanced = (payload as {
    advanced?: { gemini?: { thinkingLevel?: string }; anthropic?: unknown }
  })?.advanced
  expect(advanced?.gemini?.thinkingLevel).toBe('low')
  expect(advanced?.anthropic).toBeUndefined()

  // 重开验持久化
  await openSettings(page)
  await expect(page.locator('.active-provider-select')).toHaveValue('gemini')
  await ensureAdvancedExpanded(page)
  await expect(page.locator('[data-test="adv-gemini-thinking-level"]')).toHaveValue('low')
})

test('thinkingLevel 全部保持 off → payload.advanced 不含任一 thinkingLevel 字段', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)

  // 配 zhipu key
  await page.locator('[data-test="apikey-zhipu"]').fill('sk-zhipu-off')

  // 展开 advanced 但不动 thinkingLevel selects(全默认 off)
  await ensureAdvancedExpanded(page)
  await expect(page.locator('[data-test="adv-common-thinking-level"]')).toHaveValue('off')

  const { payload } = await saveAndCapture(page)
  const advanced = (payload as {
    advanced?: {
      common?: { thinkingLevel?: string }
      anthropic?: { thinkingLevel?: string }
      gemini?: { thinkingLevel?: string }
    }
  })?.advanced
  // off 不入 payload(buildPayload 跳过 off);advanced 可能整对象不存在
  expect(advanced?.common?.thinkingLevel).toBeUndefined()
  expect(advanced?.anthropic?.thinkingLevel).toBeUndefined()
  expect(advanced?.gemini?.thinkingLevel).toBeUndefined()
})

test('thinking level select 选项含 6 档（off / minimal / low / medium / high / xhigh）', async ({
  page,
}) => {
  await registerAndLogin(page)
  await createDeck(page)

  await openSettings(page)
  await ensureAdvancedExpanded(page)

  // common 子区 6 档
  const optionsCommon = await page.locator('[data-test="adv-common-thinking-level"] option').evaluateAll(
    (opts) => (opts as HTMLOptionElement[]).map((o) => o.value),
  )
  expect(optionsCommon).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

  // 配 anthropic + 切 active 验 anthropic 6 档(同 enum)
  await page.locator('[data-test="unconfigured-group"] > summary').click()
  await page.locator('[data-test="configure-anthropic"]').click()
  await page.locator('[data-test="apikey-anthropic"]').fill('sk-ant-options')
  await page.locator('.active-provider-select').selectOption('anthropic')

  const optionsAnt = await page.locator('[data-test="adv-thinking-level"] option').evaluateAll(
    (opts) => (opts as HTMLOptionElement[]).map((o) => o.value),
  )
  expect(optionsAnt).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
})
