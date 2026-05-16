/**
 * Phase 13 Task G:assets-quota E2E(无 LLM,纯 backend + UI 边界)。
 *
 * 覆盖:
 *  1. 单文件超 per-file 限 → 413 + UI error 可见
 *  2. 多个小文件累加超 per-user 限 → 413 quota-exceeded
 *  3. AssetManagerPanel 列表 + quota 条 + 删除流程 → quota 回落
 *
 * playwright.config 把 quota 收紧到:
 *   per-user = 50KB (LUMIDECK_QUOTA_PER_USER_BYTES=51200)
 *   per-file = 10KB (LUMIDECK_QUOTA_PER_FILE_BYTES=10240)
 * 这样验 413 不必真造 megabyte 字节。
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

/** 注册并登录,返 deckId(URL 抽取),状态在 page 内。 */
async function registerAndCreateDeck(page: import('@playwright/test').Page): Promise<void> {
  const email = `quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  await page.getByRole('button', { name: /新建 Deck|新建/ }).first().click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/\d+/, { timeout: 15_000 })
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
}

test.describe('assets-quota 边界', () => {
  test('上传超 per-file 限(10KB)→ 413 file-too-large + UI 红 chip', async ({ page }) => {
    await registerAndCreateDeck(page)

    // sender 区点 paperclip 触发隐藏 input;直接 setInputFiles 喂内存字节(11KB > 10KB 上限)
    const fileInput = page.locator('[data-testid="upload-button-input"]')
    await fileInput.setInputFiles({
      name: 'too-big.txt',
      mimeType: 'text/plain',
      // 11KB > per-file 10KB 上限
      buffer: Buffer.from('x'.repeat(11 * 1024), 'utf-8'),
    })

    // chip 应进 error 态;UploadProgress 渲染 .upload-chip-error
    const errorChip = page.locator('.upload-chip-error').first()
    await expect(errorChip).toBeVisible({ timeout: 10_000 })
    await expect(errorChip).toContainText(/单文件超过|10MB|超过/)
  })

  test('累加超 per-user 限(50KB)→ 413 quota-exceeded', async ({ page }) => {
    await registerAndCreateDeck(page)

    // 用直 backend POST,绕过 UI 一次一次点(更稳),共上传 6 个 9KB 文件:
    //   前 5 个累加 45KB ≤ 50KB,过;第 6 个再加 9KB = 54KB 超过 → 413
    const okSize = 9 * 1024 // 9KB
    const blob = Buffer.alloc(okSize, 65) // 'A' x 9KB

    const okStatuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await page.request.post('/api/uploads', {
        // Phase 9-D originCheck:写请求必须带 Origin(dev 允许 localhost 任意端口)
        headers: { Origin: 'http://localhost:3130' },
        multipart: {
          file: { name: `ok-${i}.txt`, mimeType: 'text/plain', buffer: blob },
        },
      })
      okStatuses.push(r.status())
    }
    expect(okStatuses).toEqual([200, 200, 200, 200, 200])

    // 第 6 个超 → 413
    const failRes = await page.request.post('/api/uploads', {
      headers: { Origin: 'http://localhost:3130' },
      multipart: {
        file: { name: 'overflow.txt', mimeType: 'text/plain', buffer: blob },
      },
    })
    expect(failRes.status()).toBe(413)
    const failBody = (await failRes.json()) as { error: { code: string; message: string } }
    expect(failBody.error.code).toBe('quota-exceeded')
    expect(failBody.error.message).toMatch(/已用|MB|清理/)
  })

  test('打开 AssetManagerPanel → 列表显示 + 删除 → quota 回落', async ({ page }) => {
    await registerAndCreateDeck(page)

    // 直 backend 传两个小文件
    const small = Buffer.from('hello-quota-test')
    for (const name of ['a.txt', 'b.txt']) {
      const r = await page.request.post('/api/uploads', {
        headers: { Origin: 'http://localhost:3130' },
        multipart: { file: { name, mimeType: 'text/plain', buffer: small } },
      })
      expect(r.status()).toBe(200)
    }

    // 点顶栏 「我的素材」 打开 modal
    await page.getByRole('button', { name: '我的素材' }).click()

    // 容量条出现 + 列表两行
    await expect(page.locator('[data-testid="quota-bar-fill"]')).toBeVisible({ timeout: 5_000 })
    const rows = page.locator('.asset-row')
    await expect(rows).toHaveCount(2, { timeout: 5_000 })

    // 记录初始已用字节(从 .quota-label 文本拿,模糊匹配)
    const usedTextBefore = await page.locator('.quota-label').first().textContent()
    expect(usedTextBefore).toMatch(/已用/)

    // 删第一行:点 trash 触发确认 → 点「确认删除」
    await rows.first().locator('.icon-action').click()
    await rows.first().locator('button:has-text("确认删除")').click()

    // 列表回到 1 行
    await expect(page.locator('.asset-row')).toHaveCount(1, { timeout: 5_000 })

    // 容量条文本变化(已用减少)
    const usedTextAfter = await page.locator('.quota-label').first().textContent()
    expect(usedTextAfter).not.toBe(usedTextBefore)
  })
})
