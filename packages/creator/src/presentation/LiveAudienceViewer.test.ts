import type { PresentationPayload, PresentationSnapshot } from '@big-ppt/shared'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import LiveAudienceViewer from './LiveAudienceViewer.vue'

const presentation: PresentationPayload = {
  deckId: 1,
  title: 'Live Demo',
  templateId: 'beitou-standard',
  markdown: [
    '---',
    'layout: beitou-cover',
    'mainTitle: One',
    '---',
    '',
    '---',
    'layout: beitou-content',
    'heading: Two',
    '---',
  ].join('\n'),
  updatedAt: new Date().toISOString(),
}

const DeckRendererStub = defineComponent({
  props: ['currentPage'],
  setup: (props) => () => h('div', { 'data-page': props.currentPage }),
})

const DrawingLayerStub = defineComponent({
  props: ['strokes', 'enabled'],
  setup: (props) => () =>
    h('div', {
      'data-drawing': '',
      'data-strokes': String(props.strokes.length),
      'data-enabled': String(Boolean(props.enabled)),
    }),
})

function mountViewer(snapshot: PresentationSnapshot) {
  return mount(LiveAudienceViewer, {
    props: { presentation, snapshot, connectionState: 'connected' },
    global: {
      stubs: { DeckRenderer: DeckRendererStub, DrawingLayer: DrawingLayerStub },
    },
  })
}

describe('LiveAudienceViewer', () => {
  it('只展示演讲者状态，不提供翻页、画笔或总览控制', async () => {
    const wrapper = mountViewer({ page: 1, blackout: 'none', drawings: {} })
    expect(wrapper.get('[data-live-audience]').exists()).toBe(true)
    expect(wrapper.get('[data-page="1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('1 / 2')
    expect(wrapper.find('button[aria-label="上一页"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="下一页"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="画笔"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="幻灯片总览"]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.get('button[aria-label="切换全屏"]').exists()).toBe(true)

    await wrapper.setProps({
      snapshot: {
        page: 2,
        blackout: 'black',
        drawings: {
          2: [
            {
              id: 'stroke-1',
              tool: 'highlighter',
              color: '#facc15',
              width: 24,
              points: [{ x: 20, y: 30 }],
            },
          ],
        },
      },
    })
    expect(wrapper.get('[data-page="2"]').exists()).toBe(true)
    expect(wrapper.get('[data-drawing]').attributes('data-strokes')).toBe('1')
    expect(wrapper.get('[data-drawing]').attributes('data-enabled')).toBe('false')
    expect(wrapper.get('.blackout').classes()).toContain('black')
  })
})
