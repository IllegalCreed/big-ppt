import { expect, test } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('新建 deck 选择 jingyeda-standard 走通全链路', async ({ page }) => {
  // 注册（与 happy-path 对齐：直接用 input[type] 选择器，RegisterPage 无 for/id 关联）
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(`u-${Date.now()}@test.com`)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()

  // 注册成功 → 跳到 /decks
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // 点"新建 Deck"
  await page.getByRole('button', { name: /新建 Deck/ }).click()

  // picker 弹窗出现，两套模板卡片可见（用 data-template-card 下的名称避免与右侧预览区重复匹配）
  const cards = page.locator('[data-template-card]')
  await expect(cards).toHaveCount(2, { timeout: 10_000 })
  await expect(cards.filter({ hasText: '北投集团汇报模板' })).toBeVisible()
  await expect(cards.filter({ hasText: '竞业达汇报模板' })).toBeVisible()

  // 缩略图：不仅 img 元素存在，还要真实加载成功（HTTP 200 + naturalWidth > 0）
  const thumbs = page.locator('[data-template-card] img')
  await expect(thumbs).toHaveCount(2, { timeout: 5_000 })

  // 断言 src 走 /api/templates/ 前缀（防 7C 把 /templates 漏 /api 前缀回归）
  const srcList = await thumbs.evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).map((i) => i.src),
  )
  for (const src of srcList) {
    expect(src).toMatch(/\/api\/templates\/(beitou|jingyeda)-standard\/thumbnail\.png$/)
  }

  // 断言图片 byte 真的回了：等所有 img 完成 + naturalWidth > 0（broken image 的 naturalWidth = 0）
  await expect
    .poll(
      async () =>
        thumbs.evaluateAll((imgs) =>
          (imgs as HTMLImageElement[]).every((i) => i.complete && i.naturalWidth > 0),
        ),
      { timeout: 8_000 },
    )
    .toBe(true)

  // 再做一次 HTTP HEAD/GET 验证后端确实返回 200 + image/* content-type
  for (const src of srcList) {
    const resp = await page.request.get(src)
    expect(resp.status(), `${src} should return 200`).toBe(200)
    expect(resp.headers()['content-type']).toMatch(/^image\//)
  }

  // 点 jingyeda 卡片 → 右侧预览描述随之更新（description 包含"商务科技风格"）
  await cards.filter({ hasText: '竞业达汇报模板' }).click()
  await expect(page.getByText(/商务科技风格/)).toBeVisible()

  // 填写标题（modal 内的 label[for=tpl-modal-title] 有 id 关联，可用 getByLabel）
  await page.getByLabel('标题').fill('我的竞业达 Deck')

  // 点"创建"（主按钮文案精确为"创建"；加载中会变"创建中..."，用 regex 锚定初始态）
  await page.getByRole('button', { name: /^创建$/ }).click()

  // 跳转到编辑器
  await expect(page).toHaveURL(/\/decks\/\d+$/, { timeout: 15_000 })

  // 编辑器顶栏标题可见
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('我的竞业达 Deck')).toBeVisible()
})
