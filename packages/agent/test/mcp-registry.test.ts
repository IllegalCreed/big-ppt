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

// ---- fake repo ----
class FakeRepo {
  constructor(private servers: McpServerConfig[]) {}
  list = async () => this.servers
  get = async (id: string) => this.servers.find((s) => s.id === id)
  create = async () => { throw new Error('not used') }
  update = async () => { throw new Error('not used') }
  delete = async () => { throw new Error('not used') }  // 原来这里是 remove,改成 delete 匹配 McpServerRepo 接口
}

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
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(hasTool('mcp__zhipu-web-search__search')).toBe(true)
    expect(registry.getStatus('zhipu-web-search').state).toBe('ok')
    expect(registry.getStatus('zhipu-web-search').toolCount).toBe(1)
  })

  it('enabled=false server does not connect', async () => {
    const repo = new FakeRepo([mkConfig({ enabled: false })])
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(mocks.connectDefault).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('disabled')
    expect(listRegistryTools()).toEqual([])
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
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(registry.getStatus('bad').state).toBe('error')
    expect(registry.getStatus('bad').error).toMatch(/401/)
    expect(registry.getStatus('good').state).toBe('ok')
  })
})

describe('McpRegistry.sync', () => {
  it('enabling incrementally connects and injects tools', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([]) as any)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch')).toBe(false)
    await registry.sync(mkConfig({ id: 'srv', enabled: true }))
    expect(hasTool('mcp__srv__fetch')).toBe(true)
  })

  it('disabling closes session and unregisters tools', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch')).toBe(true)
    await registry.sync(mkConfig({ id: 'srv', enabled: false }))
    expect(hasTool('mcp__srv__fetch')).toBe(false)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(registry.getStatus('srv').state).toBe('disabled')
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
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()

    const tool = getTool('mcp__srv__fetch')!
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
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()

    const out = await getTool('mcp__srv__fetch')!.exec({})
    expect(JSON.parse(out).success).toBe(false)
  })

  it('callTool 网络异常后 session 进入 error 态(被动发现)', async () => {
    mocks.connectDefault.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockRejectedValueOnce(new Error('ECONNRESET'))
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()
    expect(registry.getStatus('srv').state).toBe('ok')

    const out1 = await getTool('mcp__srv__fetch')!.exec({})
    expect(JSON.parse(out1).success).toBe(false)
    expect(registry.getStatus('srv').state).toBe('error')

    // 第二次调用应立即落 "未连接" 分支,不再试图 call 坏掉的 client
    const out2 = await getTool('mcp__srv__fetch')!.exec({})
    const parsed2 = JSON.parse(out2)
    expect(parsed2.success).toBe(false)
    expect(parsed2.error).toMatch(/未连接/)
  })
})
