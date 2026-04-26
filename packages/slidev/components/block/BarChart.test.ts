import { describe, expect, it, vi } from 'vitest'

// Mock vue-chartjs：jsdom 没原生 canvas，chart.js 实例化会崩；只测组件外壳行为。
vi.mock('vue-chartjs', () => ({
  Bar: { name: 'BarStub', template: '<div data-stub="bar" />' },
}))

import { mountWithTokens } from '../../test/_setup/index.js'
import BarChart from './BarChart.vue'

describe('BarChart', () => {
  it('mount 能正常起来 + 高度按 prop 注入', () => {
    const wrapper = mountWithTokens(BarChart, {
      props: { labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 30], height: 200 },
    })
    const root = wrapper.find('div')
    expect(root.attributes('style')).toContain('height: 200px')
    expect(wrapper.find('[data-stub="bar"]').exists()).toBe(true)
  })

  it('未提供 height 时 fallback 340px', () => {
    const wrapper = mountWithTokens(BarChart, {
      props: { labels: ['A'], values: [1] },
    })
    expect(wrapper.find('div').attributes('style')).toContain('height: 340px')
  })
})
