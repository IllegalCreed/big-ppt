/**
 * Phase 12 Task I：ChatPanel 折叠 thinking block + cache 提示渲染测试。
 *
 * 不真跑 useAIChat 状态机，直接 mock 出 chatMessages 含 thinking/cacheStats 的 bubble，
 * 验证 ThinkingBlock 默认折叠 / 点击展开、CacheStatsHint 渲染 token 数与节省比例。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ThinkingBlock from '../src/components/ThinkingBlock.vue'
import CacheStatsHint from '../src/components/CacheStatsHint.vue'

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

describe('CacheStatsHint', () => {
  it('渲染 cached 和 cost token 数', () => {
    const wrapper = mount(CacheStatsHint, { props: { cached: 1024, cost: 256 } })
    expect(wrapper.text()).toContain('本轮命中缓存 1024 tokens')
    expect(wrapper.text()).toContain('计费 256 tokens')
  })

  it('计算节省比例', () => {
    // 1024 / (1024 + 256) = 0.8 → 80%
    const wrapper = mount(CacheStatsHint, { props: { cached: 1024, cost: 256 } })
    expect(wrapper.text()).toContain('80%')
  })

  it('当 cached + cost = 0 时不显示节省比例（避免 NaN%）', () => {
    const wrapper = mount(CacheStatsHint, { props: { cached: 0, cost: 0 } })
    expect(wrapper.text()).toContain('本轮命中缓存 0 tokens')
    expect(wrapper.text()).not.toContain('节省')
  })

  it('全部命中 cache（cost=0）时显示 100%', () => {
    const wrapper = mount(CacheStatsHint, { props: { cached: 1000, cost: 0 } })
    expect(wrapper.text()).toContain('100%')
  })
})
