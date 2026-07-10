import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PresentationViewer from './PresentationViewer.vue'

const markdown = [
  '---',
  'layout: beitou-cover',
  'mainTitle: One',
  '---',
  '',
  '---',
  'layout: beitou-content',
  'heading: Two',
  '---',
].join('\n')

const DeckRendererStub = defineComponent({
  props: ['currentPage'],
  setup: (props) => () =>
    h('div', { 'data-page': props.currentPage }, `slide-${props.currentPage}`),
})

function mountViewer(mode: 'present' | 'share-view' = 'present') {
  return mount(PresentationViewer, {
    props: {
      presentation: {
        deckId: 1,
        title: 'Demo',
        templateId: 'beitou-standard',
        markdown,
        updatedAt: new Date().toISOString(),
      },
      mode,
    },
    global: { stubs: { DeckRenderer: DeckRendererStub } },
  })
}

describe('PresentationViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按钮与键盘可翻页，页码不会越界', async () => {
    const wrapper = mountViewer()
    expect(wrapper.text()).toContain('1 / 2')

    await wrapper.get('button[aria-label="下一页"]').trigger('click')
    expect(wrapper.text()).toContain('2 / 2')
    expect(wrapper.get('[data-page="2"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('2 / 2')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1 / 2')
  })

  it('深浅色开关只改变界面，幻灯片保持可见，并支持 overview 和演讲者入口', async () => {
    const wrapper = mountViewer()
    const viewer = wrapper.get('[data-presentation-viewer]')
    expect(viewer.classes()).toContain('ui-theme-dark')

    await wrapper.get('button[aria-label="浅色界面"]').trigger('click')
    expect(viewer.classes()).toContain('ui-theme-light')
    expect(wrapper.find('.blackout').exists()).toBe(false)
    expect(wrapper.get('[data-page="1"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="深色界面"]').trigger('click')
    expect(viewer.classes()).toContain('ui-theme-dark')
    expect(wrapper.find('.blackout').exists()).toBe(false)

    await wrapper.get('button[aria-label="幻灯片总览"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('幻灯片总览')
    await wrapper.get('button[aria-label="跳转到第 2 页"]').trigger('click')
    expect(wrapper.text()).toContain('2 / 2')

    await wrapper.get('button[aria-label="演讲者视图"]').trigger('click')
    expect(wrapper.emitted('open-presenter')?.[0]).toEqual([2])
  })

  it('公开分享模式隐藏画笔与演讲者控制', () => {
    const wrapper = mountViewer('share-view')
    expect(wrapper.find('button[aria-label="画笔"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="演讲者视图"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="切换全屏"]').exists()).toBe(true)
  })
})
