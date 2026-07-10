/**
 * Phase 10.5 Task 25-E-1：DeckRenderer 视觉回归 baseline。
 *
 * 12 个 case = 2 模板 × 6 layout（cover/toc/section-title/content/image-content/back-cover）。
 * 每个 case 走 /_visual/:template/:layout 临时路由（仅 DEV 模式挂载），固定
 * 960×540 渲染单页 layout，再 toHaveScreenshot 比对基线。
 *
 * 基线生成：`pnpm -F @big-ppt/e2e test visual.spec.ts --update-snapshots`
 * 日常守门：`pnpm -F @big-ppt/e2e test visual.spec.ts`
 *
 * 基线存放：packages/e2e/tests/visual.spec.ts-snapshots/ 目录（Playwright 默认）。
 * 跨机器字体差异会假阳性 → 本项目当前无 CI，基线就在你本地 macOS 上长期维护。
 */
import { test, expect } from '@playwright/test'

const TEMPLATES = ['beitou-standard', 'jingyeda-standard'] as const
const LAYOUTS = [
  'cover',
  'toc',
  'section-title',
  'content',
  'image-content',
  'back-cover',
] as const

test.describe('visual regression', () => {
  for (const template of TEMPLATES) {
    for (const layout of LAYOUTS) {
      test(`${template} - ${layout}`, async ({ page }) => {
        await page.goto(`/_visual/${template}/${layout}`)
        // 等 layout 渲染（slide-canvas 是 DeckRenderer 输出的最内层 wrap）
        const canvas = page.locator('.slide-canvas').first()
        await canvas.waitFor({ state: 'visible', timeout: 5_000 })
        // 让字体 / 图片完全加载再截图
        await page.waitForLoadState('networkidle')

        if (layout === 'image-content') {
          const image = canvas.getByRole('img', { name: '图文页' })
          await expect(image).toBeVisible()
          await expect(image).toHaveCSS('object-fit', 'contain')
          expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
        }

        await expect(canvas).toHaveScreenshot(`${template}-${layout}.png`)
      })
    }
  }
})
