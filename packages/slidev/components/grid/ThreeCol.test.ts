import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import ThreeCol from './ThreeCol.vue'

describe('ThreeCol', () => {
  it('三个 named slot 各自渲染对应内容', () => {
    const wrapper = mountWithTokens(ThreeCol, {
      slots: {
        left: '<span data-test="L">L</span>',
        center: '<span data-test="C">C</span>',
        right: '<span data-test="R">R</span>',
      },
    })
    expect(wrapper.find('[data-test="L"]').text()).toBe('L')
    expect(wrapper.find('[data-test="C"]').text()).toBe('C')
    expect(wrapper.find('[data-test="R"]').text()).toBe('R')
  })

  it('cols prop 写入 grid-template-columns 内联样式', () => {
    const wrapper = mountWithTokens(ThreeCol, { props: { cols: '2fr 1fr 2fr' } })
    expect(wrapper.find('.ld-three-col').attributes('style')).toContain(
      'grid-template-columns: 2fr 1fr 2fr',
    )
  })
})
