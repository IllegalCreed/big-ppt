/**
 * Phase 15 Task 31-E:DeckListPage 导入入口单测。
 *
 * mock useAuth / useDecks / useImport / vue-router(useRouter.push) + lucide
 * 图标(图标 import 在 jsdom 不耗时,但显式 stub 可让快照更稳)。只验:
 * - 导入按钮可见 + data-test="import-button"
 * - 隐藏 file input 存在 + accept=".lumideck"
 * - 触发 file change(programmatic 派 change 事件)→ importArchive 收 file +
 *   useRouter().push(`/decks/<新 id>`) 被调
 * - importArchive 抛错 → error 文本节点出现(data-test="import-error")
 * - importing=true → 按钮 disabled + 文本切「导入中…」
 *
 * Vue Test Utils 不跨 Teleport;DeckListPage 自身不用 Teleport 但
 * TemplatePickerModal 子组件用,本 spec stub 掉 picker modal 避免污染。
 *
 * vitest 4 顶层 vi.mock 同步 factory(CLAUDE.md 已知坑);所有 mock 顶在 import 前。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// ── useAuth mock ────────────────────────────────────────────────────────
const currentUserRef = ref<{ id: number; email: string; hasLlmSettings: boolean } | null>({
  id: 1,
  email: 't@x.com',
  hasLlmSettings: true,
})
const logoutMock = vi.fn(async () => {})
vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({
    currentUser: currentUserRef,
    logout: logoutMock,
  }),
}))

// ── useDecks mock ───────────────────────────────────────────────────────
const listDecksMock = vi.fn(async () => [])
const deleteDeckMock = vi.fn(async () => {})
const updateDeckMock = vi.fn(async () => ({}))
vi.mock('../../composables/useDecks', () => ({
  useDecks: () => ({
    listDecks: listDecksMock,
    deleteDeck: deleteDeckMock,
    updateDeck: updateDeckMock,
  }),
}))

// ── useImport mock ──────────────────────────────────────────────────────
const importingRef = ref(false)
const importErrorRef = ref<string | null>(null)
const importArchiveMock = vi.fn<(file: File) => Promise<{ deckId: number; title: string }>>()
vi.mock('../../composables/useImport', () => ({
  useImport: () => ({
    importing: importingRef,
    error: importErrorRef,
    importArchive: importArchiveMock,
  }),
}))

// ── useRouter mock ──────────────────────────────────────────────────────
const routerPushMock = vi.fn<(path: string) => Promise<void>>()
const routerReplaceMock = vi.fn<(path: string) => Promise<void>>()
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
  }),
}))

// ── TemplatePickerModal stub:DeckListPage 引用了它,但本 spec 不测 picker ──
vi.mock('../../components/TemplatePickerModal.vue', () => ({
  default: { name: 'TemplatePickerModalStub', template: '<div />' },
}))

// ── ApiError(被 catch 引用) ────────────────────────────────────────────
vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {},
}))

// 现在 import 被测体
import DeckListPage from '../DeckListPage.vue'

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

describe('DeckListPage 导入入口', () => {
  beforeEach(() => {
    importingRef.value = false
    importErrorRef.value = null
    importArchiveMock.mockReset()
    routerPushMock.mockReset()
    routerPushMock.mockResolvedValue(undefined as never)
    listDecksMock.mockReset()
    listDecksMock.mockResolvedValue([])
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('render → 导入按钮可见 + 隐藏 file input accept=".lumideck"', async () => {
    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const btn = $('[data-test="import-button"]')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain('导入')

    const input = $('[data-test="import-file-input"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input!.type).toBe('file')
    expect(input!.accept).toBe('.lumideck')
    // 隐藏(display: none),用户视觉不可见但 programmatic accessible
    expect(input!.style.display).toBe('none')

    wrapper.unmount()
  })

  it('触发 file change → importArchive 被调 + router.push(/decks/<新 id>)', async () => {
    importArchiveMock.mockResolvedValueOnce({ deckId: 42, title: 'New(导入)' })

    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const input = $('[data-test="import-file-input"]') as HTMLInputElement
    const file = new File(['fake-zip'], 'demo.lumideck', { type: 'application/zip' })
    // jsdom 允许 Object.defineProperty 给 files 设 FileList-like;
    // 用 DataTransfer fallback 不可,直接 defineProperty
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file] as unknown as FileList,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(importArchiveMock).toHaveBeenCalledTimes(1)
    expect(importArchiveMock.mock.calls[0]![0]).toBe(file)
    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock.mock.calls[0]![0]).toBe('/decks/42')

    wrapper.unmount()
  })

  it('importArchive 抛错 → router.push 不调 + error 文本仍依赖 reactive ref', async () => {
    // 模拟 useImport 真实行为:抛错前先 set error.value
    importArchiveMock.mockImplementationOnce(async () => {
      importErrorRef.value = '数据包损坏'
      throw new Error('数据包损坏')
    })

    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const input = $('[data-test="import-file-input"]') as HTMLInputElement
    const file = new File(['bad'], 'bad.lumideck')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file] as unknown as FileList,
    })

    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(routerPushMock).not.toHaveBeenCalled()
    // error 节点渲染
    const errNode = $('[data-test="import-error"]')
    expect(errNode).not.toBeNull()
    expect(errNode!.textContent).toContain('数据包损坏')

    wrapper.unmount()
  })

  it('importing=true → 按钮 disabled + 文本「导入中…」', async () => {
    importingRef.value = true

    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const btn = $('[data-test="import-button"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('导入中…')

    wrapper.unmount()
  })

  it('点导入按钮 → 触发隐藏 input.click()', async () => {
    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const input = $('[data-test="import-file-input"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    const btn = $('[data-test="import-button"]') as HTMLButtonElement
    btn.click()
    await flushPromises()

    expect(clickSpy).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('选空文件(用户取消文件选择)→ importArchive 不调', async () => {
    const wrapper = mount(DeckListPage, { attachTo: document.body })
    await flushPromises()

    const input = $('[data-test="import-file-input"]') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [] as unknown as FileList,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(importArchiveMock).not.toHaveBeenCalled()
    expect(routerPushMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})
