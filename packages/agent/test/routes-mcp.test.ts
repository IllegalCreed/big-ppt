// packages/agent/test/routes-mcp.test.ts
/**
 * Phase 9-F：MCP per-user 入库改造（A01 修复）。
 *
 * 重构要点：
 *   - JsonFileRepo + 文件路径 → DrizzleRepo + DB 表 user_mcp_servers
 *   - 单 singleton mcp-registry → per-user `getRegistry(userId)` + LRU
 *   - 所有 routes handler 用 ctx.var.user.id 调 repo + registry
 *   - 加测试：跨用户隔离（A 看不到 B / A 不能 update B）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { getDb, userMcpServers } from '../src/db/index.js'

/**
 * 用 vi.hoisted() 把 transportSpy 提升到 vi.mock 工厂能闭包到的位置。
 * spy 记录每次创建 transport 时的 headers,sentinel 解析测试用它 verify 真 LLM key 被注入。
 */
const transportSpy = vi.hoisted(() => ({
  lastHeaders: undefined as Record<string, string> | undefined,
}))
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
    constructor(_url: URL, opts?: { requestInit?: { headers?: Record<string, string> } }) {
      transportSpy.lastHeaders = opts?.requestInit?.headers
    }
  },
}))

const { mcp: mcpRoute } = await import('../src/routes/mcp.js')
const { authOptional } = await import('../src/middleware/auth.js')
const { __resetRepoForTesting } = await import('../src/mcp-server-repo/index.js')
const { __resetRegistryForTesting } = await import('../src/mcp-registry/index.js')
const { __resetRegistry: __resetToolsRegistry } = await import('../src/tools/registry.js')

useTestDb()

function buildApp() {
  const app = new Hono()
  app.use('*', authOptional)
  app.route('/api', mcpRoute)
  return app
}

let cookieA: string
let userIdA: number
let cookieB: string

beforeEach(async () => {
  __resetRepoForTesting()
  __resetRegistryForTesting()
  __resetToolsRegistry()
  const a = await createLoggedInUser('mcp-a@a.com')
  const b = await createLoggedInUser('mcp-b@a.com')
  cookieA = a.cookie
  userIdA = a.user.id
  cookieB = b.cookie
})

afterEach(() => {
  __resetRepoForTesting()
  __resetRegistryForTesting()
  __resetToolsRegistry()
})

function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } }
}

describe('鉴权', () => {
  it('未登录 GET → 401', async () => {
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
  it('首次返回预置 3 个 + status=disabled + headers 脱敏(vision 因仅 stdio 不在预置)', async () => {
    const res = await buildApp().request('/api/mcp/servers', authed(cookieA))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.servers.map((s: any) => s.id).sort()).toEqual([
      'zhipu-web-reader',
      'zhipu-web-search',
      'zhipu-zread',
    ])
    for (const s of json.servers) expect(s.status.state).toBe('disabled')
    // Phase 12.5 hotfix:preset headers 默认带 `Bearer $LLM_KEY` sentinel,GET 脱敏成 ***
    // reuseLlmKey=true 让前端默认显示已勾选复用复选框,用户配好智谱 key 即可启用
    for (const s of json.servers) expect(s.headers).toEqual({ Authorization: '***' })
    for (const s of json.servers) expect(s.reuseLlmKey).toBe(true)
  })

  it('设置过 key 后，GET 返回 Authorization: ***', async () => {
    // 先 GET seed 一次让 preset 入库（路由层不自动 seed-on-write）
    await buildApp().request('/api/mcp/servers', authed(cookieA))
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer real-secret' } }),
      }),
    )
    const res = await buildApp().request('/api/mcp/servers', authed(cookieA))
    const json = await res.json()
    const found = json.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.headers.Authorization).toBe('***')
    expect(JSON.stringify(json)).not.toContain('real-secret')
  })
})

describe('POST /api/mcp/servers', () => {
  it('新增自定义 server 成功', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed(cookieA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c.example/mcp' }),
      }),
    )
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieA))).json()
    expect(list.servers.some((s: any) => s.id === 'custom' && s.preset === false)).toBe(true)
  })

  it('重复 id 返回 409', async () => {
    // 先 GET 一次让 preset seed
    await buildApp().request('/api/mcp/servers', authed(cookieA))
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed(cookieA, {
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
      authed(cookieA, {
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
      authed(cookieA, {
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
      authed(cookieA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'bad id!', displayName: 'X', url: 'https://x' }),
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/只能包含字母、数字/)
  })

  it('POST 拒绝 localhost / 内网 MCP URL', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers',
      authed(cookieA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'local', displayName: 'Local', url: 'http://127.0.0.1:4000/mcp' }),
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('内网')
  })
})

describe('PATCH /api/mcp/servers/:id', () => {
  // PATCH 前先 GET 一次让 preset seed 落库
  beforeEach(async () => {
    await buildApp().request('/api/mcp/servers', authed(cookieA))
  })

  it('enabled=true 触发 registry 激活', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer t' } }),
      }),
    )
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieA))).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.enabled).toBe(true)
    expect(found.status.state).toBe('ok')
  })

  it('PATCH 不存在的 id 返回 404', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/does-not-exist',
      authed(cookieA, {
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
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer keep-me' } }),
      }),
    )
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer ***' } }),
      }),
    )
    expect(res.status).toBe(200)
    // 从 DB 验证：旧值保留（密文，不应是字面 "Bearer ***"）
    const db = getDb()
    const [row] = await db
      .select({ headers: userMcpServers.headers })
      .from(userMcpServers)
      .where(
        and(eq(userMcpServers.userId, userIdA), eq(userMcpServers.serverId, 'zhipu-web-search')),
      )
      .limit(1)
    const stored = JSON.parse(row!.headers) as Record<string, string>
    expect(stored.Authorization).not.toBe('Bearer ***')
    expect(stored.Authorization!.startsWith('v1:')).toBe(true)
  })

  it('PATCH headers.Authorization = "Bearer $LLM_KEY" → sentinel 直接落库,GET 返回 reuseLlmKey=true', async () => {
    // 给 userA 写入 encrypted llm_settings,模拟用户已在 LLM tab 保存过 apiKey
    const { encryptApiKey } = await import('../src/crypto/apikey.js')
    const { users } = await import('../src/db/index.js')
    const llmPayload = JSON.stringify({ provider: 'zhipu', apiKey: 'real-llm-secret', model: 'GLM-5.1' })
    await getDb().update(users).set({ llmSettings: encryptApiKey(llmPayload) }).where(eq(users.id, userIdA))

    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer $LLM_KEY' } }),
      }),
    )
    expect(res.status).toBe(200)
    // 落库的应是 sentinel 的密文,而不是被替换后的真 key
    const db = getDb()
    const [row] = await db
      .select({ headers: userMcpServers.headers })
      .from(userMcpServers)
      .where(
        and(eq(userMcpServers.userId, userIdA), eq(userMcpServers.serverId, 'zhipu-web-search')),
      )
      .limit(1)
    const stored = JSON.parse(row!.headers) as Record<string, string>
    expect(stored.Authorization!.startsWith('v1:')).toBe(true)
    const { decryptApiKey } = await import('../src/crypto/apikey.js')
    expect(decryptApiKey(stored.Authorization!)).toBe('Bearer $LLM_KEY')

    // GET 返回 reuseLlmKey=true,headers 仍脱敏成 ***
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieA))).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.reuseLlmKey).toBe(true)
    expect(found.headers.Authorization).toBe('***')
  })

  it('PATCH 带 $LLM_KEY 但用户没存过 LLM apiKey → 400', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer $LLM_KEY' } }),
      }),
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { success: boolean; error?: string }
    expect(json.success).toBe(false)
    expect(json.error).toContain('LLM Key')
  })

  it('enabled=true + sentinel → activate 时 transport headers 拿到真 LLM apiKey', async () => {
    const { encryptApiKey } = await import('../src/crypto/apikey.js')
    const { users } = await import('../src/db/index.js')
    await getDb()
      .update(users)
      .set({
        llmSettings: encryptApiKey(JSON.stringify({ provider: 'zhipu', apiKey: 'real-llm-key' })),
      })
      .where(eq(users.id, userIdA))
    transportSpy.lastHeaders = undefined
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer $LLM_KEY' } }),
      }),
    )
    expect(res.status).toBe(200)
    // activate → new transport → headers 应是替换后的真 key,不带 sentinel
    expect(transportSpy.lastHeaders?.Authorization).toBe('Bearer real-llm-key')
    expect(transportSpy.lastHeaders?.Authorization).not.toContain('$LLM_KEY')
  })

  it('Phase 12 Task F:DB 已是新 shape → activate 仍能拿到 $LLM_KEY 真值(getActiveProviderConfig 兼容)', async () => {
    const { encryptApiKey } = await import('../src/crypto/apikey.js')
    const { users } = await import('../src/db/index.js')
    // 直接绕过 PUT /llm-settings,写新 shape JSON 到 DB(模拟 migration 跑过后的状态)
    const newShape = JSON.stringify({
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'new-shape-key', model: 'GLM-5.1' } },
    })
    await getDb()
      .update(users)
      .set({ llmSettings: encryptApiKey(newShape) })
      .where(eq(users.id, userIdA))

    transportSpy.lastHeaders = undefined
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer $LLM_KEY' } }),
      }),
    )
    expect(res.status).toBe(200)
    // 新 shape DB → fetchLlmKey 走 getActiveProviderConfig → 拿到 providers.zhipu.apiKey
    expect(transportSpy.lastHeaders?.Authorization).toBe('Bearer new-shape-key')
    expect(transportSpy.lastHeaders?.Authorization).not.toContain('$LLM_KEY')
  })

  it('PATCH 取消复用(填用户自己的 key) → sentinel 被清空,GET 返回 reuseLlmKey=false', async () => {
    const { encryptApiKey } = await import('../src/crypto/apikey.js')
    const { users } = await import('../src/db/index.js')
    await getDb()
      .update(users)
      .set({ llmSettings: encryptApiKey(JSON.stringify({ provider: 'zhipu', apiKey: 'k' })) })
      .where(eq(users.id, userIdA))
    // 先勾选复用
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer $LLM_KEY' } }),
      }),
    )
    // 取消复用 + 填用户自己的 key(真实 UX 流程:取消 sentinel 不会发空,会发 user 的 key)。
    // Phase 12.5 hotfix 后,空 headers 会被 auto-heal 补回 sentinel(preset 没 auth 100% 失败,
    // 空状态没意义);所以"取消复用"必须配真实 key 才生效。
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer user-own-key' } }),
      }),
    )
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieA))).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.reuseLlmKey).toBe(false)
    // Authorization 已设非 sentinel 值 → 脱敏成 ***
    expect(found.headers.Authorization).toBe('***')
  })

  it('PATCH headers.Authorization = "Bearer new-val" → 覆盖旧值', async () => {
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer old' } }),
      }),
    )
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: { Authorization: 'Bearer new-val' } }),
      }),
    )
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieA))).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.headers.Authorization).toBe('***')
  })
})

describe('DELETE /api/mcp/servers/:id', () => {
  it('预置返回 403', async () => {
    // 先 seed
    await buildApp().request('/api/mcp/servers', authed(cookieA))
    const res = await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, { method: 'DELETE' }),
    )
    expect(res.status).toBe(403)
  })

  it('自定义删除成功', async () => {
    await buildApp().request(
      '/api/mcp/servers',
      authed(cookieA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c' }),
      }),
    )
    const res = await buildApp().request(
      '/api/mcp/servers/custom',
      authed(cookieA, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
  })

  it('DELETE 不存在的 id 返回 404', async () => {
    const res = await buildApp().request(
      '/api/mcp/servers/does-not-exist',
      authed(cookieA, { method: 'DELETE' }),
    )
    expect(res.status).toBe(404)
  })
})

describe('加密持久化（DB）', () => {
  beforeEach(async () => {
    await buildApp().request('/api/mcp/servers', authed(cookieA)) // seed
  })

  it('headers token 落 DB 时加密（v1: 前缀），原文不出现在表里', async () => {
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          headers: { Authorization: 'Bearer top-secret-token-123' },
        }),
      }),
    )
    const db = getDb()
    const [row] = await db
      .select()
      .from(userMcpServers)
      .where(
        and(eq(userMcpServers.userId, userIdA), eq(userMcpServers.serverId, 'zhipu-web-search')),
      )
      .limit(1)
    expect(row!.headers).not.toContain('top-secret-token-123')
    const stored = JSON.parse(row!.headers) as Record<string, string>
    expect(stored.Authorization!.startsWith('v1:')).toBe(true)
  })
})

describe('跨用户隔离（Phase 9-F A01 修复）', () => {
  it('A 启用 server + 填 token，B GET 看到的是 B 自己的 4 个 preset（enabled=false）', async () => {
    // A 启用 + 填 fake token
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer A-secret' } }),
      }),
    )
    // B GET
    const list = await (await buildApp().request('/api/mcp/servers', authed(cookieB))).json()
    expect(list.servers).toHaveLength(3)
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    // B 自己的应是默认 disabled + Phase 12.5 默认 sentinel(脱敏成 ***)
    expect(found.enabled).toBe(false)
    expect(found.headers).toEqual({ Authorization: '***' })
    expect(found.reuseLlmKey).toBe(true)
    // 不应含 A 的 token
    expect(JSON.stringify(list)).not.toContain('A-secret')
  })

  it('A 不能 PATCH B 的 server（同 serverId 是 B 的不同记录）', async () => {
    // 让 A B 都 seed 自己的 preset
    await buildApp().request('/api/mcp/servers', authed(cookieA))
    await buildApp().request('/api/mcp/servers', authed(cookieB))

    // A 用自己的 cookie patch zhipu-web-search → 改的是 A 的记录，B 不受影响
    await buildApp().request(
      '/api/mcp/servers/zhipu-web-search',
      authed(cookieA, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }),
    )
    const bList = await (await buildApp().request('/api/mcp/servers', authed(cookieB))).json()
    const bSrv = bList.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(bSrv.enabled).toBe(false) // B 的仍是 disabled
  })

  it('A 创建的自定义 server 在 B 视角下不可见，且 B 可以同名创建（不冲突）', async () => {
    await buildApp().request(
      '/api/mcp/servers',
      authed(cookieA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'shared-name', displayName: 'A', url: 'https://a.example/mcp' }),
      }),
    )
    const bResBefore = await (await buildApp().request('/api/mcp/servers', authed(cookieB))).json()
    expect(bResBefore.servers.some((s: any) => s.id === 'shared-name')).toBe(false)

    // B 同 id 创建不冲突
    const bCreate = await buildApp().request(
      '/api/mcp/servers',
      authed(cookieB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'shared-name', displayName: 'B', url: 'https://b.example/mcp' }),
      }),
    )
    expect(bCreate.status).toBe(200)
  })
})
