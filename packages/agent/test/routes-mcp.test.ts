// packages/agent/test/routes-mcp.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [], isError: false })
    close = vi.fn().mockResolvedValue(undefined)
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor() {}
  },
}))

const { mcp: mcpRoute } = await import('../src/routes/mcp.js')
const { __resetRepoForTesting } = await import('../src/mcp-server-repo/index.js')
const { __resetRegistryForTesting } = await import('../src/mcp-registry/index.js')
const { __resetPathsForTesting } = await import('../src/workspace.js')

function buildApp() {
  const app = new Hono()
  app.route('/api', mcpRoute)
  return app
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-mcp-'))
  process.env.BIG_PPT_MCP_CONFIG = path.join(tmpDir, 'mcp.json')
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_MCP_CONFIG
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/mcp/servers', () => {
  it('返回预置 4 个 + status', async () => {
    const res = await buildApp().request('/api/mcp/servers')
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.servers.map((s: any) => s.id).sort()).toEqual([
      'zhipu-vision',
      'zhipu-web-reader',
      'zhipu-web-search',
      'zhipu-zread',
    ])
    for (const s of json.servers) expect(s.status.state).toBe('disabled')
  })
})

describe('POST /api/mcp/servers', () => {
  it('新增自定义 server 成功', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c.example/mcp' }),
    })
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers')).json()
    expect(list.servers.some((s: any) => s.id === 'custom' && s.preset === false)).toBe(true)
  })

  it('重复 id 返回 409', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'zhipu-web-search', displayName: 'Dup', url: 'https://x' }),
    })
    expect(res.status).toBe(409)
  })

  it('缺字段返回 400', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST 请求体非法 JSON 返回 400', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/合法 JSON/)
  })

  it('POST id 含非法字符返回 400', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'bad id!', displayName: 'X', url: 'https://x' }),
    })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/只能包含字母、数字/)
  })
})

describe('PATCH /api/mcp/servers/:id', () => {
  it('enabled=true 触发 registry 激活', async () => {
    const res = await buildApp().request('/api/mcp/servers/zhipu-web-search', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer t' } }),
    })
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers')).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.enabled).toBe(true)
    expect(found.status.state).toBe('ok')
  })

  it('PATCH 不存在的 id 返回 404', async () => {
    const res = await buildApp().request('/api/mcp/servers/does-not-exist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/not found/i)
  })
})

describe('DELETE /api/mcp/servers/:id', () => {
  it('预置返回 403', async () => {
    const res = await buildApp().request('/api/mcp/servers/zhipu-web-search', {
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  it('自定义删除成功', async () => {
    await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c' }),
    })
    const res = await buildApp().request('/api/mcp/servers/custom', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  it('DELETE 不存在的 id 返回 404', async () => {
    const res = await buildApp().request('/api/mcp/servers/does-not-exist', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})
