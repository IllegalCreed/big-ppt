/**
 * Phase 12 Task J:Settings UI 保存流程测试。
 *
 * 用 MSW 拦 PUT /api/auth/llm-settings,验证保存按钮点击时:
 * - 发送的 payload 是**新 shape**(activeProvider + providers map + 可选 advanced)
 * - 未配置的 provider 不进 payload
 * - active provider 未配 key → 拒绝保存(client-side validation 抛错)
 * - 保存后 modal 关闭(emit update:open=false)
 * - advanced 字段按 active provider 过滤(active=anthropic 时只发 anthropic 子区)
 *
 * SettingsModal 用 Teleport,改用 document.body.querySelector 查 DOM。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import SettingsModal from '../src/components/SettingsModal.vue'

useMsw()

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

async function setInput(el: HTMLElement, value: string): Promise<void> {
  const input = el as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
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

/**
 * 渐进披露 UX:未配置 provider 默认只渲染单行(name + family badge + 「配置」按钮),
 * 点「配置」按钮才内嵌展开紧凑 form(apikey / model / baseUrl)。测试要给未配置
 * provider 填字段前必须先点这一下。
 */
async function expandUnconfigured(providerId: string): Promise<void> {
  const btn = $(`[data-test="configure-${providerId}"]`)
  if (!btn) {
    throw new Error(
      `expandUnconfigured(${providerId}): 找不到「配置」按钮(可能 provider 已是 active 或已配置)`,
    )
  }
  await click(btn)
}

function defaultHandlers(initialState: 'empty' | 'configured-zhipu' | 'multi' = 'empty') {
  let getResponse: unknown = {
    activeProvider: null,
    providers: {},
    provider: null,
    model: null,
    baseUrl: null,
    apiType: null,
    hasApiKey: false,
  }
  if (initialState === 'configured-zhipu') {
    getResponse = {
      activeProvider: 'zhipu',
      providers: { zhipu: { hasApiKey: true, model: 'GLM-5.1' } },
      provider: 'zhipu',
      model: 'GLM-5.1',
      baseUrl: null,
      apiType: 'openai-compatible',
      hasApiKey: true,
    }
  } else if (initialState === 'multi') {
    getResponse = {
      activeProvider: 'openai',
      providers: {
        openai: { hasApiKey: true, model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
        anthropic: { hasApiKey: true, model: 'claude-sonnet-4-6' },
      },
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiType: 'openai-compatible',
      hasApiKey: true,
    }
  }

  return [
    http.get('/api/auth/llm-settings', () => HttpResponse.json(getResponse)),
    http.get('/api/image-llm-settings', () =>
      HttpResponse.json({ provider: 'openai', baseUrl: null, model: null, hasApiKey: false }),
    ),
    http.get('/api/mcp/servers', () => HttpResponse.json({ success: true, servers: [] })),
  ]
}

describe('SettingsModal save (PUT new-shape payload)', () => {
  let capturedPayload: unknown = null

  beforeEach(() => {
    capturedPayload = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('点击保存 → PUT /api/auth/llm-settings 带新 shape payload', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', async ({ request }) => {
        capturedPayload = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // 填 zhipu 的 apiKey + 切 active 到 zhipu(默认已经是 zhipu)
    await setInput($('[data-test="apikey-zhipu"]')!, 'sk-new-zhipu')
    await click($('[data-test="save-button"]')!)

    expect(capturedPayload).toEqual({
      activeProvider: 'zhipu',
      providers: {
        zhipu: { apiKey: 'sk-new-zhipu' },
      },
    })
    // close 事件触发
    expect(wrapper.emitted('update:open')).toBeTruthy()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])

    wrapper.unmount()
  })

  it('未配 active provider key → 拒绝保存 + 显示错误', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', async ({ request }) => {
        capturedPayload = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // 不填任何 key 直接点保存
    await click($('[data-test="save-button"]')!)

    expect(capturedPayload).toBeNull() // 没发请求
    expect($('[data-test="save-error"]')).not.toBeNull()
    expect($('[data-test="save-error"]')!.textContent).toContain('API Key')

    wrapper.unmount()
  })

  it('已配 zhipu + 新填 openai → payload 同时含两家;active 仍是 zhipu', async () => {
    server.use(
      ...defaultHandlers('configured-zhipu'),
      http.put('/api/auth/llm-settings', async ({ request }) => {
        capturedPayload = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // openai 此时是「未配置」(initialState=configured-zhipu 只配了 zhipu),
    // 先点「配置」展开内嵌 form 才能填字段
    await expandUnconfigured('openai')
    await setInput($('[data-test="apikey-openai"]')!, 'sk-openai-new')
    await setInput($('[data-test="model-openai"]')!, 'gpt-5.5')
    await click($('[data-test="save-button"]')!)

    expect(capturedPayload).toEqual({
      activeProvider: 'zhipu',
      providers: {
        zhipu: { apiKey: '', model: 'GLM-5.1' }, // 旧 zhipu 的 apiKey 留空表示保留旧值;model 从 GET 预填
        openai: { apiKey: 'sk-openai-new', model: 'gpt-5.5' },
      },
    })

    wrapper.unmount()
  })

  it('切 active 到 anthropic + 配 key + 改 advanced → payload 含 anthropic advanced', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', async ({ request }) => {
        capturedPayload = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // empty 起始态下 anthropic 在未配置区:先点「配置」展开 + 填 key + 设为活跃
    await expandUnconfigured('anthropic')
    await setInput($('[data-test="apikey-anthropic"]')!, 'sk-ant-xxx')
    await setSelect($('.active-provider-select')!, 'anthropic')

    // 展开 advanced + 勾 promptCaching + 改 temperature
    await click($('.advanced-toggle')!)
    await setCheckbox($('[data-test="adv-prompt-caching"]')!, true)
    await setInput($('[data-test="adv-temperature"]')!, '1.2')
    await click($('[data-test="save-button"]')!)

    expect(capturedPayload).toMatchObject({
      activeProvider: 'anthropic',
      providers: {
        anthropic: { apiKey: 'sk-ant-xxx' },
      },
      advanced: {
        anthropic: { promptCaching: true },
        common: { temperature: 1.2 },
      },
    })

    wrapper.unmount()
  })

  it('切 active 到 gemini + 配 key + 勾 jsonMode → payload 含 gemini advanced(不含 anthropic)', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', async ({ request }) => {
        capturedPayload = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    // empty 起始态下 gemini 在未配置区:先展开 inline form
    await expandUnconfigured('gemini')
    await setInput($('[data-test="apikey-gemini"]')!, 'gem-1')
    await setSelect($('.active-provider-select')!, 'gemini')

    await click($('.advanced-toggle')!)
    await setCheckbox($('[data-test="adv-json-mode"]')!, true)
    await click($('[data-test="save-button"]')!)

    expect(capturedPayload).toMatchObject({
      activeProvider: 'gemini',
      providers: { gemini: { apiKey: 'gem-1' } },
      advanced: { gemini: { jsonMode: true } },
    })
    // 不应该有 anthropic 字段
    expect((capturedPayload as { advanced?: { anthropic?: unknown } }).advanced?.anthropic).toBeUndefined()

    wrapper.unmount()
  })

  it('PUT 返 400 → 显示错误信息,modal 不关闭', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', () =>
        HttpResponse.json({ error: '后端校验失败' }, { status: 400 }),
      ),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    await setInput($('[data-test="apikey-zhipu"]')!, 'sk-zhipu')
    await click($('[data-test="save-button"]')!)

    expect($('[data-test="save-error"]')).not.toBeNull()
    expect($('[data-test="save-error"]')!.textContent).toContain('后端校验失败')
    // 没 emit update:open=false
    expect(wrapper.emitted('update:open')).toBeFalsy()

    wrapper.unmount()
  })

  it('GET 返回多 provider → 卡片显示「已配置」徽章', async () => {
    server.use(...defaultHandlers('multi'))
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    const openaiCard = document.body.querySelector(
      '[data-provider-id="openai"]',
    ) as HTMLElement | null
    expect(openaiCard).not.toBeNull()
    expect(openaiCard!.querySelector('.state-ok')).not.toBeNull()

    const anthropicCard = document.body.querySelector(
      '[data-provider-id="anthropic"]',
    ) as HTMLElement | null
    expect(anthropicCard!.querySelector('.state-ok')).not.toBeNull()

    // 未配置的 zhipu
    const zhipuCard = document.body.querySelector(
      '[data-provider-id="zhipu"]',
    ) as HTMLElement | null
    expect(zhipuCard!.querySelector('.state-empty')).not.toBeNull()

    wrapper.unmount()
  })

  it('已配 provider 的卡片 model / baseUrl 字段从 GET response 预填', async () => {
    server.use(...defaultHandlers('multi'))
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    const openaiModel = $('[data-test="model-openai"]') as HTMLInputElement
    expect(openaiModel.value).toBe('gpt-4o')
    const openaiBase = $('[data-test="baseurl-openai"]') as HTMLInputElement
    expect(openaiBase.value).toBe('https://api.openai.com/v1')

    wrapper.unmount()
  })

  it('保存成功后 hasApiKey 视图态升级:input 清空 + 卡片显示「已配置」', async () => {
    server.use(
      ...defaultHandlers('empty'),
      http.put('/api/auth/llm-settings', () => HttpResponse.json({ ok: true })),
    )
    const wrapper = mount(SettingsModal, {
      props: { open: true },
      attachTo: document.body,
    })
    await flushPromises()

    await setInput($('[data-test="apikey-zhipu"]')!, 'sk-zhipu')
    await click($('[data-test="save-button"]')!)
    // emit close 触发后 modal 仍渲染(open prop 没变),保存后 input + 卡片状态都更新

    // 保存后 input 清空,卡片状态升级为「已配置」
    const zhipuKey = $('[data-test="apikey-zhipu"]') as HTMLInputElement
    expect(zhipuKey.value).toBe('')
    const zhipuCard = document.body.querySelector(
      '[data-provider-id="zhipu"]',
    ) as HTMLElement | null
    expect(zhipuCard!.querySelector('.state-ok')).not.toBeNull()

    wrapper.unmount()
  })
})
