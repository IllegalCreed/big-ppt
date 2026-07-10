import { describe, it, expect, vi } from 'vitest'
import { createApp, h } from 'vue'
import { registerDeckRendererComponents } from './register-layouts'

describe('registerDeckRendererComponents', () => {
  it('注册全部 layout + 公共组件 26 个到 app', () => {
    const app = createApp({ render: () => h('div') })
    registerDeckRendererComponents(app)
    // 12 layouts (kebab) + 14 公共组件 (PascalCase) = 26
    const names = [
      'beitou-cover',
      'beitou-content',
      'beitou-toc',
      'beitou-section-title',
      'beitou-back-cover',
      'beitou-image-content',
      'jingyeda-cover',
      'jingyeda-content',
      'jingyeda-toc',
      'jingyeda-section-title',
      'jingyeda-back-cover',
      'jingyeda-image-content',
      'EqualSplit',
      'OneVsThree',
      'TwoColumnsTwoRows',
      'SixGrid',
      'NineGrid',
      'ImageText',
      'PetalFour',
      'ProcessFlow',
      'MetricCard',
      'Table',
      'Quote',
      'BarChart',
      'LineChart',
      'PieChart',
    ]
    for (const name of names) {
      expect(app.component(name)).toBeDefined()
    }
  })

  it('同一 app 重复调用时保持幂等', () => {
    const app = createApp({ render: () => h('div') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      registerDeckRendererComponents(app)
      registerDeckRendererComponents(app)

      expect(warn).not.toHaveBeenCalled()
      expect(app.component('beitou-cover')).toBeDefined()
      expect(app.component('BarChart')).toBeDefined()
    } finally {
      warn.mockRestore()
    }
  })
})
