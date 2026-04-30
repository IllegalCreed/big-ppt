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

  it('默认 direction=left:横向布局,main 在左 (order=0) + items 内部纵向 3 行', () => {
    const wrapper = mountWithTokens(OneVsThree)
    const root = wrapper.find('.ld-one-vs-three')
    expect(root.attributes('data-direction')).toBe('left')
    expect(root.attributes('style')).toContain('grid-template-columns: 1fr 1fr')
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 0')
    expect(wrapper.find('.ld-items').attributes('style')).toContain('order: 1')
    expect(wrapper.find('.ld-items').attributes('style')).toContain(
      'grid-template-rows: repeat(3, minmax(0, 1fr))',
    )
  })

  it('direction=right:横向布局,main 在右 (order=1) + items 在左', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { direction: 'right' } })
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 1')
    expect(wrapper.find('.ld-items').attributes('style')).toContain('order: 0')
  })

  it('direction=top:竖向布局,main 在上 + items 内部横向 3 列', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { direction: 'top' } })
    const root = wrapper.find('.ld-one-vs-three')
    expect(root.attributes('data-direction')).toBe('top')
    expect(root.attributes('style')).toContain('grid-template-rows: 1fr 1fr')
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 0')
    expect(wrapper.find('.ld-items').attributes('style')).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    )
  })

  it('direction=bottom:竖向布局,main 在下 (order=1) + items 在上', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { direction: 'bottom' } })
    expect(wrapper.find('.ld-main').attributes('style')).toContain('order: 1')
    expect(wrapper.find('.ld-items').attributes('style')).toContain('order: 0')
    expect(wrapper.find('.ld-items').attributes('style')).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    )
  })

  it('mainFr=2 + direction=left → grid-template-columns: 2fr 1fr', () => {
    const wrapper = mountWithTokens(OneVsThree, { props: { mainFr: 2 } })
    expect(wrapper.find('.ld-one-vs-three').attributes('style')).toContain(
      'grid-template-columns: 2fr 1fr',
    )
  })

  it('mainFr=2 + direction=top → grid-template-rows: 2fr 1fr', () => {
    const wrapper = mountWithTokens(OneVsThree, {
      props: { direction: 'top', mainFr: 2 },
    })
    expect(wrapper.find('.ld-one-vs-three').attributes('style')).toContain(
      'grid-template-rows: 2fr 1fr',
    )
  })
})
