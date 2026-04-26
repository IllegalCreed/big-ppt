/**
 * Phase 9-C（A03 防御）：SlidePreview iframe 必须带 sandbox 属性。
 *
 * 走 fs grep 路径（不渲染组件）：sandbox 属性是组件 template 静态部分，
 * 静态字符串断言更可靠 + 不依赖 useSlideStore / fetch mock。
 *
 * 守卫的是"未来某次重构时不慎把 sandbox 删了"——必须红测试 fail。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SLIDE_PREVIEW = path.resolve(__dirname, '../src/components/SlidePreview.vue')

describe('SlidePreview iframe sandbox（A03 防御）', () => {
  it('iframe 必须带 sandbox 属性', () => {
    const src = fs.readFileSync(SLIDE_PREVIEW, 'utf-8')
    expect(src).toMatch(/<iframe[\s\S]*?sandbox=/)
  })

  it('sandbox 必须包含 allow-same-origin（contentWindow.location.hash 翻页需要）', () => {
    const src = fs.readFileSync(SLIDE_PREVIEW, 'utf-8')
    expect(src).toMatch(/sandbox="[^"]*allow-same-origin/)
  })

  it('sandbox 必须包含 allow-scripts（Slidev/Vite/Vue 必需）', () => {
    const src = fs.readFileSync(SLIDE_PREVIEW, 'utf-8')
    expect(src).toMatch(/sandbox="[^"]*allow-scripts/)
  })

  it('sandbox 必须不允许 allow-top-navigation（防 iframe 跳走 parent）', () => {
    const src = fs.readFileSync(SLIDE_PREVIEW, 'utf-8')
    const match = src.match(/sandbox="([^"]+)"/)
    expect(match?.[1]).toBeTruthy()
    expect(match![1]).not.toContain('allow-top-navigation')
  })
})
