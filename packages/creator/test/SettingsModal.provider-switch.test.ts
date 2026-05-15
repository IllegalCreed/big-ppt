/**
 * Phase 12 Task J:Settings UI 切换 active provider 时 advanced 子区切换显示测试。
 *
 * SettingsModal 使用 <Teleport to="body">,Vue Test Utils wrapper.find() 不跨边界;
 * 改用 document.body.querySelector 直查真实 DOM。
 */
import { afterEach, describe, expect, it, beforeEach } from 'vitest'
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

async function setSelect(el: HTMLElement, value: string): Promise<void> {
  const input = el as HTMLSelectElement
  input.value = value
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

async function setCheckbox(el: HTMLElement, checked: boolean): Promise<void> {
  const input = el as HTMLInputElement
  input.checked = checked
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
        providers: {
          zhipu: { hasApiKey: true, model: 'GLM-5.1' },
          anthropic: { hasApiKey: true, model: 'claude-sonnet-4-6' },
          gemini: { hasApiKey: true, model: 'gemini-2.5-flash' },
          openai: { hasApiKey: true, model: 'gpt-4o' },
        },
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

describe('SettingsModal provider switch (active provider advanced sub-block)', () => {
  beforeEach(() => {
    server.use(...defaultHandlers())
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('打开 modal 后默认显示 LLM tab,渐进披露三层：1 个活跃卡片 + 其他已配置折叠组 + 未配置折叠组', async () => {
    // defaultHandlers: activeProvider=zhipu, configured={zhipu,anthropic,gemini,openai}
    // 期望:
    //   - 1 张活跃完整卡片(zhipu, .active)
    //   - 其他已配置组(展开): 3 张紧凑卡片(openai/anthropic/gemini)
    //   - 未配置组(折叠): 8 个列表项(deepseek/moonshot/qwen/mistral/groq/xai/openrouter/cerebras)
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // 默认活跃卡片只有 1 张
    const activeCards = $all('.provider-config-card.active')
    expect(activeCards.length).toBe(1)
    expect(activeCards[0]!.getAttribute('data-provider-id')).toBe('zhipu')

    // 其他已配置组默认展开,渲染 3 张紧凑卡片
    const otherGroup = $('[data-test="other-configured-group"]') as HTMLDetailsElement | null
    expect(otherGroup).not.toBeNull()
    expect(otherGroup!.hasAttribute('open')).toBe(true)
    const compactCards = $all('[data-test="other-configured-group"] .provider-config-card')
    const compactIds = compactCards.map((c) => c.getAttribute('data-provider-id'))
    // PROVIDER_CATALOG 顺序保留:openai/anthropic/gemini
    expect(compactIds).toEqual(['openai', 'anthropic', 'gemini'])

    // 未配置组默认折叠,但 details 内的 8 个 item 仍在 DOM 里(details 只视觉折叠)
    const unconfiguredGroup = $('[data-test="unconfigured-group"]') as HTMLDetailsElement | null
    expect(unconfiguredGroup).not.toBeNull()
    expect(unconfiguredGroup!.hasAttribute('open')).toBe(false)
    const unconfiguredItems = $all('[data-test="unconfigured-group"] .provider-unconfigured-item')
    const unconfiguredIds = unconfiguredItems.map((i) => i.getAttribute('data-provider-id'))
    expect(unconfiguredIds).toEqual([
      'deepseek',
      'moonshot',
      'qwen',
      'mistral',
      'groq',
      'xai',
      'openrouter',
      'cerebras',
    ])

    wrapper.unmount()
  })

  it('展开 Advanced 折叠后:active=zhipu(openai-compatible)→ 只有 common 子区,无专有', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // 默认 active = zhipu(GET 返回的 activeProvider)
    expect($('[data-test="advanced-panel"]')).toBeNull()
    // 点击 toggle 展开
    await click($('.advanced-toggle')!)
    expect($('[data-test="advanced-panel"]')).not.toBeNull()

    // common 子区一定有
    expect($('[data-test="adv-temperature"]')).not.toBeNull()
    expect($('[data-test="adv-max-tokens"]')).not.toBeNull()
    expect($('[data-test="adv-top-p"]')).not.toBeNull()

    // anthropic / gemini 专有子区不应该存在(active 是 zhipu)
    expect($('[data-test="anthropic-advanced"]')).toBeNull()
    expect($('[data-test="gemini-advanced"]')).toBeNull()

    wrapper.unmount()
  })

  it('切到 anthropic active → anthropic-advanced 出现 + gemini-advanced 不在', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()
    await click($('.advanced-toggle')!)
    await setSelect($('.active-provider-select')!, 'anthropic')

    expect($('[data-test="anthropic-advanced"]')).not.toBeNull()
    expect($('[data-test="adv-prompt-caching"]')).not.toBeNull()
    expect($('[data-test="adv-thinking-enabled"]')).not.toBeNull()
    expect($('[data-test="adv-thinking-budget"]')).not.toBeNull()

    expect($('[data-test="gemini-advanced"]')).toBeNull()

    wrapper.unmount()
  })

  it('切到 gemini active → gemini-advanced 出现 + anthropic-advanced 不在', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()
    await click($('.advanced-toggle')!)
    await setSelect($('.active-provider-select')!, 'gemini')

    expect($('[data-test="gemini-advanced"]')).not.toBeNull()
    expect($('[data-test="adv-json-mode"]')).not.toBeNull()
    expect($('[data-test="adv-long-ctx"]')).not.toBeNull()

    expect($('[data-test="anthropic-advanced"]')).toBeNull()

    wrapper.unmount()
  })

  it('切回 openai → 两家专有子区都不应在', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()
    await click($('.advanced-toggle')!)
    await setSelect($('.active-provider-select')!, 'anthropic')
    expect($('[data-test="anthropic-advanced"]')).not.toBeNull()

    await setSelect($('.active-provider-select')!, 'openai')
    expect($('[data-test="anthropic-advanced"]')).toBeNull()
    expect($('[data-test="gemini-advanced"]')).toBeNull()
    // common 子区还在
    expect($('[data-test="adv-temperature"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('thinking budget input 在 thinkingEnabled=false 时 disabled', async () => {
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()
    await click($('.advanced-toggle')!)
    await setSelect($('.active-provider-select')!, 'anthropic')

    const budget = $('[data-test="adv-thinking-budget"]') as HTMLInputElement
    expect(budget.disabled).toBe(true)

    // 勾上 thinkingEnabled,budget 变可写
    await setCheckbox($('[data-test="adv-thinking-enabled"]')!, true)
    expect(budget.disabled).toBe(false)

    wrapper.unmount()
  })
})
