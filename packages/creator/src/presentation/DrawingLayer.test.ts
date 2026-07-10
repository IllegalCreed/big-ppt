import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DrawingLayer from './DrawingLayer.vue'

describe('DrawingLayer', () => {
  it('pointer 输入转换为稳定 viewBox 坐标并产出 stroke', async () => {
    const wrapper = mount(DrawingLayer, {
      props: {
        strokes: [],
        enabled: true,
        tool: 'highlighter',
        color: '#facc15',
        width: 24,
      },
    })
    const svg = wrapper.get('svg').element
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 500, height: 281.25 }),
    })

    svg.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 260, clientY: 160.625 }),
    )
    svg.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 510, clientY: 301.25 }),
    )
    svg.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    await wrapper.vm.$nextTick()

    const events = wrapper.emitted('update:strokes') ?? []
    const strokes = events[events.length - 1]?.[0] as Array<{
      tool: string
      color: string
      width: number
      points: Array<{ x: number; y: number }>
    }>
    expect(strokes).toHaveLength(1)
    expect(strokes[0]).toMatchObject({ tool: 'highlighter', color: '#facc15', width: 24 })
    expect(strokes[0]?.points[0]).toEqual({ x: 500, y: 281.25 })
    expect(strokes[0]?.points[1]).toEqual({ x: 1000, y: 562.5 })
  })

  it('disabled 时忽略 pointer 输入', async () => {
    const wrapper = mount(DrawingLayer, { props: { strokes: [], enabled: false } })
    wrapper
      .get('svg')
      .element.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 1, clientY: 1 }),
      )
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:strokes')).toBeUndefined()
  })
})
