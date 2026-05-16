/** Phase 12.7 Task G：ToolExecutionBlock 四态渲染 + 折叠详情交互单测。 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolExecutionBlock from '../src/components/ToolExecutionBlock.vue'

describe('ToolExecutionBlock', () => {
  it('pending 状态：label="排队中" + 类 .pending', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: { toolName: 'read_slides', state: 'pending' },
    })
    expect(wrapper.find('.tool-state').text()).toBe('排队中')
    expect(wrapper.find('.tool-execution-block').classes()).toContain('pending')
    expect(wrapper.find('.tool-name').text()).toBe('read_slides')
  })

  it('running 状态：label="执行中" + 类 .running', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: { toolName: 'write_slides', state: 'running' },
    })
    expect(wrapper.find('.tool-state').text()).toBe('执行中')
    expect(wrapper.find('.tool-execution-block').classes()).toContain('running')
  })

  it('done 状态：label="完成" + 类 .done', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: { toolName: 'create_slide', state: 'done' },
    })
    expect(wrapper.find('.tool-state').text()).toBe('完成')
    expect(wrapper.find('.tool-execution-block').classes()).toContain('done')
  })

  it('error 状态：label="失败" + 类 .error', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: { toolName: 'generate_slide_image', state: 'error' },
    })
    expect(wrapper.find('.tool-state').text()).toBe('失败')
    expect(wrapper.find('.tool-execution-block').classes()).toContain('error')
  })

  it('无 argsPreview / resultPreview 时不渲染 details', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: { toolName: 'read_slides', state: 'done' },
    })
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('有 argsPreview 时渲染 details 含 args', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: {
        toolName: 'update_slide',
        state: 'done',
        argsPreview: '{"index":2,"body":"hi"}',
      },
    })
    expect(wrapper.find('details').exists()).toBe(true)
    expect(wrapper.find('.tool-exec-args').text()).toContain('{"index":2,"body":"hi"}')
    expect(wrapper.find('.tool-exec-result').exists()).toBe(false)
  })

  it('有 resultPreview 时渲染 details 含 result', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: {
        toolName: 'read_slides',
        state: 'done',
        resultPreview: '{"slides":3}',
      },
    })
    expect(wrapper.find('.tool-exec-result').text()).toContain('{"slides":3}')
    expect(wrapper.find('.tool-exec-args').exists()).toBe(false)
  })

  it('details 默认折叠（不开 open 属性）', () => {
    const wrapper = mount(ToolExecutionBlock, {
      props: {
        toolName: 't',
        state: 'done',
        argsPreview: 'a',
      },
    })
    const details = wrapper.find('details').element as HTMLDetailsElement
    expect(details.open).toBe(false)
  })
})
