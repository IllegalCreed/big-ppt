import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import NineGrid from './NineGrid.vue'

describe('NineGrid', () => {
  it('9 个 slot 各自渲染', () => {
    const slots: Record<string, string> = {}
    for (let i = 1; i <= 9; i++) {
      slots[`slot${i}`] = `<span data-test="s${i}">${i}</span>`
    }
    const wrapper = mountWithTokens(NineGrid, { slots })
    const cells = wrapper.findAll('.ld-cell')
    expect(cells).toHaveLength(9)
    for (let i = 1; i <= 9; i++) {
      expect(wrapper.find(`[data-test="s${i}"]`).text()).toBe(String(i))
    }
  })

  it('全空 slot 时 9 单元格仍渲染（骨架健壮）', () => {
    const wrapper = mountWithTokens(NineGrid)
    expect(wrapper.findAll('.ld-cell')).toHaveLength(9)
  })
})
