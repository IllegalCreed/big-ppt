/**
 * Phase 12 Task I（thinking 部分）+ Phase 12.5 Task D（UsageStatsHint 部分）：
 *
 * - ThinkingBlock：默认折叠 / 点击展开 / 再点收起 / chevron 旋转。
 * - UsageStatsHint：
 *   - cached > 0 时渲染缓存命中片段
 *   - cost.total > 0 时渲染 ¥ 成本（按 USD_TO_RMB=7.2 换算）
 *   - cacheRead > 0 时附加「缓存命中 ¥X」（已付价，不是节省额——code review fix）
 *   - usage=null / 全 0 时整条 hint 不渲染（visible computed 控制）
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkingBlock from '../src/components/ThinkingBlock.vue'
import UsageStatsHint from '../src/components/UsageStatsHint.vue'

describe('ThinkingBlock', () => {
  it('默认折叠，不渲染 text', () => {
    const wrapper = mount(ThinkingBlock, { props: { text: 'reasoning here' } })
    expect(wrapper.find('.thinking-toggle').exists()).toBe(true)
    expect(wrapper.find('.thinking-text').exists()).toBe(false)
    expect(wrapper.text()).toContain('思考过程')
    expect(wrapper.text()).not.toContain('reasoning here')
    // aria-expanded 初始为 false
    expect(wrapper.find('.thinking-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('点击 header 展开后渲染 text', async () => {
    const wrapper = mount(ThinkingBlock, { props: { text: 'reasoning here' } })
    await wrapper.find('.thinking-toggle').trigger('click')
    expect(wrapper.find('.thinking-text').exists()).toBe(true)
    expect(wrapper.find('.thinking-text').text()).toContain('reasoning here')
    expect(wrapper.find('.thinking-toggle').attributes('aria-expanded')).toBe('true')
  })

  it('再点一次折叠回去', async () => {
    const wrapper = mount(ThinkingBlock, { props: { text: 'reasoning here' } })
    await wrapper.find('.thinking-toggle').trigger('click')
    await wrapper.find('.thinking-toggle').trigger('click')
    expect(wrapper.find('.thinking-text').exists()).toBe(false)
    expect(wrapper.find('.thinking-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('expanded class 切换驱动 chevron 旋转', async () => {
    const wrapper = mount(ThinkingBlock, { props: { text: 't' } })
    expect(wrapper.find('.thinking-block').classes()).not.toContain('expanded')
    await wrapper.find('.thinking-toggle').trigger('click')
    expect(wrapper.find('.thinking-block').classes()).toContain('expanded')
  })
})

describe('UsageStatsHint', () => {
  it('cached > 0 时渲染缓存命中片段（自动 k 单位）', () => {
    const wrapper = mount(UsageStatsHint, {
      props: { usage: { input: 1280, output: 5, cached: 1024 } },
    })
    expect(wrapper.text()).toContain('缓存命中 1.0k tokens')
  })

  it('cost.total > 0 时按 USD_TO_RMB=7.2 渲染 ¥ 成本', () => {
    const wrapper = mount(UsageStatsHint, {
      props: {
        usage: {
          input: 100,
          output: 50,
          cost: { total: 0.001, input: 0.0007, output: 0.0003 },
        },
      },
    })
    // 0.001 USD × 7.2 = 0.0072 RMB；4 位小数显示
    expect(wrapper.text()).toContain('本轮 ¥0.0072')
    // 不应误导写「节省」（pi-ai cacheRead 是已付价不是节省）
    expect(wrapper.text()).not.toContain('节省')
    // 没 cacheRead 字段时也不显示缓存命中价
    expect(wrapper.text()).not.toContain('缓存命中 ¥')
  })

  it('cacheRead > 0 时附加「缓存命中 ¥X」（已付价，不是节省额）', () => {
    const wrapper = mount(UsageStatsHint, {
      props: {
        usage: {
          input: 100,
          output: 50,
          cached: 512,
          cost: {
            total: 0.002,
            input: 0.0014,
            output: 0.0006,
            cacheRead: 0.0001,
          },
        },
      },
    })
    expect(wrapper.text()).toContain('缓存命中 512 tokens')
    expect(wrapper.text()).toContain('本轮 ¥0.0144') // 0.002 × 7.2
    // pi-ai cacheRead 是缓存读取**已付**的钱（typical normal input rate 的 10%~25%）；
    // label「缓存命中 ¥X」而不是误导的「节省 ¥X」（code review fix）
    expect(wrapper.text()).toContain('缓存命中 ¥0.0007') // 0.0001 × 7.2 = 0.00072 → toFixed(4) = '0.0007'
    expect(wrapper.text()).not.toContain('节省')
  })

  it('usage=null 时整条 hint 不渲染', () => {
    const wrapper = mount(UsageStatsHint, { props: { usage: null } })
    expect(wrapper.find('.usage-stats-hint').exists()).toBe(false)
  })

  it('cached=0 且 cost.total=0 时不渲染（避免空 hint）', () => {
    const wrapper = mount(UsageStatsHint, {
      props: { usage: { input: 0, output: 0, cost: { total: 0, input: 0, output: 0 } } },
    })
    expect(wrapper.find('.usage-stats-hint').exists()).toBe(false)
  })

  it('仅 cached 有值（无 cost）也能渲染（向前兼容老 SSE 流）', () => {
    const wrapper = mount(UsageStatsHint, {
      props: { usage: { input: 100, output: 5, cached: 256 } },
    })
    expect(wrapper.find('.usage-stats-hint').exists()).toBe(true)
    expect(wrapper.text()).toContain('缓存命中 256 tokens')
    expect(wrapper.text()).not.toContain('本轮 ¥')
  })
})
