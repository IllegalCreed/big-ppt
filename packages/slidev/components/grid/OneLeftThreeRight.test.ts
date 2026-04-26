import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import OneLeftThreeRight from './OneLeftThreeRight.vue'

describe('OneLeftThreeRight', () => {
  it('main + item1/2/3 四个 slot 都被渲染', () => {
    const wrapper = mountWithTokens(OneLeftThreeRight, {
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

  it('mainFr 调整左主区宽度（grid-template-columns）', () => {
    const wrapper = mountWithTokens(OneLeftThreeRight, { props: { mainFr: 2 } })
    expect(wrapper.find('.ld-one-left-three-right').attributes('style')).toContain(
      'grid-template-columns: 2fr 1fr',
    )
  })
})
