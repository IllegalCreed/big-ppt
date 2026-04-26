import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import TwoCol from './TwoCol.vue'

describe('TwoCol', () => {
  it('默认无 title，slot 内容透出到对应栏', () => {
    const wrapper = mountWithTokens(TwoCol, {
      slots: {
        left: '<p data-test="L">left content</p>',
        right: '<p data-test="R">right content</p>',
      },
    })
    expect(wrapper.find('.ld-two-col').exists()).toBe(true)
    expect(wrapper.find('[data-test="L"]').text()).toBe('left content')
    expect(wrapper.find('[data-test="R"]').text()).toBe('right content')
    expect(wrapper.findAll('.ld-col-title')).toHaveLength(0)
  })

  it('leftTitle / rightTitle props 渲染对应标题', () => {
    const wrapper = mountWithTokens(TwoCol, {
      props: { leftTitle: '旧方案', rightTitle: '新方案' },
      slots: { left: '<span/>', right: '<span/>' },
    })
    const titles = wrapper.findAll('.ld-col-title').map((w) => w.text())
    expect(titles).toEqual(['旧方案', '新方案'])
  })

  it('divider="off" 时分隔条不可见', () => {
    const on = mountWithTokens(TwoCol, { props: { divider: 'on' } })
    expect(on.find('.ld-two-col').attributes('data-divider')).toBe('on')

    const off = mountWithTokens(TwoCol, { props: { divider: 'off' } })
    expect(off.find('.ld-two-col').attributes('data-divider')).toBe('off')
  })
})
