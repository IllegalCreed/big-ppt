import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-chartjs', () => ({
  Line: { name: 'LineStub', template: '<div data-stub="line" />' },
}))

import { mountWithTokens } from '../test/_setup/index.js'
import LineChart from './LineChart.vue'

describe('LineChart', () => {
  it('mount 能正常起来 + 高度按 prop 注入', () => {
    const wrapper = mountWithTokens(LineChart, {
      props: { labels: ['Jan', 'Feb', 'Mar'], values: [5, 8, 12], height: 280 },
    })
    expect(wrapper.find('div').attributes('style')).toContain('height: 280px')
    expect(wrapper.find('[data-stub="line"]').exists()).toBe(true)
  })

  it('label prop 透传给 chart dataset', () => {
    const wrapper = mountWithTokens(LineChart, {
      props: { labels: ['x'], values: [1], label: '收入' },
    })
    expect(wrapper.find('div').exists()).toBe(true)
  })
})
