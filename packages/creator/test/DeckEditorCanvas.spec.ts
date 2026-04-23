import { describe, expect, it, vi } from 'vitest'

// 子组件链条里有 antdv-next → dayjs/plugin/* 的 ESM 后缀兼容性问题，
// 跑 Canvas 的 title 测试不需要真渲染它们，统一 vi.mock 成 noop。
// vi.mock 会被 vitest 提升到文件顶部。
vi.mock('../src/components/SettingsModal.vue', () => ({
  default: { name: 'SettingsModal', render: () => null, props: ['open'] },
}))
vi.mock('../src/components/ChatPanel.vue', () => ({
  default: { name: 'ChatPanel', render: () => null },
}))
vi.mock('../src/components/SlidePreview.vue', () => ({
  default: { name: 'SlidePreview', render: () => null },
}))
vi.mock('../src/components/VersionTimeline.vue', () => ({
  default: {
    name: 'VersionTimeline',
    render: () => null,
    props: ['deckId', 'currentVersionId', 'open'],
  },
}))

import { mount, flushPromises } from '@vue/test-utils'
import DeckEditorCanvas from '../src/components/DeckEditorCanvas.vue'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import type { Deck, DeckVersion } from '../src/composables/useDecks'

useMsw()

const deck: Deck = {
  id: 42,
  userId: 1,
  title: '初始标题',
  themeId: 'default',
  currentVersionId: 100,
  status: 'active',
  createdAt: '2026-04-23T00:00:00Z',
  updatedAt: '2026-04-23T00:00:00Z',
}
const currentVersion: DeckVersion = {
  id: 100,
  deckId: 42,
  content: '---\n---\n# Test',
  message: 'initial',
  turnId: null,
  authorId: 1,
  createdAt: '2026-04-23T00:00:00Z',
}

function mountIt() {
  // chats / versions GET 默认返空，避免 MSW onUnhandledRequest:error 中断
  server.use(
    http.get('/api/decks/42/chats', () => HttpResponse.json({ chats: [] })),
    http.get('/api/decks/42/versions', () => HttpResponse.json({ versions: [] })),
  )
  return mount(DeckEditorCanvas, {
    props: { deck: { ...deck }, currentVersion },
  })
}

describe('DeckEditorCanvas · title inline 编辑', () => {
  it('默认渲染 displayTitle', async () => {
    const wrapper = mountIt()
    await flushPromises()
    expect(wrapper.text()).toContain('初始标题')
  })

  it('双击标题 → 进入 input，focus+selected', async () => {
    const wrapper = mountIt()
    await flushPromises()
    const titleDiv = wrapper.find('.deck-title')
    expect(titleDiv.exists()).toBe(true)

    await titleDiv.trigger('dblclick')
    await flushPromises()

    const input = wrapper.find('input.deck-title-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('初始标题')
  })

  it('Enter 保存 → PUT /api/decks/42 → displayTitle 更新', async () => {
    let putCalledWith: unknown = null
    server.use(
      http.put('/api/decks/42', async ({ request }) => {
        putCalledWith = await request.json()
        return HttpResponse.json({ deck: { ...deck, title: '新标题' } })
      }),
    )
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('.deck-title').trigger('dblclick')
    await flushPromises()

    const input = wrapper.find('input.deck-title-input')
    await input.setValue('新标题')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(putCalledWith).toEqual({ title: '新标题' })
    expect(wrapper.text()).toContain('新标题')
    // Input 消失，回到只读 title
    expect(wrapper.find('input.deck-title-input').exists()).toBe(false)
  })

  it('Esc 取消编辑 → displayTitle 保持原值，无 PUT', async () => {
    let putCalled = false
    server.use(
      http.put('/api/decks/42', () => {
        putCalled = true
        return HttpResponse.json({ deck })
      }),
    )
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('.deck-title').trigger('dblclick')
    await flushPromises()
    const input = wrapper.find('input.deck-title-input')
    await input.setValue('不要保存')
    await input.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(putCalled).toBe(false)
    expect(wrapper.find('input.deck-title-input').exists()).toBe(false)
    expect(wrapper.text()).toContain('初始标题')
  })

  it('API 出错 → 副标题行显示错误文案 + input 仍开着', async () => {
    server.use(
      http.put('/api/decks/42', () =>
        HttpResponse.json({ error: '重名已存在' }, { status: 409 }),
      ),
    )
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('.deck-title').trigger('dblclick')
    await flushPromises()
    const input = wrapper.find('input.deck-title-input')
    await input.setValue('冲突名')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    // 错误文案在副标题行
    expect(wrapper.find('.title-error').text()).toBe('重名已存在')
    // input 保持打开供用户修正
    expect(wrapper.find('input.deck-title-input').exists()).toBe(true)
  })
})
