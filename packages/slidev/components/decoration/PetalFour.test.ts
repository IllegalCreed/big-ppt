import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import PetalFour from './PetalFour.vue'

describe('PetalFour', () => {
  it('SVG 4 个椭圆花瓣骨架渲染', () => {
    const wrapper = mountWithTokens(PetalFour)
    expect(wrapper.find('.ld-petal-svg').exists()).toBe(true)
    expect(wrapper.findAll('ellipse')).toHaveLength(4)
  })

  it('slot1..slot4 内容透出到对应单元', () => {
    const wrapper = mountWithTokens(PetalFour, {
      slots: {
        slot1: '<span data-test="s1">1</span>',
        slot2: '<span data-test="s2">2</span>',
        slot3: '<span data-test="s3">3</span>',
        slot4: '<span data-test="s4">4</span>',
      },
    })
    expect(wrapper.find('[data-test="s1"]').text()).toBe('1')
    expect(wrapper.find('[data-test="s2"]').text()).toBe('2')
    expect(wrapper.find('[data-test="s3"]').text()).toBe('3')
    expect(wrapper.find('[data-test="s4"]').text()).toBe('4')
  })

  it('borderWidth 控制 SVG stroke-width 档位（thin / thick）', () => {
    const thick = mountWithTokens(PetalFour, { props: { borderWidth: 'thick' } })
    expect(thick.find('.ld-petal-four').attributes('data-border')).toBe('thick')

    const thin = mountWithTokens(PetalFour, { props: { borderWidth: 'thin' } })
    expect(thin.find('.ld-petal-four').attributes('data-border')).toBe('thin')
  })
})
