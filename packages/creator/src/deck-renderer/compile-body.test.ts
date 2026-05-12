import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { compileBody, _resetBodyCache } from './compile-body'

beforeEach(() => _resetBodyCache())

describe('compileBody', () => {
  it('纯 markdown：heading + list 编译成 HTML', () => {
    const comp = compileBody('## 标题\n\n- a\n- b')
    const w = mount(comp)
    expect(w.find('h2').text()).toBe('标题')
    expect(w.findAll('li')).toHaveLength(2)
  })

  it('内嵌 Vue 标签：<Quote text="hi" /> 运行时解析为组件实例', () => {
    const comp = compileBody('<Quote text="hi" />')
    const w = mount(comp, {
      global: {
        stubs: {
          Quote: {
            template: '<div class="quote-stub">{{ text }}</div>',
            props: ['text'],
          },
        },
      },
    })
    expect(w.find('.quote-stub').text()).toBe('hi')
  })

  it('同 body 字符串复用缓存（identity equality）', () => {
    const a = compileBody('# same')
    const b = compileBody('# same')
    expect(a).toBe(b)
  })

  it('真实 starter content 内的 <TwoCol> 嵌套 markdown：tag + 内容都活下来', () => {
    const body = [
      '<TwoCol left-title="A" right-title="B">',
      '<template #left>',
      '',
      '- alpha',
      '- beta',
      '',
      '</template>',
      '<template #right>',
      '',
      '- gamma',
      '',
      '</template>',
      '</TwoCol>',
    ].join('\n')
    const comp = compileBody(body)
    const w = mount(comp, {
      global: {
        stubs: {
          TwoCol: {
            template:
              '<section class="tc"><div class="lt">{{ leftTitle }}<slot name="left" /></div><div class="rt">{{ rightTitle }}<slot name="right" /></div></section>',
            props: ['leftTitle', 'rightTitle'],
          },
        },
      },
    })
    expect(w.find('.tc').exists()).toBe(true)
    expect(w.find('.lt').text()).toContain('A')
    expect(w.find('.lt').text()).toContain('alpha')
    expect(w.find('.rt').text()).toContain('gamma')
  })
})
