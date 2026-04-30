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

  it('Phase 11.7: showCenterDecoration=true 渲染 8+1 装饰模式（slot1..slot8 外圈 + #decoration 中央）', () => {
    const slots: Record<string, string> = {}
    for (let i = 1; i <= 8; i++) {
      slots[`slot${i}`] = `<span data-test="s${i}">${i}</span>`
    }
    slots.decoration = '<span data-test="deco">D</span>'
    const wrapper = mountWithTokens(NineGrid, {
      props: { showCenterDecoration: true },
      slots,
    })
    expect(wrapper.find('.ld-nine-grid').attributes('data-show-center-decoration')).toBe('true')
    // 9 个 cell 仍然存在
    const cells = wrapper.findAll('.ld-cell')
    expect(cells).toHaveLength(9)
    // 8 个 slot 都渲染
    for (let i = 1; i <= 8; i++) {
      expect(wrapper.find(`[data-test="s${i}"]`).text()).toBe(String(i))
    }
    // 中央装饰 cell 渲染 #decoration 且带 .ld-cell--decoration class
    const decorationCell = wrapper.find('.ld-cell--decoration')
    expect(decorationCell.exists()).toBe(true)
    expect(decorationCell.find('[data-test="deco"]').text()).toBe('D')
    // showCenterDecoration=true 时 slot9 不会被渲染（外圈只有 8 格）
    expect(wrapper.find('[data-test="s9"]').exists()).toBe(false)
  })

  it('Phase 11.7: showCenterDecoration=false (默认) 时无 .ld-cell--decoration 标记', () => {
    const wrapper = mountWithTokens(NineGrid)
    expect(wrapper.find('.ld-cell--decoration').exists()).toBe(false)
  })
})
