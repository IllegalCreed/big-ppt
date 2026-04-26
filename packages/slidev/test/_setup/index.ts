/**
 * Phase 7.5C 公共组件单测助手。
 *
 * 提供 mountWithTokens：在测试环境给挂载点注入 `--ld-*` 测试值，让公共组件
 * 通过 getComputedStyle 读到稳定值。jsdom 默认对 CSS 自定义属性的 cascade
 * 解析不完整，组件内 `getComputedStyle(el).getPropertyValue('--ld-*')` 在
 * jsdom 下返回 ''；本 helper 直接给挂载根的 inline style 写死，组件能稳定取到。
 */
import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import type { Component } from 'vue'

/** 默认 token 测试值，仅用于断言"组件读到了 token 而不是 hardcode" */
export const DEFAULT_TEST_TOKENS: Record<string, string> = {
  '--ld-color-brand-primary': '#ff0000',
  '--ld-color-brand-primary-deep': '#cc0000',
  '--ld-color-brand-accent': '#00ff00',
  '--ld-color-fg-primary': '#222222',
  '--ld-color-fg-muted': '#888888',
  '--ld-color-bg-page': '#ffffff',
  '--ld-color-bg-subtle': '#f5f5f5',
  '--ld-color-chart-primary-bg': 'rgba(255, 0, 0, 0.85)',
  '--ld-color-chart-primary-border': '#cc0000',
  '--ld-font-family-brand': 'TestBrandFont, sans-serif',
  '--ld-font-family-ui': 'TestUiFont, sans-serif',
  '--ld-font-size-h1': '40px',
  '--ld-font-size-h2': '26px',
  '--ld-font-size-body': '20px',
  '--ld-font-weight-bold': '700',
  '--ld-font-weight-regular': '400',
  '--ld-radius-sm': '4px',
  '--ld-radius-md': '8px',
  '--ld-border-width-thin': '1px',
  '--ld-border-width-thick': '2px',
  '--ld-shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.08)',
  '--ld-shadow-md': '0 4px 12px rgba(0, 0, 0, 0.12)',
}

/**
 * 挂载组件 + 给 attachTo 容器注入 `--ld-*` token；可选覆盖部分 token 验证响应。
 */
export function mountWithTokens<C extends Component>(
  component: C,
  options: ComponentMountingOptions<C> = {},
  tokenOverrides: Record<string, string> = {},
) {
  const tokens = { ...DEFAULT_TEST_TOKENS, ...tokenOverrides }
  const host = document.createElement('div')
  for (const [name, value] of Object.entries(tokens)) {
    host.style.setProperty(name, value)
  }
  document.body.appendChild(host)
  return mount(component, {
    attachTo: host,
    ...options,
  })
}
