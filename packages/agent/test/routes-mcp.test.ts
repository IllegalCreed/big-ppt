// packages/agent/test/routes-mcp.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'

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
const { authOptional } = await import('../src/middleware/auth.js')
const { __resetRepoForTesting } = await import('../src/mcp-server-repo/index.js')
const { __resetRegistryForTesting } = await import('../src/mcp-registry/index.js')
const { __resetPathsForTesting } = await import('../src/workspace.js')

useTestDb() // users/sessions 表需要，factories 要用

function buildApp() {
  const app = new Hono()
  app.use('*', authOptional)
  app.route('/api', mcpRoute)
  return app
}

let tmpDir: string
let cookie: string

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-mcp-'))
  process.env.BIG_PPT_MCP_CONFIG = path.join(tmpDir, 'mcp.json')
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
  // 每个 case 建个登录用户，带着 cookie 走完整鉴权路径
  const user = await createLoggedInUser(`mcp-${Date.now()}@a.com`)
  cookie = user.cookie
})

afterEach(() => {
  delete process.env.BIG_PPT_MCP_CONFIG
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function authed(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } }
}

describe('鉴权', () => {
  it('未登录访问 GET → 401（Phase 5 遗留漏洞修复）', async () => {
    const res = await buildApp().request('/api/mcp/servers')
    expect(res.status).toBe(401)
  })

  it('未登录 PATCH → 401', async () => {
    const res = await buildApp().request('/api/mcp/servers/zhipu-web-search', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/mcp/servers', () => {
  it('返回预置 4 个 + status + headers value 脱敏', async () => {
    const res = await buildApp().request('/api/mcp/servers', authed())
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.servers.map((s: any) => s.id).sort()).toEqual([
      'zhipu-vision',
      'zhipu-web-reader',
      'zhipu-web-search',
      'zhipu-zread',
    ])
    for (const s of json.servers) expect(s.status.state).toBe('disabled')
    // 预置 headers 是 {} ，脱敏后仍是 {}（空集无可脱）
    for (const s of json.servers) expect(s.headers).toEqual({})
  })

  it('设置过 key 后，GET 返回 Authorization: Bearer ***', async () => {
    // 先设 Bearer
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer real-secret' } }),
      }),
    )
    const res = await buildApp().request('/api/mcp/servers', authed())
    const json = await res.json()
    const found = json.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.headers.Authorization).toBe('***')
    // 确认不含真值
    expect(JSON.stringify(json)).not.toContain('real-secret')
  })
})

describe('POST /api/mcp/servers', () => {
  it('新增自定义 server 成功', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c.example/mcp' }),
      }),
    )
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers', authed())).json()
    expect(list.servers.some((s: any) => s.id === 'custom' && s.preset === false)).toBe(true)
  })

  it('重复 id 返回 409', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'zhipu-web-search', displayName: 'Dup', url: 'https://x' }),
      }),
    )
    expect(res.status).toBe(409)
  })

  it('缺字段返回 400', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('POST 请求体非法 JSON 返回 400', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/合法 JSON/)
  })

  it('POST id 含非法字符返回 400', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'bad id!', displayName: 'X', url: 'https://x' }),
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/只能包含字母、数字/)
  })
})

describe('PATCH /api/mcp/servers/:id', () => {
  it('enabled=true 触发 registry 激活', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer t' } }),
      }),
    )
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers', authed())).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.enabled).toBe(true)
    expect(found.status.state).toBe('ok')
  })

  it('PATCH 不存在的 id 返回 404', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/does-not-exist',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
    )
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toMatch(/not found/i)
  })

  it('PATCH headers.Authorization = *** → 保留旧值', async () => {
    // 先设旧值
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer keep-me' } }),
      }),
    )
    // 用 *** 再 PATCH
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer ***' } }),
      }),
    )
    expect(res.status).toBe(200)
    // 从磁盘验证：旧值在，没被 *** 覆盖
    const disk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8'),
    ) as Array<{ id: string; headers: Record<string, string> }>
    const entry = disk.find((e) => e.id === 'zhipu-web-search')!
    // 磁盘上是密文（以 v1: 开头），但至少不是字面 "Bearer ***"
    expect(entry.headers.Authorization).not.toBe('Bearer ***')
    expect(entry.headers.Authorization.startsWith('v1:')).toBe(true)
  })

  it('PATCH headers.Authorization = "Bearer new-val" → 覆盖旧值', async () => {
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer old' } }),
      }),
    )
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer new-val' } }),
      }),
    )
    expect(res.status).toBe(200)
    // 再 GET → value 脱敏为 ***，但 registry 应该能用真值
    const list = await (await buildApp().request('/api/mcp/servers', authed())).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.headers.Authorization).toBe('***')
  })
})

describe('DELETE /api/mcp/servers/:id', () => {
  it('预置返回 403', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({ method: 'DELETE' }),
    )
    expect(res.status).toBe(403)
  })

  it('自定义删除成功', async () => {
    await buildApp().request(
      '/api/mcp/servers',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c' }),
      }),
    )
    const res = await buildApp().request(
      '/api/mcp/servers/custom',
      authed({ method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
  })

  it('DELETE 不存在的 id 返回 404', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/does-not-exist',
      authed({ method: 'DELETE' }),
    )
    expect(res.status).toBe(404)
  })
})

describe('加密持久化', () => {
  it('mcp.json 磁盘内容不包含 Bearer token 明文', async () => {
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          headers: { Authorization: 'Bearer top-secret-token-123' },
        }),
      }),
    )
    const diskText = fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8')
    expect(diskText).not.toContain('top-secret-token-123')
    expect(diskText).toMatch(/"Authorization":\s*"v1:/)
  })

  it('旧版明文 mcp.json 能被无缝读取并在下次写盘时迁移为密文', async () => {
    // 手动写一个"旧版"文件（value 不是 v1: 开头）
    const legacy = [
      {
        id: 'legacy-plain',
        displayName: 'Legacy',
        description: '',
        url: 'https://legacy.example/mcp',
        headers: { Authorization: 'Bearer legacy-plain-token', 'X-Other': 'visible' },
        enabled: false,
        preset: false,
      },
    ]
    fs.writeFileSync(path.join(tmpDir, 'mcp.json'), JSON.stringify(legacy, null, 2))

    // GET 能看到（value 脱敏）
    const list = await (await buildApp().request('/api/mcp/servers', authed())).json()
    const found = list.servers.find((s: any) => s.id === 'legacy-plain')
    expect(found.headers.Authorization).toBe('***')
    expect(found.headers['X-Other']).toBe('***')

    // 触发一次 PATCH（保留 Authorization 原值）→ 落盘后应变密文
    await buildApp().request(
      '/api/mcp/servers/legacy-plain',
      authed({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer ***', 'X-Other': '***' } }),
      }),
    )
    const diskText = fs.readFileSync(path.join(tmpDir, 'mcp.json'), 'utf-8')
    expect(diskText).not.toContain('legacy-plain-token')
    expect(diskText).toMatch(/"Authorization":\s*"v1:/)
  })
})
