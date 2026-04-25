import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UndoToast from '../src/components/UndoToast.vue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('UndoToast', () => {
  it('visible=true 时渲染 message 和 undo 链接', () => {
    const wrapper = mount(UndoToast, {
      props: {
        visible: true,
        templateName: '竞业达汇报模板',
        snapshotVersionId: 7,
        disableTeleport: true,
      },
    })
    expect(wrapper.text()).toContain('已切换到「竞业达汇报模板」')
    expect(wrapper.find('a[data-undo-link]').exists()).toBe(true)
  })

  it('visible=true 后 6s 自动 emit close', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 1, disableTeleport: true },
    })
    await vi.advanceTimersByTimeAsync(5_999)
    expect(wrapper.emitted('close')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('close')).toBeDefined()
  })

  it('点 × 立刻 emit close', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 1, disableTeleport: true },
    })
    await wrapper.find('button[data-close]').trigger('click')
    expect(wrapper.emitted('close')).toBeDefined()
  })

  it('点 undo link emit undo 事件并携带 snapshotVersionId', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 42, disableTeleport: true },
    })
    await wrapper.find('a[data-undo-link]').trigger('click')
    const events = wrapper.emitted('undo')
    expect(events).toBeDefined()
    expect(events![0][0]).toBe(42)
  })
})
