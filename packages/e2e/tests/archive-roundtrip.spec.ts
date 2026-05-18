/**
 * Phase 15 Task 31-E:.lumideck round-trip E2E。
 *
 * 关键闭环验证:export → 删原 deck → import → 验导入的 deck 可见 + 编辑器可打开。
 *
 * 流程:
 * 1. 注册 + 登录 + 创建 deck(beitou-standard,5 页 starter)
 * 2. 编辑器点「导出」 → modal 选 lumideck → confirm → 等下载 → save 到 /tmp
 * 3. 返 deck 列表 → 点删除按钮(`.card-action.danger`) + accept dialog
 * 4. 等列表刷新(原 deck 卡片消失)
 * 5. 点「导入」 → setInputFiles tmp 路径
 * 6. 等 router.push 到 `/decks/<新 id>`(URL regex 验)
 * 7. 断编辑器加载完 + deck title 含「(导入)」后缀(backend 自动加,见
 *    `packages/agent/src/routes/decks-archive.ts` line 175)
 *
 * 设计抉择:
 * - **tmp file 保存路径**:用 `download.saveAs('/tmp/lumideck-roundtrip-<rand>.lumideck')`,
 *   playwright 默认 download 会进临时目录(test 结束清理),手动 saveAs 让 setInputFiles
 *   能拿到确定路径;`os.tmpdir()` 拼 nanoid 防并行干扰
 * - **删原 deck 不强求,验导入 deck 出现就够**:plan 描述「删原 deck」是为了证明
 *   import 不依赖原 deck;实际只需验列表里出现「<原 title>(导入)」就够。但为了
 *   防 list page sticky / 缓存,仍按 plan 走删除步骤
 * - **不验首页内容渲染**:plan 标「可选」,size + URL 跳转已说明 import 成功;
 *   验首页内容需等 DeckRenderer 完整 mount(可能慢),不是 round-trip 核心契约
 */
import { test, expect } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('round-trip:create → export → delete → import → 新 deck 出现 + 可打开编辑器', async ({
  page,
}) => {
  const stamp = Date.now()
  const email = `roundtrip-${stamp}@test.com`
  const deckTitle = `roundtrip-deck-${stamp}`
  // 用 timestamp + Math.random 防并行 / 同一 worker 多 retry 文件名冲突
  const tmpPath = join(
    tmpdir(),
    `lumideck-roundtrip-${stamp}-${Math.random().toString(36).slice(2, 8)}.lumideck`,
  )

  // ── Step 1:注册 + 自动登录 ─────────────────────────────────────
  await page.goto('/register')
  await page.locator('input[type="email"]').fill(email)
  const pwInputs = page.locator('input[type="password"]')
  await pwInputs.nth(0).fill('test1234')
  await pwInputs.nth(1).fill('test1234')
  await page.getByRole('button', { name: /^注册/ }).click()
  await expect(page).toHaveURL(/\/decks(\?.*)?$/, { timeout: 10_000 })

  // ── Step 2:创建 deck ──────────────────────────────────────────
  await page.getByRole('button', { name: /新建 Deck/ }).click()
  await expect(page.locator('[data-template-card]').first()).toBeVisible({ timeout: 10_000 })
  await page.locator('[data-template-card]').first().click()
  await page.getByLabel('标题').fill(deckTitle)
  await page.getByRole('button', { name: /^创建$/ }).click()
  await expect(page).toHaveURL(/\/decks\/(\d+)$/, { timeout: 15_000 })
  const origDeckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })

  // ── Step 3:编辑器点导出 → modal 选 lumideck → confirm → 等下载 → saveAs tmp ──
  const exportBtn = page.getByRole('button', { name: '导出', exact: true })
  await expect(exportBtn).toBeVisible({ timeout: 10_000 })
  await exportBtn.click()
  await expect(page.locator('.modal-overlay').last()).toBeVisible({ timeout: 5_000 })

  const lumideckRadio = page.locator('[data-test="format-lumideck"]')
  await lumideckRadio.check()
  await expect(lumideckRadio).toBeChecked()

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
  await page.locator('[data-test="confirm-button"]').click()
  const download = await downloadPromise
  await download.saveAs(tmpPath)

  // sanity:文件确实落盘 + 是 zip
  const { statSync, readFileSync, existsSync, unlinkSync } = await import('node:fs')
  expect(existsSync(tmpPath)).toBe(true)
  const buf = readFileSync(tmpPath)
  expect(buf.length).toBeGreaterThan(100)
  expect(buf[0]).toBe(0x50)
  expect(buf[1]).toBe(0x4b)

  // ── Step 4:返列表 + 删原 deck ─────────────────────────────────
  await page.goto('/decks')
  await expect(page.getByText(deckTitle, { exact: true })).toBeVisible({ timeout: 10_000 })

  // accept 删除 confirm dialog
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.accept()
  })
  const origCard = page.locator('.deck-card', { hasText: deckTitle }).first()
  await origCard.locator('button.card-action.danger').click()

  // 原 deck 卡片从 UI 消失
  await expect(page.getByText(deckTitle, { exact: true })).toHaveCount(0, { timeout: 10_000 })

  // ── Step 5:点导入 → setInputFiles tmp 路径 ────────────────────
  const importBtn = page.locator('[data-test="import-button"]')
  await expect(importBtn).toBeVisible({ timeout: 5_000 })
  // setInputFiles 不需要先 click(直接给隐藏 input 喂文件就触发 change 事件)
  await page.locator('[data-test="import-file-input"]').setInputFiles(tmpPath)

  // ── Step 6:等 router.push 到 `/decks/<新 id>` ─────────────────
  await page.waitForURL(/\/decks\/\d+/, { timeout: 15_000 })
  const newDeckId = Number(page.url().match(/\/decks\/(\d+)/)![1])
  // 新 deck id 不等于原 deck id(后端 insert 拿到新 PK)
  expect(newDeckId).not.toBe(origDeckId)

  // ── Step 7:编辑器加载完 + title 含「(导入)」后缀 ──────────────
  // 编辑器 deck-title 或 deck-title-input 显示导入后的标题(<原 title>(导入))
  await expect(page.locator('.deck-title, .deck-title-input').first()).toBeVisible({
    timeout: 15_000,
  })
  // 通过页面任意位置查「<原 title>(导入)」字串(deck-title element 自身或 banner)
  await expect(
    page.getByText(new RegExp(`${deckTitle}.*\\(导入\\)`)).first(),
  ).toBeVisible({ timeout: 10_000 })

  // 清理 tmp 文件(测试结束 OS 也会清,但显式删更干净)
  try {
    unlinkSync(tmpPath)
  } catch {
    /* ignore */
  }
})
