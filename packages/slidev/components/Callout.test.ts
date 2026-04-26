import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../test/_setup/index.js'
import Callout from './Callout.vue'

describe('Callout', () => {
  it('默认 type=info；title + body 都渲染', () => {
    const wrapper = mountWithTokens(Callout, {
      props: { title: '注意' },
      slots: { default: '主体说明' },
    })
    expect(wrapper.find('.ld-callout').attributes('data-type')).toBe('info')
    expect(wrapper.find('.ld-callout-title').text()).toBe('注意')
    expect(wrapper.find('.ld-callout-body').text()).toBe('主体说明')
  })

  it('type 三档分别写到 data-type', () => {
    const w = mountWithTokens(Callout, { props: { type: 'warning' } })
    expect(w.find('.ld-callout').attributes('data-type')).toBe('warning')

    const w2 = mountWithTokens(Callout, { props: { type: 'success' } })
    expect(w2.find('.ld-callout').attributes('data-type')).toBe('success')
  })

  it('无 title 时 title 区不渲染', () => {
    const wrapper = mountWithTokens(Callout, { slots: { default: '正文' } })
    expect(wrapper.find('.ld-callout-title').exists()).toBe(false)
    expect(wrapper.find('.ld-callout-body').text()).toBe('正文')
  })
})
