import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import OneTopThreeBottom from './OneTopThreeBottom.vue'

describe('OneTopThreeBottom', () => {
  it('main + item1/2/3 渲染到对应区域', () => {
    const wrapper = mountWithTokens(OneTopThreeBottom, {
      slots: {
        main: '<span data-test="M">M</span>',
        item1: '<span data-test="i1">1</span>',
        item2: '<span data-test="i2">2</span>',
        item3: '<span data-test="i3">3</span>',
      },
    })
    expect(wrapper.find('[data-test="M"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="i1"]').text()).toBe('1')
    expect(wrapper.findAll('.ld-item')).toHaveLength(3)
  })

  it('mainFr 影响 grid-template-rows 上下比例', () => {
    const wrapper = mountWithTokens(OneTopThreeBottom, { props: { mainFr: 2 } })
    expect(wrapper.find('.ld-one-top-three-bottom').attributes('style')).toContain(
      'grid-template-rows: 2fr 1fr',
    )
  })
})
