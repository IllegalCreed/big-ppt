/**
 * Phase 12.5 Task D：SettingsModal 的 model 字段从普通 input 升级到 datalist combobox。
 *
 * 验证：
 * - focus model input 后调 /api/llm/models?provider=<id> 拿候选并填 datalist
 * - 用户可自由输入 dropdown 外的 model id（datalist 不强制 input value 在 options 里）
 * - 接口返空时 datalist 为空，但 input 仍可写入（fallback 提示走 placeholder）
 * - cache：再次 focus 不重复 fetch
 *
 * SettingsModal 用 Teleport（modal-overlay 渲染到 body）—— 测试 attachTo: body 并通过
 * `document.body.querySelector` 查 DOM，参考 SettingsModal.save.test.ts 同套路。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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

async function click(el: HTMLElement): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

/**
 * 渐进披露 UX:未配置 provider 默认只渲染单行,model input 要点「配置」展开内嵌
 * form 后才存在;model dropdown 测试针对 openai / mistral 等非 active provider,
 * empty 起始态(active=zhipu)下必须先展开。
 */
async function expandUnconfigured(providerId: string): Promise<void> {
  const btn = document.body.querySelector(
    `[data-test="configure-${providerId}"]`,
  ) as HTMLElement | null
  if (!btn) {
    throw new Error(`expandUnconfigured(${providerId}): 找不到「配置」按钮`)
  }
  await click(btn)
}

function defaultGetHandlers() {
  return [
    http.get('/api/auth/llm-settings', () =>
      HttpResponse.json({
        activeProvider: null,
        providers: {},
        provider: null,
        model: null,
        baseUrl: null,
        hasApiKey: false,
      }),
    ),
    http.get('/api/image-llm-settings', () =>
      HttpResponse.json({ provider: 'openai', baseUrl: null, model: null, hasApiKey: false }),
    ),
    http.get('/api/mcp/servers', () => HttpResponse.json({ success: true, servers: [] })),
  ]
}

describe('SettingsModal model dropdown (Phase 12.5 Task D)', () => {
  let modelsCallCount: Record<string, number> = {}

  beforeEach(() => {
    modelsCallCount = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('focus model input → 调 /api/llm/models 并填入 datalist 选项', async () => {
    server.use(
      ...defaultGetHandlers(),
      http.get('/api/llm/models', ({ request }) => {
        const url = new URL(request.url)
        const provider = url.searchParams.get('provider') ?? ''
        modelsCallCount[provider] = (modelsCallCount[provider] ?? 0) + 1
        if (provider === 'openai') {
          return HttpResponse.json({
            models: [
              { id: 'gpt-4o', name: 'GPT-4o' },
              { id: 'gpt-5.2', name: 'GPT-5.2' },
            ],
          })
        }
        return HttpResponse.json({ models: [] })
      }),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    // empty 起始态:openai 在未配置区,先展开内嵌 form 才能 query model input
    await expandUnconfigured('openai')
    const input = $('[data-test="model-openai"]') as HTMLInputElement
    expect(input).not.toBeNull()
    // 触发 focus → loadModelsIfNeeded('openai')
    input.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    // datalist option 已渲染（query datalist by id）
    const datalist = document.body.querySelector('#model-options-openai') as HTMLDataListElement | null
    expect(datalist).not.toBeNull()
    const opts = Array.from(datalist!.querySelectorAll('option'))
    expect(opts.map((o) => o.value)).toEqual(['gpt-4o', 'gpt-5.2'])
    expect(modelsCallCount.openai).toBe(1)

    wrapper.unmount()
  })

  it('用户可自由输入 dropdown 外的 model id（combobox 行为）', async () => {
    server.use(
      ...defaultGetHandlers(),
      http.get('/api/llm/models', () =>
        HttpResponse.json({ models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }),
      ),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    await expandUnconfigured('openai')
    const input = $('[data-test="model-openai"]') as HTMLInputElement
    input.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()
    // 输入 dropdown 列表外的 custom-model id —— datalist 不约束 input value
    await setInput(input, 'custom-model-xyz')
    expect(input.value).toBe('custom-model-xyz')

    wrapper.unmount()
  })

  it('接口返空 → datalist 为空，input 仍可写入（fallback）', async () => {
    server.use(
      ...defaultGetHandlers(),
      http.get('/api/llm/models', () => HttpResponse.json({ models: [] })),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    await expandUnconfigured('mistral')
    const input = $('[data-test="model-mistral"]') as HTMLInputElement
    input.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()
    const datalist = document.body.querySelector('#model-options-mistral') as HTMLDataListElement | null
    expect(datalist).not.toBeNull()
    expect(datalist!.querySelectorAll('option').length).toBe(0)
    // input 仍可写入
    await setInput(input, 'mistral-medium-latest')
    expect(input.value).toBe('mistral-medium-latest')
    // placeholder 显示 catalog defaultModel 提示
    expect(input.getAttribute('placeholder')).toContain('mistral-large-latest')

    wrapper.unmount()
  })

  it('cache：再次 focus 同 provider 不重复 fetch', async () => {
    server.use(
      ...defaultGetHandlers(),
      http.get('/api/llm/models', ({ request }) => {
        const url = new URL(request.url)
        const provider = url.searchParams.get('provider') ?? ''
        modelsCallCount[provider] = (modelsCallCount[provider] ?? 0) + 1
        return HttpResponse.json({ models: [{ id: 'gpt-4o', name: 'GPT-4o' }] })
      }),
    )
    const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    await expandUnconfigured('openai')
    const input = $('[data-test="model-openai"]') as HTMLInputElement
    input.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    input.dispatchEvent(new Event('focus', { bubbles: true }))
    await flushPromises()

    expect(modelsCallCount.openai).toBe(1)

    wrapper.unmount()
  })
})
