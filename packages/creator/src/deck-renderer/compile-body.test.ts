import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { compileBody, sanitizeBodyHtml, _resetBodyCache } from './compile-body'

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

  it('真实 starter content 内的 <EqualSplit> 嵌套 markdown：tag + 内容都活下来', () => {
    const body = [
      '<EqualSplit :count="2">',
      '<template #slot1>',
      '',
      '- alpha',
      '- beta',
      '',
      '</template>',
      '<template #slot2>',
      '',
      '- gamma',
      '',
      '</template>',
      '</EqualSplit>',
    ].join('\n')
    const comp = compileBody(body)
    const w = mount(comp, {
      global: {
        stubs: {
          EqualSplit: {
            template:
              '<section class="tc" :data-count="count"><div class="lt"><slot name="slot1" /></div><div class="rt"><slot name="slot2" /></div></section>',
            props: ['count'],
          },
        },
      },
    })
    expect(w.find('.tc').exists()).toBe(true)
    expect(w.find('.tc').attributes('data-count')).toBe('2')
    expect(w.find('.lt').text()).toContain('alpha')
    expect(w.find('.rt').text()).toContain('gamma')
  })

  it('阻止 mustache 表达式执行', () => {
    delete (globalThis as typeof globalThis & { __lumideckXss?: unknown }).__lumideckXss
    const comp = compileBody('{{ globalThis.__lumideckXss = 1 }}')
    const w = mount(comp)

    expect((globalThis as typeof globalThis & { __lumideckXss?: unknown }).__lumideckXss).toBeUndefined()
    expect(w.text()).toContain('{{ globalThis.__lumideckXss = 1 }}')
  })

  it('剥离事件、任意 directive 和非字面量绑定', () => {
    delete (globalThis as typeof globalThis & { __lumideckXss?: unknown }).__lumideckXss
    const comp = compileBody(
      '<Quote text="safe" onclick="globalThis.__lumideckXss = 1" v-html="globalThis.__lumideckXss = 2" :label="globalThis.__lumideckXss = 3" />',
    )
    const w = mount(comp, {
      global: {
        stubs: {
          Quote: {
            template: '<div class="quote-stub">{{ text }}|{{ label ?? "" }}</div>',
            props: ['text', 'label'],
          },
        },
      },
    })

    expect((globalThis as typeof globalThis & { __lumideckXss?: unknown }).__lumideckXss).toBeUndefined()
    expect(w.find('.quote-stub').text()).toBe('safe|')
  })

  it('允许组件绑定使用受控字面量表达式', () => {
    const comp = compileBody(`<BarChart :labels='["Q1","Q2"]' :values='[120,180]' label="季度营收" />`)
    const w = mount(comp, {
      global: {
        stubs: {
          BarChart: {
            template: '<div class="chart-stub">{{ label }}:{{ labels.join("/") }}={{ values.join("/") }}</div>',
            props: ['labels', 'values', 'label'],
          },
        },
      },
    })

    expect(w.find('.chart-stub').text()).toBe('季度营收:Q1/Q2=120/180')
  })

  it('剥离危险 HTML 与危险 URL', () => {
    const html = sanitizeBodyHtml(
      '<p><a href="javascript:alert(1)" onclick="alert(2)">x</a><img src="data:text/html;base64,PHNjcmlwdA=="><script>alert(3)</script></p>',
    )

    expect(html).toContain('<a>x</a>')
    expect(html).toContain('<img />')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('script')
  })
})
