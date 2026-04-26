import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import MetricCard from './MetricCard.vue'

describe('MetricCard', () => {
  it('value + unit + label 渲染齐全', () => {
    const wrapper = mountWithTokens(MetricCard, {
      props: { value: 89, unit: '%', label: '客户留存率' },
    })
    expect(wrapper.find('.ld-metric-number').text()).toBe('89')
    expect(wrapper.find('.ld-metric-unit').text()).toBe('%')
    expect(wrapper.find('.ld-metric-label').text()).toBe('客户留存率')
  })

  it('无 unit 时 unit 区不渲染', () => {
    const wrapper = mountWithTokens(MetricCard, {
      props: { value: '+23%', label: 'QoQ' },
    })
    expect(wrapper.find('.ld-metric-unit').exists()).toBe(false)
  })

  it('variant 三档分别落到 data-variant 属性（fill / subtle / outline）', () => {
    const fill = mountWithTokens(MetricCard, {
      props: { value: 1, label: 'X', variant: 'fill' },
    })
    expect(fill.find('.ld-metric-card').attributes('data-variant')).toBe('fill')

    const subtle = mountWithTokens(MetricCard, {
      props: { value: 1, label: 'X', variant: 'subtle' },
    })
    expect(subtle.find('.ld-metric-card').attributes('data-variant')).toBe('subtle')

    const outline = mountWithTokens(MetricCard, {
      props: { value: 1, label: 'X', variant: 'outline' },
    })
    expect(outline.find('.ld-metric-card').attributes('data-variant')).toBe('outline')
  })
})
