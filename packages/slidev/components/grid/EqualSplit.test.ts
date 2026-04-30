import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import EqualSplit from './EqualSplit.vue'

describe('EqualSplit', () => {
  it('count=2 + default direction=row → grid-template-columns repeat(2)', () => {
    const wrapper = mountWithTokens(EqualSplit, { props: { count: 2 } })
    const root = wrapper.find('.ld-equal-split')
    expect(root.attributes('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(root.attributes('data-direction')).toBe('row')
    expect(root.attributes('data-count')).toBe('2')
  })

  it('count=3 + direction=row → 3 列横排', () => {
    const wrapper = mountWithTokens(EqualSplit, { props: { count: 3, direction: 'row' } })
    expect(wrapper.find('.ld-equal-split').attributes('style')).toContain(
      'grid-template-columns: repeat(3, minmax(0, 1fr))',
    )
  })

  it('count=4 + direction=row → 4 列横排', () => {
    const wrapper = mountWithTokens(EqualSplit, { props: { count: 4 } })
    expect(wrapper.find('.ld-equal-split').attributes('style')).toContain(
      'grid-template-columns: repeat(4, minmax(0, 1fr))',
    )
  })

  it('count=3 + direction=col → grid-template-rows repeat(3) + cols 单列', () => {
    const wrapper = mountWithTokens(EqualSplit, { props: { count: 3, direction: 'col' } })
    const style = wrapper.find('.ld-equal-split').attributes('style')
    expect(style).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))')
    expect(style).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('count=2 → 渲染 2 个 slot,count=4 → 4 个 slot', () => {
    const wrapper2 = mountWithTokens(EqualSplit, {
      props: { count: 2 },
      slots: {
        slot1: '<span data-test="s1">1</span>',
        slot2: '<span data-test="s2">2</span>',
        slot3: '<span data-test="s3">3</span>',  // 不应渲染
      },
    })
    expect(wrapper2.find('[data-test="s1"]').exists()).toBe(true)
    expect(wrapper2.find('[data-test="s2"]').exists()).toBe(true)
    expect(wrapper2.find('[data-test="s3"]').exists()).toBe(false) // count=2,slot3 不渲染

    const wrapper4 = mountWithTokens(EqualSplit, {
      props: { count: 4 },
      slots: {
        slot1: '<span data-test="t1">1</span>',
        slot2: '<span data-test="t2">2</span>',
        slot3: '<span data-test="t3">3</span>',
        slot4: '<span data-test="t4">4</span>',
      },
    })
    expect(wrapper4.find('[data-test="t1"]').text()).toBe('1')
    expect(wrapper4.find('[data-test="t4"]').text()).toBe('4')
  })
})
