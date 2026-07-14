import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageStyleCard, { type ImageStyleCardItem } from '../ImageStyleCard.vue'

const item: ImageStyleCardItem = {
  id: 'flat-editorial',
  source: 'system',
  name: '扁平编辑插画',
  description: '克制的编辑式插画',
  previewUrl: '/preview.png',
}

describe('ImageStyleCard', () => {
  it('使用 1280×624 固定尺寸并通过 aria-pressed 暴露选中态', () => {
    const wrapper = mount(ImageStyleCard, { props: { item, selected: true } })
    const apply = wrapper.get('.style-card__apply')
    expect(apply.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('img').attributes()).toMatchObject({
      width: '1280',
      height: '624',
      loading: 'lazy',
      decoding: 'async',
    })
  })

  it('保存按钮是整卡 apply 按钮的 sibling，点击保存不会触发 apply', async () => {
    const wrapper = mount(ImageStyleCard, { props: { item, canSave: true } })
    await wrapper.get('button[aria-label="保存扁平编辑插画到我的风格"]').trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('个人风格删除需要二次确认', async () => {
    const wrapper = mount(ImageStyleCard, {
      props: { item: { ...item, source: 'user' }, canManage: true },
    })
    await wrapper.get('button[aria-label="删除风格"]').trigger('click')
    expect(wrapper.text()).toContain('确定删除？')
    expect(wrapper.emitted('delete')).toBeUndefined()
    await wrapper.get('.text-danger').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})
