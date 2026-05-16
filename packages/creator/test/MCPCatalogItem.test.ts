/** MCPCatalogItem 组件:开关 / 复用 LLM Key / 错误友好展示 / sentinel 协议交互单测。 */
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { LLMSettings, McpServerWithStatus } from '@big-ppt/shared'
import MCPCatalogItem from '../src/components/MCPCatalogItem.vue'

const LLM_KEY_SENTINEL = '$LLM_KEY'

function makeServer(overrides: Partial<McpServerWithStatus> = {}): McpServerWithStatus {
  return {
    id: 'zhipu-web-search',
    displayName: '联网搜索(智谱)',
    description: '基于智谱 MCP 的联网搜索',
    url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
    headers: {},
    enabled: false,
    preset: true,
    badge: '搜索',
    status: { state: 'disabled' },
    reuseLlmKey: false,
    ...overrides,
  }
}

function makeLlm(overrides: Partial<LLMSettings> = {}): LLMSettings {
  return {
    provider: 'zhipu',
    apiKey: '',
    model: 'GLM-5.1',
    ...overrides,
  }
}

beforeAll(() => {
  // jsdom 默认无 alert/confirm,toggleEnabled 在缺 key 时调 alert 会报 not implemented
  vi.stubGlobal('alert', vi.fn())
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('MCPCatalogItem', () => {
  it('preset(enabled=false, hasLlmKey=true)→ 渲染开关在关闭态 + 状态显示「未启用」', () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    const toggle = wrapper.find('.mcp-toggle input') as ReturnType<typeof wrapper.find>
    expect(toggle.exists()).toBe(true)
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('未启用')
    // 显示模板名 + badge
    expect(wrapper.text()).toContain('联网搜索(智谱)')
    expect(wrapper.text()).toContain('搜索')
  })

  it('hasLlmKey=true + provider=zhipu + 预置卡 → 展开「配置」后显示「复用 LLM API Key」复选框', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: true,
      },
    })
    // 默认折叠,先展开
    await wrapper.find('.mcp-card__config').trigger('click')
    const reuseLabel = wrapper.find('.mcp-card__reuse')
    expect(reuseLabel.exists()).toBe(true)
    expect(reuseLabel.text()).toContain('复用 LLM API Key')
  })

  it('hasLlmKey=false + provider=zhipu + 预置卡 → 不渲染复用复选框', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: false,
      },
    })
    await wrapper.find('.mcp-card__config').trigger('click')
    expect(wrapper.find('.mcp-card__reuse').exists()).toBe(false)
  })

  it('非智谱 provider(openai)→ 不显示复用复选框(canReuse 只对 zhipu-* 开)', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false }),
        llm: makeLlm({ provider: 'openai' }),
        hasLlmKey: true,
      },
    })
    await wrapper.find('.mcp-card__config').trigger('click')
    expect(wrapper.find('.mcp-card__reuse').exists()).toBe(false)
  })

  it('点关闭(enabled=true → false)始终允许 emit update + enabled=false', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: true, status: { state: 'ok', toolCount: 3 } }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    await wrapper.find('.mcp-toggle input').trigger('click')
    const emitted = wrapper.emitted('update')
    expect(emitted).toBeTruthy()
    expect(emitted![0]![0]).toMatchObject({ enabled: false })
  })

  it('点开启 + 已有 key(server.headers.Authorization 非空) → emit update.enabled=true + 保留 *** 哨兵', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: false,
          // 模拟后端 GET 已脱敏的旧 key:UI 视角 hasExistingKey=true(非空且不是 sentinel)
          headers: { Authorization: '***' },
        }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    await wrapper.find('.mcp-toggle input').trigger('click')
    const emitted = wrapper.emitted('update')
    expect(emitted).toBeTruthy()
    const payload = emitted![0]![0] as { enabled?: boolean; headers?: Record<string, string> }
    expect(payload.enabled).toBe(true)
    // 用户没改 input,后端已有 key → 应发 *** 表示保留旧值(整 value)
    expect(payload.headers?.Authorization).toBe('***')
  })

  it('勾选「复用 LLM Key」+ canReuse=true → emit headers.Authorization 含 sentinel', async () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: true,
      },
    })
    await wrapper.find('.mcp-card__config').trigger('click')
    const reuseCheckbox = wrapper.find('.mcp-card__reuse input')
    expect(reuseCheckbox.exists()).toBe(true)
    await reuseCheckbox.setValue(true)
    await flushPromises()
    const emitted = wrapper.emitted('update')
    expect(emitted).toBeTruthy()
    const payload = emitted!.at(-1)![0] as { headers?: Record<string, string> }
    expect(payload.headers?.Authorization).toBe(`Bearer ${LLM_KEY_SENTINEL}`)
  })

  it('勾「复用 LLM Key」+ 点开启 → emit update.enabled=true(sentinel 算可用 key,不弹 alert)', async () => {
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {})
    // 起步即 reuseLlmKey=true(后端 GET 来的),用户直接点开启
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: false,
          // headers 含 sentinel(GET 脱敏成 ***),reuseLlmKey 由后端计算回传 true
          headers: { Authorization: '***' },
          reuseLlmKey: true,
        }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: true,
      },
    })
    await wrapper.find('.mcp-toggle input').trigger('click')
    const emitted = wrapper.emitted('update')
    expect(emitted).toBeTruthy()
    const payload = emitted!.at(-1)![0] as { enabled?: boolean; headers?: Record<string, string> }
    expect(payload.enabled).toBe(true)
    // 复用模式下应发 sentinel,后端 registry 才能在连接时替换成真 key
    expect(payload.headers?.Authorization).toBe(`Bearer ${LLM_KEY_SENTINEL}`)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('无 key + 点开启 → 不 emit update + 弹 alert 提示填 key', async () => {
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {})
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({ enabled: false, headers: {} }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: false,
      },
    })
    await wrapper.find('.mcp-toggle input').trigger('click')
    expect(wrapper.emitted('update')).toBeFalsy()
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy.mock.calls[0]![0]).toMatch(/API Key|复用/)
    alertSpy.mockRestore()
  })

  it('error 状态 + 智谱 1001 错 → 显示友好「请先在 LLM 标签页配置...」 + 折叠原始 raw', () => {
    const raw = '{"code":1001,"msg":"Header中未收到Authorization参数..."}'
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: true,
          status: { state: 'error', error: raw },
        }),
        llm: makeLlm({ provider: 'zhipu' }),
        hasLlmKey: false,
      },
    })
    const pane = wrapper.find('.mcp-card__error-pane')
    expect(pane.exists()).toBe(true)
    expect(pane.text()).toContain('智谱 MCP 需要 Authorization')
    // raw 收进折叠区(<details>),不直接展示在 summary 行
    const rawEl = wrapper.find('.mcp-card__error-raw')
    expect(rawEl.exists()).toBe(true)
    expect(rawEl.text()).toContain('Header中未收到Authorization')
    // summary 行不能直接喷裸 JSON(只有友好 message)
    const summary = wrapper.find('.mcp-card__error-summary')
    expect(summary.text()).not.toContain('"code":1001')
  })

  it('error 状态 + JSON-RPC 协议错 → 友好提示「不是合法 JSON-RPC 响应」', () => {
    const raw = 'Zod error: [{"path":["jsonrpc"],"message":"expected \\"2.0\\""}]'
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: true,
          status: { state: 'error', error: raw },
        }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    expect(wrapper.find('.mcp-card__error-summary').text()).toContain('不是合法 JSON-RPC')
  })

  it('error 状态 + 网络错(fetch failed)→ 友好提示「无法连接 MCP 服务器」', () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: true,
          status: { state: 'error', error: 'fetch failed: ECONNREFUSED' },
        }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    expect(wrapper.find('.mcp-card__error-summary').text()).toContain('无法连接')
  })

  it('ok 状态 → 显示「已连接 · N 个工具」', () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: true,
          status: { state: 'ok', toolCount: 5 },
        }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    expect(wrapper.text()).toContain('已连接 · 5 个工具')
  })

  it('connecting 状态 → 显示「连接中…」', () => {
    const wrapper = mount(MCPCatalogItem, {
      props: {
        server: makeServer({
          enabled: true,
          status: { state: 'connecting' },
        }),
        llm: makeLlm(),
        hasLlmKey: true,
      },
    })
    expect(wrapper.text()).toContain('连接中')
  })
})
