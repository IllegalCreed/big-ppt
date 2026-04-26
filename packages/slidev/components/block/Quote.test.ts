import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../test/_setup/index.js'
import Quote from './Quote.vue'

describe('Quote', () => {
  it('渲染默认 slot 为引文 body；author / cite 写到 footer', () => {
    const wrapper = mountWithTokens(Quote, {
      props: { author: '张三', cite: '《产品白皮书》' },
      slots: { default: '<p>引文文字</p>' },
    })
    expect(wrapper.find('.ld-quote-body').text()).toBe('引文文字')
    expect(wrapper.find('.ld-quote-author').text()).toContain('张三')
    expect(wrapper.find('.ld-quote-cite').text()).toBe('《产品白皮书》')
  })

  it('无 author / cite 时 footer 不渲染', () => {
    const wrapper = mountWithTokens(Quote, { slots: { default: 'x' } })
    expect(wrapper.find('.ld-quote-footer').exists()).toBe(false)
  })
})
