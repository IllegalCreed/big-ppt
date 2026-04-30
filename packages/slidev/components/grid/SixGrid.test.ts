import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import SixGrid from './SixGrid.vue'

describe('SixGrid', () => {
  it('默认 layout=3x2: 3 行 2 列', () => {
    const wrapper = mountWithTokens(SixGrid)
    const root = wrapper.find('.ld-six-grid')
    expect(root.attributes('data-layout')).toBe('3x2')
    expect(root.attributes('style')).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
    expect(root.attributes('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  })

  it('layout=2x3: 2 行 3 列', () => {
    const wrapper = mountWithTokens(SixGrid, { props: { layout: '2x3' } })
    const root = wrapper.find('.ld-six-grid')
    expect(root.attributes('data-layout')).toBe('2x3')
    expect(root.attributes('style')).toContain('grid-template-rows: repeat(2, minmax(0, 1fr))')
    expect(root.attributes('style')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
  })

  it('6 个 slot 全部渲染', () => {
    const wrapper = mountWithTokens(SixGrid, {
      slots: {
        slot1: '<span data-test="s1">1</span>',
        slot2: '<span data-test="s2">2</span>',
        slot3: '<span data-test="s3">3</span>',
        slot4: '<span data-test="s4">4</span>',
        slot5: '<span data-test="s5">5</span>',
        slot6: '<span data-test="s6">6</span>',
      },
    })
    for (let i = 1; i <= 6; i++) {
      expect(wrapper.find(`[data-test="s${i}"]`).text()).toBe(String(i))
    }
  })
})
