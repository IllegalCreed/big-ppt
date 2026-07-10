// packages/agent/test/mcp-registry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@big-ppt/shared'
import {
  __resetRegistry,
  getTool,
  hasTool,
  listTools as listRegistryTools,
} from '../src/tools/registry.js'

// ---- mock @modelcontextprotocol/sdk ----
// vi.mock 工厂会被 hoist 到文件顶部,普通 const 变量在那时尚未初始化,
// 必须用 vi.hoisted() 把 mock 句柄一起提升,工厂闭包才能取到。
const mocks = vi.hoisted(() => ({
  listTools: vi.fn(),
  callTool: vi.fn(),
  /** key: transport URL href,value: Promise or value returned by that connect */
  connectPerUrl: new Map<string, () => Promise<unknown> | unknown>(),
  /** 默认 connect 行为(未在 connectPerUrl 指定时使用) */
  connectDefault: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(public url: URL, public opts: unknown) {}
    // start() is called by the real Client.connect(); include it so tests
    // remain safe even if vi.mock for the Client doesn't intercept.
    async start() {}
    // close() is called by Client when connect throws; SDK does
    // `this._transport?.close()` 期望 transport 有 close 方法。
    // Vitest 4 起对 unhandled rejection 严格化,缺这个 mock 会让 connect 失败的
    // 测试报 "this._transport?.close is not a function"。
    async close() {}
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor(public meta: unknown, public caps: unknown) {}
    async connect(transport: any) {
      const href = transport?.url?.href ?? ''
      const override = mocks.connectPerUrl.get(href)
      if (override) return override()
      return mocks.connectDefault(transport)
    }
    listTools = mocks.listTools
    callTool = mocks.callTool
    close = mocks.close
  },
}))

// module under test must be imported after vi.mock declarations
const { McpRegistry } = await import('../src/mcp-registry/registry.js')

// ---- fake repo (per-user 接口适配，Phase 9-F) ----
class FakeRepo {
  constructor(private servers: McpServerConfig[]) {}
  list = async (_userId: number) => this.servers
  get = async (_userId: number, id: string) => this.servers.find((s) => s.id === id)
  create = async () => { throw new Error('not used') }
  update = async () => { throw new Error('not used') }
  delete = async () => { throw new Error('not used') }
}

const TEST_USER_ID = 42

function mkConfig(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv',
    displayName: 'S',
    description: '',
    url: 'https://x.example/mcp',
    headers: {},
    enabled: true,
    preset: false,
    ...over,
  }
}

beforeEach(() => {
  mocks.listTools.mockReset()
  mocks.callTool.mockReset()
  mocks.connectDefault.mockReset()
  mocks.close.mockReset()
  mocks.connectPerUrl.clear()
  __resetRegistry()
})
afterEach(() => {
  __resetRegistry()
})

describe('McpRegistry.initialize', () => {
  it('enabled=true server connects, tools injected as mcp__id__tool', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [
        { name: 'search', description: 'search', inputSchema: { type: 'object', properties: {} } },
      ],
    })
    const repo = new FakeRepo([mkConfig({ id: 'zhipu-web-search' })])
    const registry = new McpRegistry(repo as any, TEST_USER_ID)
    await registry.initialize()
    expect(hasTool('mcp__zhipu-web-search__search', TEST_USER_ID)).toBe(true)
    expect(registry.getStatus('zhipu-web-search').state).toBe('ok')
    expect(registry.getStatus('zhipu-web-search').toolCount).toBe(1)
  })

  it('enabled=false server does not connect', async () => {
    const repo = new FakeRepo([mkConfig({ enabled: false })])
    const registry = new McpRegistry(repo as any, TEST_USER_ID)
    await registry.initialize()
    expect(mocks.connectDefault).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('disabled')
    expect(listRegistryTools(TEST_USER_ID)).toEqual([])
  })

  it('历史配置里已有内网 URL 时连接前拒绝,不触发 SDK connect', async () => {
    const repo = new FakeRepo([mkConfig({ url: 'http://127.0.0.1:11434/mcp' })])
    const registry = new McpRegistry(repo as any, TEST_USER_ID)
    await registry.initialize()
    expect(mocks.connectDefault).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('error')
    expect(registry.getStatus('srv').error).toMatch(/内网/)
  })

  it('一个 server connect 失败不影响其他 server', async () => {
    mocks.connectPerUrl.set('https://bad.example/mcp', () => {
      throw new Error('401 Unauthorized')
    })
    mocks.connectPerUrl.set('https://good.example/mcp', async () => undefined)
    mocks.listTools.mockResolvedValue({ tools: [] })
    const repo = new FakeRepo([
      mkConfig({ id: 'bad', enabled: true, url: 'https://bad.example/mcp' }),
      mkConfig({ id: 'good', enabled: true, url: 'https://good.example/mcp' }),
    ])
    const registry = new McpRegistry(repo as any, TEST_USER_ID)
    await registry.initialize()
    expect(registry.getStatus('bad').state).toBe('error')
    expect(registry.getStatus('bad').error).toMatch(/401/)
    expect(registry.getStatus('good').state).toBe('ok')
  })
})

describe('McpRegistry per-user 隔离 + ensureInitialized', () => {
  it('两个 user 启用同名 serverId 工具不冲突，互不可见', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const regA = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, 1)
    const regB = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, 2)
    await regA.initialize()
    await regB.initialize()
    expect(hasTool('mcp__srv__fetch', 1)).toBe(true)
    expect(hasTool('mcp__srv__fetch', 2)).toBe(true)
    expect(hasTool('mcp__srv__fetch')).toBe(false) // 全局没注册
    expect(listRegistryTools(1).map((t) => t.function.name)).toEqual(['mcp__srv__fetch'])
    expect(listRegistryTools(2).map((t) => t.function.name)).toEqual(['mcp__srv__fetch'])
  })

  it('ensureInitialized 幂等（多次调用不重复 connect）', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({ tools: [] })
    const repo = new FakeRepo([mkConfig({ enabled: true })])
    const registry = new McpRegistry(repo as any, TEST_USER_ID)
    await registry.ensureInitialized()
    await registry.ensureInitialized()
    await registry.ensureInitialized()
    expect(mocks.connectDefault).toHaveBeenCalledTimes(1)
  })
})

describe('McpRegistry.sync', () => {
  it('enabling incrementally connects and injects tools', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(false)
    await registry.sync(mkConfig({ id: 'srv', enabled: true }))
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(true)
  })

  it('disabling closes session and unregisters tools', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(true)
    await registry.sync(mkConfig({ id: 'srv', enabled: false }))
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(false)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(registry.getStatus('srv').state).toBe('disabled')
  })
})

describe('McpRegistry.resyncIfStale', () => {
  it('session 不存在 + enabled=true → activate', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([]) as any, TEST_USER_ID)
    // 没 initialize 过 → sessions Map 空
    await registry.resyncIfStale(mkConfig({ id: 'srv', enabled: true }))
    expect(mocks.connectDefault).toHaveBeenCalledTimes(1)
    expect(registry.getStatus('srv').state).toBe('ok')
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(true)
  })

  it('session 不存在 + enabled=false → noop(不 activate)', async () => {
    const registry = new McpRegistry(new FakeRepo([]) as any, TEST_USER_ID)
    await registry.resyncIfStale(mkConfig({ id: 'srv', enabled: false }))
    expect(mocks.connectDefault).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('disabled')
  })

  it('headers 一致 → noop(不重连不动 tools)', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const cfg = mkConfig({ id: 'srv', headers: { Authorization: 'Bearer abc' } })
    const registry = new McpRegistry(new FakeRepo([cfg]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(mocks.connectDefault).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()

    // 再次传入 headers 完全一致的 cfg → 不应触发 close / 再 connect
    await registry.resyncIfStale({ ...cfg, headers: { Authorization: 'Bearer abc' } })
    expect(mocks.connectDefault).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('ok')
  })

  it('headers diverge → 关旧 session 重 activate(模拟 auto-heal 后)', async () => {
    // 先用空 headers connect 失败(模拟 auto-heal 前的 stale state='error' 场景)
    mocks.connectPerUrl.set('https://srv.example/mcp', () => {
      throw new Error('401 Unauthorized')
    })
    const cfg0 = mkConfig({
      id: 'srv',
      url: 'https://srv.example/mcp',
      headers: {},
    })
    const registry = new McpRegistry(new FakeRepo([cfg0]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(registry.getStatus('srv').state).toBe('error')
    expect(mocks.connectDefault).not.toHaveBeenCalled() // url-specific override 命中
    const connectCallsBefore = mocks.connectPerUrl.size // for sanity

    // auto-heal 后:DB headers 补成 sentinel,且替换为 active provider apiKey 后能连上。
    // 切换 connect 行为为成功 + 提供 tools
    let secondConnectInvoked = false
    mocks.connectPerUrl.set('https://srv.example/mcp', async () => {
      secondConnectInvoked = true
    })
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const cfg1 = mkConfig({
      id: 'srv',
      url: 'https://srv.example/mcp',
      headers: { Authorization: 'Bearer healed-key' },
    })
    await registry.resyncIfStale(cfg1)

    expect(secondConnectInvoked).toBe(true) // 重新 connect 触发
    expect(registry.getStatus('srv').state).toBe('ok') // 新 session 上线
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(true)
    // sanity:保持 per-url 映射干净(未泄漏到默认 mock)
    expect(connectCallsBefore).toBe(1)
  })

  it('headers diverge 且原 session 已成功连接 → 关 mocks.close + 重 activate', async () => {
    // session 处于 ok 状态时 close 调用会真正 hit mocks.close(client 不为 null)
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const cfg0 = mkConfig({ id: 'srv', headers: { Authorization: 'old-key' } })
    const registry = new McpRegistry(new FakeRepo([cfg0]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(registry.getStatus('srv').state).toBe('ok')
    expect(mocks.connectDefault).toHaveBeenCalledTimes(1)

    const cfg1 = mkConfig({ id: 'srv', headers: { Authorization: 'new-key' } })
    await registry.resyncIfStale(cfg1)

    expect(mocks.close).toHaveBeenCalledTimes(1) // 旧 client.close 被调
    expect(mocks.connectDefault).toHaveBeenCalledTimes(2) // 重 connect
    expect(registry.getStatus('srv').state).toBe('ok')
    expect(hasTool('mcp__srv__fetch', TEST_USER_ID)).toBe(true)
  })
})

describe('McpRegistry callTool 委派', () => {
  it('calling mcp__srv__fetch via tool-registry delegates to session.callTool', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello from mcp' }],
      isError: false,
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, TEST_USER_ID)
    await registry.initialize()

    const tool = getTool('mcp__srv__fetch', TEST_USER_ID)!
    const out = await tool.exec({ url: 'https://x' })
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(true)
    expect(parsed.result).toContain('hello from mcp')
    expect(mocks.callTool).toHaveBeenCalledWith({ name: 'fetch', arguments: { url: 'https://x' } })
  })

  it('isError=true results in success=false', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'upstream 500' }],
      isError: true,
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, TEST_USER_ID)
    await registry.initialize()

    const out = await getTool('mcp__srv__fetch', TEST_USER_ID)!.exec({})
    expect(JSON.parse(out).success).toBe(false)
  })

  it('callTool 网络异常后 session 进入 error 态(被动发现)', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockRejectedValueOnce(new Error('ECONNRESET'))
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any, TEST_USER_ID)
    await registry.initialize()
    expect(registry.getStatus('srv').state).toBe('ok')

    const out1 = await getTool('mcp__srv__fetch', TEST_USER_ID)!.exec({})
    expect(JSON.parse(out1).success).toBe(false)
    expect(registry.getStatus('srv').state).toBe('error')

    // 第二次调用应立即落 "未连接" 分支,不再试图 call 坏掉的 client
    const out2 = await getTool('mcp__srv__fetch', TEST_USER_ID)!.exec({})
    const parsed2 = JSON.parse(out2)
    expect(parsed2.success).toBe(false)
    expect(parsed2.error).toMatch(/未连接/)
  })
})
