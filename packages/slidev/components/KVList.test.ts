import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../test/_setup/index.js'
import KVList from './KVList.vue'

describe('KVList', () => {
  it('items 数组循环渲染 dt / dd 配对', () => {
    const wrapper = mountWithTokens(KVList, {
      props: {
        items: [
          { label: '部门', value: '研发部' },
          { label: '负责人', value: '张三' },
          { label: '截止日期', value: '2026-04-30' },
        ],
      },
    })
    const labels = wrapper.findAll('.ld-kv-label').map((w) => w.text())
    const values = wrapper.findAll('.ld-kv-value').map((w) => w.text())
    expect(labels).toEqual(['部门', '负责人', '截止日期'])
    expect(values).toEqual(['研发部', '张三', '2026-04-30'])
  })

  it('columns 写入 grid-template-columns（auto + 1fr 重复）', () => {
    const wrapper = mountWithTokens(KVList, {
      props: { items: [{ label: 'A', value: 'B' }], columns: 3 },
    })
    expect(wrapper.find('.ld-kv-list').attributes('style')).toContain(
      'grid-template-columns: repeat(3, auto 1fr)',
    )
  })
})
