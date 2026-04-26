import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import Table from './Table.vue'

describe('Table', () => {
  it('headers + rows 渲染对应 thead / tbody 结构', () => {
    const wrapper = mountWithTokens(Table, {
      props: {
        headers: ['项目', '负责人', '截止日期'],
        rows: [
          ['登录优化', '张三', '2026-04-30'],
          ['性能埋点', '李四', '2026-05-15'],
        ],
      },
    })
    expect(wrapper.findAll('thead th').map((w) => w.text())).toEqual(['项目', '负责人', '截止日期'])
    const cells = wrapper.findAll('tbody td').map((w) => w.text())
    expect(cells).toEqual(['登录优化', '张三', '2026-04-30', '性能埋点', '李四', '2026-05-15'])
  })

  it('variant 默认 striped；plain 时切换 data-variant 属性', () => {
    const def = mountWithTokens(Table, { props: { headers: ['a'], rows: [['1']] } })
    expect(def.find('table.ld-table').attributes('data-variant')).toBe('striped')

    const plain = mountWithTokens(Table, {
      props: { headers: ['a'], rows: [['1']], variant: 'plain' },
    })
    expect(plain.find('table.ld-table').attributes('data-variant')).toBe('plain')
  })

  it('空 rows 时仅渲染 thead 不崩', () => {
    const wrapper = mountWithTokens(Table, { props: { headers: ['a', 'b'], rows: [] } })
    expect(wrapper.findAll('thead th')).toHaveLength(2)
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
  })
})
