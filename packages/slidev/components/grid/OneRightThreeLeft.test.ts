import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import OneRightThreeLeft from './OneRightThreeLeft.vue'

describe('OneRightThreeLeft', () => {
  it('main + item1/2/3 全 slot 渲染', () => {
    const wrapper = mountWithTokens(OneRightThreeLeft, {
      slots: {
        main: '<span data-test="M">M</span>',
        item1: '<span data-test="i1">1</span>',
        item2: '<span data-test="i2">2</span>',
        item3: '<span data-test="i3">3</span>',
      },
    })
    expect(wrapper.find('[data-test="M"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="i1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="i2"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="i3"]').exists()).toBe(true)
  })

  it('mainFr 改右主区宽度（顺序与 OneLeftThreeRight 镜像）', () => {
    const wrapper = mountWithTokens(OneRightThreeLeft, { props: { mainFr: 3 } })
    expect(wrapper.find('.ld-one-right-three-left').attributes('style')).toContain(
      'grid-template-columns: 1fr 3fr',
    )
  })
})
