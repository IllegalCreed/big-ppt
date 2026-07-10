import type { PresentationPayload } from '@big-ppt/shared'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import PresenterMode from './PresenterMode.vue'

const markdown = [
  '---',
  'layout: beitou-cover',
  'mainTitle: One',
  '---',
  '',
  '<!-- 第一页备注 -->',
  '',
  '---',
  'layout: beitou-content',
  'heading: Two',
  '---',
].join('\n')

const presentation: PresentationPayload = {
  deckId: 1,
  title: 'Demo',
  templateId: 'beitou-standard',
  markdown,
  updatedAt: new Date().toISOString(),
}

const DeckRendererStub = defineComponent({
  props: ['currentPage'],
  setup: (props) => () =>
    h('div', { 'data-page': props.currentPage }, `slide-${props.currentPage}`),
})

const DrawingLayerStub = defineComponent({
  props: ['strokes', 'enabled', 'tool', 'color', 'width'],
  emits: ['update:strokes'],
  setup: (props) => () =>
    h('div', {
      'data-drawing': '',
      'data-enabled': String(props.enabled),
      'data-tool': props.tool,
      'data-width': String(props.width),
    }),
})

function mountPresenter() {
  return mount(PresenterMode, {
    props: {
      presentation,
      channelId: 'test-channel',
    },
    global: {
      stubs: {
        DeckRenderer: DeckRendererStub,
        DrawingLayer: DrawingLayerStub,
      },
    },
  })
}

describe('PresenterMode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('显示当前页、下一页与备注，并支持按钮和键盘控制', async () => {
    const wrapper = mountPresenter()

    expect(wrapper.text()).toContain('第一页备注')
    expect(wrapper.get('[data-page="1"]').exists()).toBe(true)
    expect(wrapper.get('[data-page="2"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="下一页"]').trigger('click')
    expect(wrapper.text()).toContain('2 / 2')
    expect(wrapper.text()).toContain('本页暂无备注')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await nextTick()
    expect(wrapper.text()).toContain('1 / 2')

    const presenter = wrapper.get('[data-presenter-mode]')
    expect(presenter.classes()).toContain('ui-theme-dark')
    await wrapper.get('button[aria-label="浅色界面"]').trigger('click')
    expect(presenter.classes()).toContain('ui-theme-light')
    expect(wrapper.get('[data-page="1"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    await nextTick()
    expect(presenter.classes()).toContain('ui-theme-light')
    expect(wrapper.get('[data-page="1"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="深色界面"]').trigger('click')
    expect(presenter.classes()).toContain('ui-theme-dark')

    await wrapper.get('button[aria-label="打开观众窗口"]').trigger('click')
    await wrapper.get('button[aria-label="退出演讲者视图"]').trigger('click')
    expect(wrapper.emitted('open-audience')?.[0]).toEqual([1])
    expect(wrapper.emitted('exit')).toHaveLength(1)

    wrapper.unmount()
  })

  it('计时器可暂停、继续和重置', async () => {
    const wrapper = mountPresenter()

    vi.advanceTimersByTime(2_000)
    await nextTick()
    expect(wrapper.get('[aria-label="演讲计时"]').text()).toBe('00:00:02')

    await wrapper.get('button[aria-label="暂停计时"]').trigger('click')
    vi.advanceTimersByTime(2_000)
    await nextTick()
    expect(wrapper.get('[aria-label="演讲计时"]').text()).toBe('00:00:02')

    await wrapper.get('button[aria-label="继续计时"]').trigger('click')
    vi.advanceTimersByTime(1_000)
    await nextTick()
    expect(wrapper.get('[aria-label="演讲计时"]').text()).toBe('00:00:03')

    await wrapper.get('button[aria-label="重置计时"]').trigger('click')
    expect(wrapper.get('[aria-label="演讲计时"]').text()).toBe('00:00:00')

    wrapper.unmount()
  })

  it('画笔工具、颜色与笔迹操作会同步到绘制层', async () => {
    const wrapper = mountPresenter()
    const drawing = () => wrapper.get('[data-drawing]')

    await wrapper.get('button[aria-label="高亮"]').trigger('click')
    expect(drawing().attributes('data-enabled')).toBe('true')
    expect(drawing().attributes('data-tool')).toBe('highlighter')
    expect(drawing().attributes('data-width')).toBe('24')

    await wrapper.get('button[aria-label="选择画笔颜色 #38bdf8"]').trigger('click')
    expect(wrapper.get('button[aria-label="选择画笔颜色 #38bdf8"]').classes()).toContain('active')

    wrapper.getComponent(DrawingLayerStub).vm.$emit('update:strokes', [
      {
        id: 'stroke-1',
        tool: 'highlighter',
        color: '#38bdf8',
        width: 24,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      },
    ])
    await nextTick()

    expect(wrapper.get('button[aria-label="撤销笔迹"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('button[aria-label="撤销笔迹"]').trigger('click')
    expect(wrapper.get('button[aria-label="清空本页笔迹"]').attributes()).toHaveProperty('disabled')

    await wrapper.get('button[aria-label="关闭画笔"]').trigger('click')
    expect(drawing().attributes('data-enabled')).toBe('false')

    wrapper.unmount()
  })
})
