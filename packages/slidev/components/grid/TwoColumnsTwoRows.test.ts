import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import TwoColumnsTwoRows from './TwoColumnsTwoRows.vue'

describe('TwoColumnsTwoRows', () => {
  it('4 个 slot 各自渲染到对应单元格', () => {
    const wrapper = mountWithTokens(TwoColumnsTwoRows, {
      slots: {
        slot1: '<span data-test="s1">A</span>',
        slot2: '<span data-test="s2">B</span>',
        slot3: '<span data-test="s3">C</span>',
        slot4: '<span data-test="s4">D</span>',
      },
    })
    const cells = wrapper.findAll('.ld-cell')
    expect(cells).toHaveLength(4)
    expect(cells[0].text()).toBe('A')
    expect(cells[1].text()).toBe('B')
    expect(cells[2].text()).toBe('C')
    expect(cells[3].text()).toBe('D')
  })

  it('无 slot 时仍保留 4 单元格骨架（不崩）', () => {
    const wrapper = mountWithTokens(TwoColumnsTwoRows)
    expect(wrapper.findAll('.ld-cell')).toHaveLength(4)
  })
})
