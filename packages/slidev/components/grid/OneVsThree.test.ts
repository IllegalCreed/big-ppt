import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import OneVsThree from './OneVsThree.vue'

describe('OneVsThree', () => {
  it('main + item1/2/3 四个 slot 都被渲染', () => {
    const wrapper = mountWithTokens(OneVsThree, {
      slots: {
        main: '<span data-test="M">M</span>',
        item1: '<span data-test="i1">1</span>',
        item2: '<span data-test="i2">2</span>',
        item3: '<span data-test="i3">3</span>',
      },
    })
    expect(wrapper.find('[data-test="M"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="i1"]').text()).toBe('1')
    expect(wrapper.find('[data-test="i2"]').text()).toBe('2')
    expect(wrapper.find('[data-test="i3"]').text()).toBe('3')
  })

  it('默认 direction=left:主区在左 + grid-template-columns 主区在前', () => {
    const wrapper = mountWithTokens(OneVsThree)
    const root = wrapper.find('.ld-one-vs-three')
    expect(root.attributes('style')).toContain('grid-template-columns: 1fr 1fr')
    // direction 默认 left,main 的 order=0, items 的 order=1
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 0')
    expect(wrapper.find('.ld-items').attributes('style')).toContain('order: 1')
  })

  it('direction=right:主区在右 + items 在左', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { direction: 'right' } })
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 1')
    expect(wrapper.find('.ld-items').attributes('style')).toContain('order: 0')
  })

  it('mainFr=2 + direction=left → grid 2fr 1fr', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { mainFr: 2 } })
    expect(wrapper.find('.ld-one-vs-three').attributes('style')).toContain(
      'grid-template-columns: 2fr 1fr',
    )
  })

  it('mainFr=2 + direction=right → grid 1fr 2fr', () => {
    const wrapper = mountWithTokens(OneVsThree, {
      props: { mainFr: 2, direction: 'right' },
    })
    expect(wrapper.find('.ld-one-vs-three').attributes('style')).toContain(
      'grid-template-columns: 1fr 2fr',
    )
  })
})
