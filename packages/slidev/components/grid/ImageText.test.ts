import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import ImageText from './ImageText.vue'

describe('ImageText', () => {
  it('image src + text slot 各自渲染', () => {
    const wrapper = mountWithTokens(ImageText, {
      props: { image: '/templates/foo/hero.png', alt: 'Hero' },
      slots: { text: '<p data-test="T">说明文字</p>' },
    })
    const img = wrapper.find('img.ld-image')
    expect(img.attributes('src')).toBe('/templates/foo/hero.png')
    expect(img.attributes('alt')).toBe('Hero')
    expect(wrapper.find('[data-test="T"]').text()).toBe('说明文字')
  })

  it('direction="image-right" 标注 data 属性触发 CSS 翻转', () => {
    const left = mountWithTokens(ImageText, {
      props: { image: '/x.png', direction: 'image-left' },
    })
    expect(left.find('.ld-image-text').attributes('data-direction')).toBe('image-left')

    const right = mountWithTokens(ImageText, {
      props: { image: '/x.png', direction: 'image-right' },
    })
    expect(right.find('.ld-image-text').attributes('data-direction')).toBe('image-right')
  })

  it('imageBorder="none" 时 wrap border-width 写为 0', () => {
    const wrapper = mountWithTokens(ImageText, {
      props: { image: '/x.png', imageBorder: 'none' },
    })
    const wrap = wrapper.find('.ld-image-wrap')
    expect(wrap.attributes('style')).toContain('border-width: 0')
  })
})
