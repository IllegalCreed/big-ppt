import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import DeckRenderer from './DeckRenderer.vue'

/**
 * 测试时 unplugin-vue-components 不参与（vitest 跑独立 vite config），layout 名
 * 走 `<component :is="字符串名">` 查找，需要靠 stubs 提供桩组件。
 */
const beitouStubs = {
  'beitou-cover': {
    template: '<div class="stub-cover">{{ mainTitle }}<slot /></div>',
    props: ['mainTitle', 'subtitle', 'reporter', 'date'],
  },
  'beitou-toc': { template: '<div class="stub-toc"><slot /></div>', props: ['items'] },
  'beitou-section-title': {
    template: '<div class="stub-section">{{ chapterTitle }}<slot /></div>',
    props: ['chapterNumber', 'chapterTitle'],
  },
  'beitou-content': {
    template: '<div class="stub-content">{{ heading }}<slot /></div>',
    props: ['heading'],
  },
  'beitou-back-cover': {
    template: '<div class="stub-back">{{ message }}<slot /></div>',
    props: ['message'],
  },
}

function loadStarter(): string {
  // vitest root = packages/creator；jsdom env 下 import.meta.url 不一定是 file://，
  // 用 cwd 拼绝对路径
  const p = resolve(process.cwd(), '../slidev/templates/beitou-standard/starter.md')
  return readFileSync(p, 'utf8')
}

describe('DeckRenderer', () => {
  it('渲染北投 starter 全部 5 页', () => {
    const w = mount(DeckRenderer, {
      props: { markdown: loadStarter(), templateId: 'beitou-standard' },
      global: { stubs: beitouStubs },
    })
    expect(w.findAll('.slide-canvas')).toHaveLength(5)
    expect(w.find('.stub-cover').exists()).toBe(true)
    expect(w.find('.stub-back').exists()).toBe(true)
  })

  it('currentPage=2 只渲染第 2 页（toc）', () => {
    const w = mount(DeckRenderer, {
      props: { markdown: loadStarter(), templateId: 'beitou-standard', currentPage: 2 },
      global: { stubs: beitouStubs },
    })
    expect(w.findAll('.slide-canvas')).toHaveLength(1)
    expect(w.find('.stub-toc').exists()).toBe(true)
    expect(w.find('.stub-cover').exists()).toBe(false)
  })

  it('frontmatter 字段通过 v-bind 透传到 layout props', () => {
    const w = mount(DeckRenderer, {
      props: {
        markdown: '---\nlayout: beitou-cover\nmainTitle: HelloT\n---',
        templateId: 'beitou-standard',
      },
      global: { stubs: beitouStubs },
    })
    expect(w.find('.stub-cover').text()).toBe('HelloT')
  })

  it('currentPage 越界（>页数）：渲染 0 个 slide-canvas，不报错', () => {
    const w = mount(DeckRenderer, {
      props: { markdown: loadStarter(), templateId: 'beitou-standard', currentPage: 99 },
      global: { stubs: beitouStubs },
    })
    expect(w.findAll('.slide-canvas')).toHaveLength(0)
  })

  it('templateId 切换：根 class 同步变 jingyeda-template', () => {
    const w = mount(DeckRenderer, {
      props: { markdown: loadStarter(), templateId: 'jingyeda-standard' },
      global: { stubs: beitouStubs },  // beitou-* layout 在 jingyeda 测试里没意义
    })
    const canvases = w.findAll('.slide-canvas')
    expect(canvases.length).toBe(5)
    expect(canvases[0]?.classes()).toContain('jingyeda-template')
  })
})
