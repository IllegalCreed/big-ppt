/**
 * Phase 14 Task C:ExportModal 组件单测。
 *
 * 走 SettingsModal.save.test.ts 同套路:Teleport 让 VueTestUtils wrapper.find
 * 找不到节点,改用 document.querySelector + 用 mount({ attachTo: document.body })。
 *
 * mock useExport composable —— 我们关心 modal 的 UI 行为(radio + button + progress
 * + error 渲染),不关心 useExport 的内部实现(那是 useExport.test.ts 的职责)。
 *
 * 关键 case:
 * - 默认 PDF radio 选中
 * - 切 radio 后点确认 → useExport.exportDeck 收到对应 format
 * - exporting=true 时按钮 disabled + 进度文本可见
 * - error 非空 + exporting=false → 错误文本 + retry 按钮渲染,retry 可调 exportDeck
 * - exporting=true 时 close 按钮 disabled
 * - 成功后 200ms 自动 emit close
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

// ── useExport mock ────────────────────────────────────────────────────────
const exportingRef = ref(false)
const errorRef = ref<string | null>(null)
const progressRef = ref<{ done: number; total: number } | null>(null)
const exportDeckMock = vi.fn<(deck: unknown, format: string) => Promise<void>>()

vi.mock('../../composables/useExport', () => ({
  useExport: () => ({
    exporting: exportingRef,
    error: errorRef,
    progress: progressRef,
    exportDeck: exportDeckMock,
  }),
}))

import ExportModal from '../ExportModal.vue'

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

function $$(sel: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll(sel)) as HTMLElement[]
}

async function click(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

const defaultDeck = {
  id: 1,
  title: 'My Deck',
  markdown: '# x',
  templateId: 'beitou-standard',
  totalPages: 3,
}

describe('ExportModal', () => {
  beforeEach(() => {
    exportingRef.value = false
    errorRef.value = null
    progressRef.value = null
    exportDeckMock.mockReset()
    exportDeckMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('open=false → modal 不渲染(只渲染空 Teleport target)', async () => {
    const wrapper = mount(ExportModal, {
      props: { open: false, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    expect($('.modal-overlay')).toBeNull()
    wrapper.unmount()
  })

  it('open=true → 渲染 modal + 默认 PDF radio 选中', async () => {
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    expect($('.modal-overlay')).not.toBeNull()
    const pdfRadio = $('[data-test="format-pdf"]') as HTMLInputElement
    expect(pdfRadio).not.toBeNull()
    expect(pdfRadio.checked).toBe(true)

    wrapper.unmount()
  })

  it('点确认 → useExport.exportDeck 收到 deck + 默认 format=pdf', async () => {
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    await click($('[data-test="confirm-button"]')!)

    expect(exportDeckMock).toHaveBeenCalledTimes(1)
    expect(exportDeckMock.mock.calls[0]![0]).toEqual(defaultDeck)
    expect(exportDeckMock.mock.calls[0]![1]).toBe('pdf')

    wrapper.unmount()
  })

  it('切 radio 到 PPTX → 点确认 → exportDeck 收到 format=pptx', async () => {
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    const pptxRadio = $('[data-test="format-pptx"]') as HTMLInputElement
    pptxRadio.checked = true
    pptxRadio.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    await click($('[data-test="confirm-button"]')!)

    expect(exportDeckMock.mock.calls[0]![1]).toBe('pptx')

    wrapper.unmount()
  })

  it('切 radio 到 PNG-zip → 点确认 → exportDeck 收到 format=png-zip', async () => {
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    const zipRadio = $('[data-test="format-png-zip"]') as HTMLInputElement
    zipRadio.checked = true
    zipRadio.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    await click($('[data-test="confirm-button"]')!)

    expect(exportDeckMock.mock.calls[0]![1]).toBe('png-zip')

    wrapper.unmount()
  })

  it('exporting=true → 确认 / 取消 / 关闭 / radio 全 disabled + 进度文本可见', async () => {
    exportingRef.value = true
    progressRef.value = { done: 2, total: 5 }
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    expect(($('[data-test="confirm-button"]') as HTMLButtonElement).disabled).toBe(true)
    expect(($('[data-test="cancel-button"]') as HTMLButtonElement).disabled).toBe(true)
    expect(($('.close-btn') as HTMLButtonElement).disabled).toBe(true)
    // radio 全部 disabled
    const radios = $$('input[type="radio"]')
    expect(radios.length).toBe(3)
    radios.forEach((r) => expect((r as HTMLInputElement).disabled).toBe(true))

    // 进度文本含「第 2/5 页」
    const progressText = $('[data-test="export-progress"]')
    expect(progressText).not.toBeNull()
    expect(progressText!.textContent).toContain('2/5')

    wrapper.unmount()
  })

  it('exporting=true 时点 close 按钮 → 不 emit update:open', async () => {
    exportingRef.value = true
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    await click($('.close-btn')!)
    expect(wrapper.emitted('update:open')).toBeFalsy()

    // 取消按钮同理
    await click($('[data-test="cancel-button"]')!)
    expect(wrapper.emitted('update:open')).toBeFalsy()

    wrapper.unmount()
  })

  it('error 设值 + exporting=false → 错误文本 + retry 按钮可见 + 点 retry 再调 exportDeck', async () => {
    errorRef.value = 'fonts 加载超时'
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    const errorRow = $('[data-test="export-error"]')
    expect(errorRow).not.toBeNull()
    expect(errorRow!.textContent).toContain('fonts 加载超时')

    const retry = $('[data-test="retry-button"]') as HTMLButtonElement
    expect(retry).not.toBeNull()
    await click(retry)
    expect(exportDeckMock).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('成功 exportDeck → 200ms 内 emit update:open=false', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    // 直接调 vm 内的 onConfirm 等价 click + await(用 fake timer 时 click 也得 advance)
    await click($('[data-test="confirm-button"]')!)
    // exportDeckMock resolved → setTimeout(emit, 200)
    expect(wrapper.emitted('update:open')).toBeFalsy()

    vi.advanceTimersByTime(200)
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeTruthy()
    expect(wrapper.emitted('update:open')![0]).toEqual([false])

    wrapper.unmount()
  })

  it('exportDeck 抛 → modal 不关闭 + 错误态由 useExport 内部 error.value 渲染', async () => {
    exportDeckMock.mockImplementationOnce(async () => {
      errorRef.value = '内部错误'
      throw new Error('内部错误')
    })
    const wrapper = mount(ExportModal, {
      props: { open: true, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    await click($('[data-test="confirm-button"]')!)
    await flushPromises()

    // 不 emit close
    expect(wrapper.emitted('update:open')).toBeFalsy()
    // 错误态渲染(error 非空 + exporting=false 时)
    expect($('[data-test="export-error"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('open 由 false → true 应重置 format 到 pdf + 清 error', async () => {
    errorRef.value = '旧错误'
    const wrapper = mount(ExportModal, {
      props: { open: false, deck: defaultDeck },
      attachTo: document.body,
    })
    await flushPromises()

    await wrapper.setProps({ open: true })
    await flushPromises()

    const pdfRadio = $('[data-test="format-pdf"]') as HTMLInputElement
    expect(pdfRadio.checked).toBe(true)
    expect(errorRef.value).toBeNull()

    wrapper.unmount()
  })
})
