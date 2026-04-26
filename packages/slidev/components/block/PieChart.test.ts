import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-chartjs', () => ({
  Pie: { name: 'PieStub', template: '<div data-stub="pie" />' },
}))

import { mountWithTokens } from '../../test/_setup/index.js'
import PieChart from './PieChart.vue'

describe('PieChart', () => {
  it('mount 能正常起来 + 高度按 prop 注入', () => {
    const wrapper = mountWithTokens(PieChart, {
      props: {
        labels: ['Chrome', 'Safari', 'Firefox', 'Edge'],
        values: [62, 18, 8, 12],
        height: 300,
      },
    })
    expect(wrapper.find('div').attributes('style')).toContain('height: 300px')
    expect(wrapper.find('[data-stub="pie"]').exists()).toBe(true)
  })

  it('未提供 height 时 fallback 340px', () => {
    const wrapper = mountWithTokens(PieChart, {
      props: { labels: ['A'], values: [1] },
    })
    expect(wrapper.find('div').attributes('style')).toContain('height: 340px')
  })
})
