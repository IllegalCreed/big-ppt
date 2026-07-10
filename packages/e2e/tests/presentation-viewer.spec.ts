import {
  expect,
  request as pwRequest,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { AGENT_BASE, disposeDb, truncateAllTables } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  await truncateAllTables()
  await context.clearCookies()
})

test.afterAll(async () => {
  await disposeDb()
})

const PRESENTATION_MARKDOWN = `---
theme: seriph
layout: beitou-cover
mainTitle: Phase 16
subtitle: PresentationViewer
---

<!-- 开场先说明新版放映不再依赖 Slidev。 -->

---
layout: beitou-content
heading: 第二页
---

## 内容

---
layout: beitou-back-cover
message: 谢谢观看
---
`

function createLongPresentationMarkdown(totalPages: number): string {
  const slides = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1
    const theme = index === 0 ? 'theme: seriph\n' : ''
    return `${theme}layout: beitou-content
heading: 第 ${page} 页
---

## 第 ${page} 页内容`
  })

  return `---\n${slides.join('\n---\n')}\n`
}

async function createUserAndDeck(label: string, initialContent = PRESENTATION_MARKDOWN) {
  const api = await pwRequest.newContext({
    baseURL: AGENT_BASE,
    extraHTTPHeaders: { Origin: AGENT_BASE },
  })
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  const register = await api.post('/api/auth/register', {
    data: { email, password: 'test1234' },
  })
  expect(register.status()).toBe(201)
  const created = await api.post('/api/decks', {
    data: { title: `${label} deck`, initialContent },
  })
  expect(created.status()).toBe(201)
  const { deck } = await created.json()
  return { api, deckId: deck.id as number, email }
}

test('多页总览保持 16:9 且在独立容器内滚动', async (
  { page, context, baseURL },
  testInfo,
) => {
  const owner = await createUserAndDeck('long-overview', createLongPresentationMarkdown(28))
  await installSession(context, owner.api, baseURL!)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/decks/${owner.deckId}/present`)
  await expectViewerReady(page)

  await page.getByRole('button', { name: '幻灯片总览' }).click()
  await expect(page.getByRole('dialog', { name: '幻灯片总览' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.overview-grid')
    const thumbnail = document.querySelector<HTMLElement>('.thumbnail')
    const canvas = document.querySelector<HTMLElement>('.thumbnail-canvas')
    const number = document.querySelector<HTMLElement>('.thumbnail-number')
    if (!grid || !thumbnail || !canvas || !number) throw new Error('总览缩略图未渲染')

    const thumbnailRect = thumbnail.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const numberRect = number.getBoundingClientRect()
    const visibleCanvasHeight = Math.max(
      0,
      Math.min(canvasRect.bottom, thumbnailRect.bottom) -
        Math.max(canvasRect.top, thumbnailRect.top),
    )

    return {
      gridClientHeight: grid.clientHeight,
      gridScrollHeight: grid.scrollHeight,
      thumbnailHeight: thumbnailRect.height,
      canvasHeight: canvasRect.height,
      canvasAspectRatio: canvasRect.width / canvasRect.height,
      visibleCanvasHeight,
      numberHeight: numberRect.height,
    }
  })

  expect(metrics.canvasAspectRatio).toBeCloseTo(16 / 9, 2)
  expect(metrics.visibleCanvasHeight).toBeCloseTo(metrics.canvasHeight, 0)
  expect(metrics.thumbnailHeight).toBeGreaterThanOrEqual(
    metrics.canvasHeight + metrics.numberHeight,
  )
  expect(metrics.gridScrollHeight).toBeGreaterThan(metrics.gridClientHeight)

  await page.screenshot({ path: testInfo.outputPath('long-overview.png'), fullPage: true })
  const lastSlide = page.getByRole('button', { name: '跳转到第 28 页' })
  await lastSlide.scrollIntoViewIfNeeded()
  await expect(lastSlide).toBeVisible()
  await lastSlide.click()
  await expect(page.getByText('28 / 28')).toBeVisible()

  await owner.api.dispose()
})

async function installSession(
  context: BrowserContext,
  api: Awaited<ReturnType<typeof pwRequest.newContext>>,
  baseURL: string,
) {
  const state = await api.storageState()
  const session = state.cookies.find((cookie) => cookie.name === 'lumideck_session')
  expect(session).toBeTruthy()
  await context.addCookies([{ name: 'lumideck_session', value: session!.value, url: baseURL }])
}

async function expectViewerReady(page: Page): Promise<void> {
  await expect(page.locator('[data-presentation-viewer]')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.slide-canvas').first()).toBeVisible({ timeout: 10_000 })
}

test('双屏放映自动分配演讲者与观众窗口，并由演讲者同步翻页/黑屏/画笔', async ({
  page,
  context,
  baseURL,
}) => {
  const owner = await createUserAndDeck('presenter')
  await installSession(context, owner.api, baseURL!)
  await page.goto(`/decks/${owner.deckId}`)
  await expect(page.getByRole('button', { name: '双屏放映', exact: true })).toBeVisible({
    timeout: 15_000,
  })

  const audiencePromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: '双屏放映', exact: true }).click()
  const audience = await audiencePromise
  await expect(page.locator('[data-presenter-mode]')).toBeVisible({ timeout: 15_000 })
  await expectViewerReady(audience)
  expect(context.pages()).toHaveLength(2)

  const presenterUrl = new URL(page.url())
  const audienceUrl = new URL(audience.url())
  expect(presenterUrl.searchParams.get('view')).toBe('presenter')
  expect(audienceUrl.searchParams.get('view')).toBeNull()
  expect(presenterUrl.searchParams.get('channel')).toBe(audienceUrl.searchParams.get('channel'))
  await expect(page).toHaveTitle(/演讲者视图/)
  await expect(audience).toHaveTitle(/观众窗口/)
  await expect(page.getByText('开场先说明新版放映不再依赖 Slidev。')).toBeVisible()

  await page.getByRole('button', { name: '打开观众窗口' }).click()
  await expect.poll(() => context.pages().length).toBe(2)

  await page.getByRole('button', { name: '下一页' }).click()
  await expect(audience.getByText('2 / 3')).toBeVisible()

  await audience.getByRole('button', { name: '幻灯片总览' }).click()
  await expect(audience.getByRole('dialog', { name: '幻灯片总览' })).toBeVisible()
  await audience.getByRole('button', { name: '关闭总览' }).click()

  await audience.getByRole('button', { name: '浅色界面' }).click()
  await expect(audience.locator('[data-presentation-viewer]')).toHaveClass(/ui-theme-light/)
  await expect(audience.locator('.slide-canvas').first()).toBeVisible()
  await expect(audience.locator('.blackout')).toHaveCount(0)
  await audience.getByRole('button', { name: '深色界面' }).click()
  await expect(audience.locator('[data-presentation-viewer]')).toHaveClass(/ui-theme-dark/)

  await page.keyboard.press('b')
  await expect(audience.locator('.blackout.black')).toBeVisible()
  await page.keyboard.press('b')
  await expect(audience.locator('.blackout')).toHaveCount(0)

  await page.getByRole('button', { name: '画笔', exact: true }).click()
  const layer = page.locator('.current-stage [data-drawing-layer]')
  const box = await layer.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.6, { steps: 5 })
  await page.mouse.up()
  await expect(audience.locator('.slide-shell polyline')).toHaveCount(1)

  await page.getByRole('button', { name: '橡皮擦' }).click()
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.45)
  await expect(audience.locator('.slide-shell polyline')).toHaveCount(0)

  await owner.api.dispose()
})

test('分享 modal 创建链接 → 无 Cookie 公开访问 → 撤销后显示准确状态', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const owner = await createUserAndDeck('share')
  await installSession(context, owner.api, baseURL!)
  await page.goto(`/decks/${owner.deckId}`)
  await expect(page.getByRole('button', { name: '分享', exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '分享', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /分享 share deck/ })).toBeVisible()
  await page.getByRole('button', { name: /创建链接/ }).click()

  const linkInput = page.getByRole('textbox', { name: '分享链接' })
  await expect(linkInput).toBeVisible()
  const shareUrl = await linkInput.inputValue()
  expect(shareUrl).toMatch(/\/share\/[A-Za-z0-9_-]+$/)

  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()
  await publicPage.goto(shareUrl)
  await expectViewerReady(publicPage)
  expect(
    (await publicContext.cookies()).find((cookie) => cookie.name === 'lumideck_session'),
  ).toBeUndefined()

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: /撤销/ }).click()
  await expect(page.getByText('已撤销')).toBeVisible()
  await publicPage.reload()
  await expect(publicPage.locator('[data-error-code="revoked"]')).toBeVisible()
  await expect(publicPage.getByText('这个分享链接已被撤销')).toBeVisible()

  await publicContext.close()
  await owner.api.dispose()
})

test('两个用户可同时放映各自 deck，整个流程不请求锁 API', async ({ browser, baseURL }) => {
  const a = await createUserAndDeck('parallel-a')
  const b = await createUserAndDeck('parallel-b')
  const aContext = await browser.newContext()
  const bContext = await browser.newContext()
  await installSession(aContext, a.api, baseURL!)
  await installSession(bContext, b.api, baseURL!)
  const aPage = await aContext.newPage()
  const bPage = await bContext.newPage()
  const lockRequests: string[] = []
  for (const target of [aPage, bPage]) {
    target.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (
        /^\/api\/present\//.test(pathname) ||
        ['/api/lock-status', '/api/heartbeat', '/api/release-deck'].includes(pathname)
      ) {
        lockRequests.push(request.url())
      }
    })
  }

  await Promise.all([
    aPage.goto(`/decks/${a.deckId}/present`),
    bPage.goto(`/decks/${b.deckId}/present`),
  ])
  await Promise.all([expectViewerReady(aPage), expectViewerReady(bPage)])
  expect(lockRequests).toEqual([])

  await aContext.close()
  await bContext.close()
  await a.api.dispose()
  await b.api.dispose()
})

test('移动端放映工具栏可横向访问且页面无布局溢出', async ({ page, context, baseURL }, testInfo) => {
  const owner = await createUserAndDeck('mobile-present')
  await installSession(context, owner.api, baseURL!)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/decks/${owner.deckId}/present`)
  await expectViewerReady(page)
  await page.getByRole('button', { name: '浅色界面' }).click()
  await expect(page.locator('[data-presentation-viewer]')).toHaveClass(/ui-theme-light/)
  await expect(page.locator('.slide-canvas').first()).toBeVisible()
  await expect(page.locator('.blackout')).toHaveCount(0)

  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.viewer-toolbar')
    const actions = document.querySelector<HTMLElement>('.toolbar-group:last-child')
    const stage = document.querySelector<HTMLElement>('.viewer-stage')
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
      stageTop: stage?.getBoundingClientRect().top ?? 0,
      actionsOverflowX: actions ? getComputedStyle(actions).overflowX : '',
      actionsClientWidth: actions?.clientWidth ?? 0,
      actionsScrollWidth: actions?.scrollWidth ?? 0,
    }
  })
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  expect(metrics.toolbarHeight).toBe(48)
  expect(metrics.stageTop).toBeGreaterThanOrEqual(metrics.toolbarHeight)
  expect(metrics.actionsOverflowX).toBe('auto')
  expect(metrics.actionsScrollWidth).toBeGreaterThan(metrics.actionsClientWidth)

  await page.screenshot({ path: testInfo.outputPath('mobile-presentation.png'), fullPage: true })
  await owner.api.dispose()
})
