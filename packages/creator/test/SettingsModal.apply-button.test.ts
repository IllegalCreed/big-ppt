/** Phase 12.7 commit 3f33d76:Settings 应用按钮 + ✓ 已应用 flash 组件级测试。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import SettingsModal from '../src/components/SettingsModal.vue'

useMsw()

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

function $all(sel: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll(sel)) as HTMLElement[]
}

async function setInput(el: HTMLElement, value: string): Promise<void> {
  const input = el as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

async function click(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

function defaultHandlers() {
  return [
    http.get('/api/auth/llm-settings', () =>
      HttpResponse.json({
        activeProvider: 'zhipu',
        providers: { zhipu: { hasApiKey: true, model: 'GLM-5.1' } },
        provider: 'zhipu',
        model: 'GLM-5.1',
        baseUrl: null,
        apiType: 'openai-compatible',
        hasApiKey: true,
      }),
    ),
    http.get('/api/image-llm-settings', () =>
      HttpResponse.json({ provider: 'openai', baseUrl: null, model: null, hasApiKey: false }),
    ),
    http.get('/api/mcp/servers', () => HttpResponse.json({ success: true, servers: [] })),
  ]
}

describe('SettingsModal applied-flash + footer 按钮组件级测试', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('LLM tab footer 含 3 按钮:取消 / 应用 / 保存并关闭', async () => {
    server.use(...defaultHandlers())
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // 默认进 LLM tab
    const footerButtons = $all('.modal-footer button')
    const labels = footerButtons.map((b) => b.textContent?.trim() ?? '')
    expect(labels).toEqual(['取消', '应用', '保存并关闭'])

    wrapper.unmount()
  })

  it('生图 tab footer 含 3 按钮:取消 / 应用 / 保存并关闭', async () => {
    server.use(...defaultHandlers())
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // 切到 image tab
    const imageTab = $all('.seg-tab').find((b) => b.textContent?.includes('生图模型'))!
    await click(imageTab)

    const footerButtons = $all('.modal-footer button')
    const labels = footerButtons.map((b) => b.textContent?.trim() ?? '')
    expect(labels).toEqual(['取消', '应用', '保存并关闭'])

    wrapper.unmount()
  })

  it('MCP tab footer 只 1 按钮:关闭(MCP 自动保存,无 apply/save)', async () => {
    server.use(...defaultHandlers())
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const mcpTab = $all('.seg-tab').find((b) => b.textContent?.includes('MCP Servers'))!
    await click(mcpTab)

    const footerButtons = $all('.modal-footer button')
    expect(footerButtons.length).toBe(1)
    expect(footerButtons[0]!.textContent?.trim()).toBe('关闭')

    wrapper.unmount()
  })

  it('LLM tab 点「应用」→ .applied-flash span 出现 + 含「✓ 已应用」文案', async () => {
    server.use(
      ...defaultHandlers(),
      http.put('/api/auth/llm-settings', () => HttpResponse.json({ ok: true })),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // 默认已配 zhipu(hasApiKey=true),无需填 key 直接点应用
    await click($('[data-test="apply-button"]')!)
    const flash = $('.applied-flash')
    expect(flash).not.toBeNull()
    expect(flash!.textContent).toContain('✓ 已应用')

    wrapper.unmount()
  })

  it('.applied-flash 有 a11y 属性:role=status + aria-live=polite', async () => {
    server.use(
      ...defaultHandlers(),
      http.put('/api/auth/llm-settings', () => HttpResponse.json({ ok: true })),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    await click($('[data-test="apply-button"]')!)
    const flash = $('.applied-flash')!
    expect(flash.getAttribute('role')).toBe('status')
    expect(flash.getAttribute('aria-live')).toBe('polite')

    wrapper.unmount()
  })

  it('LLM tab 应用后 2s 边界:推进 2001ms → flash v-if=false 移除', async () => {
    server.use(
      ...defaultHandlers(),
      http.put('/api/auth/llm-settings', () => HttpResponse.json({ ok: true })),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    vi.useFakeTimers()
    await click($('[data-test="apply-button"]')!)
    expect($('.applied-flash')).not.toBeNull()

    vi.advanceTimersByTime(2_001)
    await flushPromises()
    expect($('.applied-flash')).toBeNull()

    wrapper.unmount()
  })

  it('saving=true 时「应用」+「保存并关闭」按钮 disabled(防双击)', async () => {
    let resolvePut: (() => void) | null = null
    server.use(
      ...defaultHandlers(),
      http.put('/api/auth/llm-settings', async () => {
        // 永不 resolve,让 saving 状态卡在 true
        await new Promise<void>((res) => {
          resolvePut = res
        })
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const applyBtn = $('[data-test="apply-button"]') as HTMLButtonElement
    const saveBtn = $('[data-test="save-button"]') as HTMLButtonElement
    // 初始未 disabled
    expect(applyBtn.disabled).toBe(false)
    expect(saveBtn.disabled).toBe(false)

    // 点应用 → saving=true,按钮 disabled(in-flight PUT 不 resolve)
    await click(applyBtn)
    expect(applyBtn.disabled).toBe(true)
    expect(saveBtn.disabled).toBe(true)
    // 文案变「保存中...」
    expect(applyBtn.textContent?.trim()).toBe('保存中...')
    expect(saveBtn.textContent?.trim()).toBe('保存中...')

    // 释放 PUT 让 wrapper 别卡 unmount
    resolvePut?.()
    await flushPromises()

    wrapper.unmount()
  })

  it('生图 tab saving=true 时「应用」+「保存并关闭」按钮 disabled', async () => {
    let resolvePut: (() => void) | null = null
    server.use(
      ...defaultHandlers(),
      http.put('/api/image-llm-settings', async () => {
        await new Promise<void>((res) => {
          resolvePut = res
        })
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // 切到 image tab + 填 apiKey
    const imageTab = $all('.seg-tab').find((b) => b.textContent?.includes('生图模型'))!
    await click(imageTab)
    const imageApiKeyInput = $('.input-group__input') as HTMLInputElement
    await setInput(imageApiKeyInput, 'sk-image-disabled-test')

    const footerButtons = $all('.modal-footer button')
    const applyBtn = footerButtons.find(
      (b) => b.textContent?.includes('应用'),
    ) as HTMLButtonElement
    const saveBtn = footerButtons.find(
      (b) => b.textContent?.includes('保存并关闭'),
    ) as HTMLButtonElement

    expect(applyBtn.disabled).toBe(false)
    expect(saveBtn.disabled).toBe(false)

    await click(applyBtn)
    expect(applyBtn.disabled).toBe(true)
    expect(saveBtn.disabled).toBe(true)
    expect(applyBtn.textContent?.trim()).toBe('保存中...')
    expect(saveBtn.textContent?.trim()).toBe('保存中...')

    resolvePut?.()
    await flushPromises()

    wrapper.unmount()
  })

  it('点取消按钮 → emit update:open=false(不调 PUT)', async () => {
    let putCalled = false
    server.use(
      ...defaultHandlers(),
      http.put('/api/auth/llm-settings', () => {
        putCalled = true
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const cancelBtn = $all('.modal-footer button').find((b) => b.textContent?.trim() === '取消')!
    await click(cancelBtn)

    expect(wrapper.emitted('update:open')).toBeTruthy()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(putCalled).toBe(false)

    wrapper.unmount()
  })
})
