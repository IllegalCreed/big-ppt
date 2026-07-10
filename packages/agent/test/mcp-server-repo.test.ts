// packages/agent/test/mcp-server-repo.test.ts
/**
 * Phase 9-F：DrizzleRepo（per-user MCP 入库，A01 修复）。
 *
 * 之前是 JsonFileRepo 全用户共享单文件 → 跨用户凭据共享漏洞。
 * 改为 DB 表 user_mcp_servers，组合唯一索引 (userId, serverId)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { DrizzleRepo } from '../src/mcp-server-repo/drizzle-repo.js'
import { PRESET_MCP_SERVERS } from '../src/mcp-server-repo/presets.js'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser } from './_setup/factories.js'
import { getDb, userMcpServers } from '../src/db/index.js'

useTestDb()

let userIdA: number
let userIdB: number

beforeEach(async () => {
  const a = await createTestUser('a@a.com')
  const b = await createTestUser('b@a.com')
  userIdA = a.user.id
  userIdB = b.user.id
})

describe('DrizzleRepo per-user', () => {
  it('首次 list 自动 seed PRESET_MCP_SERVERS（每用户独立 4 条）', async () => {
    const repo = new DrizzleRepo()
    const list = await repo.list(userIdA)
    expect(list).toHaveLength(PRESET_MCP_SERVERS.length)
    expect(list.map((c) => c.id).sort()).toEqual(PRESET_MCP_SERVERS.map((c) => c.id).sort())
    expect(list.every((c) => c.preset)).toBe(true)
  })

  it('两个 user 的 list 各自独立 seed，互不干扰', async () => {
    const repo = new DrizzleRepo()
    const a = await repo.list(userIdA)
    const b = await repo.list(userIdB)
    expect(a).toHaveLength(PRESET_MCP_SERVERS.length)
    expect(b).toHaveLength(PRESET_MCP_SERVERS.length)
    // DB 里应有 8 行（A 4 + B 4）
    const db = getDb()
    const all = await db.select().from(userMcpServers)
    expect(all).toHaveLength(PRESET_MCP_SERVERS.length * 2)
  })

  it('get 仅返回当前 user 的 server', async () => {
    const repo = new DrizzleRepo()
    await repo.list(userIdA) // seed A
    // B 还没 seed，get B 的 zhipu-web-search 应 undefined
    const b = await repo.get(userIdB, 'zhipu-web-search')
    expect(b).toBeUndefined()
    // A 的应有
    const a = await repo.get(userIdA, 'zhipu-web-search')
    expect(a?.displayName).toBe('联网搜索(智谱)')
  })

  it('create 自定义 server 仅本 user 可见', async () => {
    const repo = new DrizzleRepo()
    await repo.create(userIdA, {
      id: 'my-mcp',
      displayName: 'Mine',
      description: '',
      url: 'https://x.example/mcp',
      headers: { Authorization: 'Bearer k' },
      enabled: true,
      preset: false,
    })
    expect(await repo.get(userIdA, 'my-mcp')).toBeDefined()
    expect(await repo.get(userIdB, 'my-mcp')).toBeUndefined()
  })

  it('create 同 user 重复 serverId 抛错', async () => {
    const repo = new DrizzleRepo()
    await repo.list(userIdA) // seed
    await expect(
      repo.create(userIdA, {
        id: 'zhipu-web-search',
        displayName: 'Dup',
        description: '',
        url: 'x',
        headers: {},
        enabled: false,
        preset: false,
      }),
    ).rejects.toThrow(/already exists/i)
  })

  it('create 不同 user 同 serverId 各自独立（不冲突）', async () => {
    const repo = new DrizzleRepo()
    const cfg = {
      id: 'shared-id',
      displayName: 'Shared',
      description: '',
      url: 'x',
      headers: {},
      enabled: false,
      preset: false,
    }
    await repo.create(userIdA, cfg)
    await repo.create(userIdB, cfg) // 不抛错
    expect(await repo.get(userIdA, 'shared-id')).toBeDefined()
    expect(await repo.get(userIdB, 'shared-id')).toBeDefined()
  })

  it('update 合并 patch + 跨用户 not found', async () => {
    const repo = new DrizzleRepo()
    await repo.list(userIdA) // seed
    const updated = await repo.update(userIdA, 'zhipu-web-search', {
      enabled: true,
      headers: { Authorization: 'Bearer abc' },
    })
    expect(updated.enabled).toBe(true)
    expect(updated.headers.Authorization).toBe('Bearer abc')
    // 跨用户 update 同 serverId 应 not found（B 未 seed 该 server）
    await expect(repo.update(userIdB, 'zhipu-web-search', { enabled: true })).rejects.toThrow(
      /not found/i,
    )
  })

  it('headers 在 DB 中加密落库（v1: 前缀），内存返明文', async () => {
    const repo = new DrizzleRepo()
    await repo.list(userIdA) // seed
    await repo.update(userIdA, 'zhipu-web-search', {
      headers: { Authorization: 'Bearer plaintext-secret-xyz' },
    })
    const db = getDb()
    const [row] = await db
      .select({ headers: userMcpServers.headers })
      .from(userMcpServers)
      .where(
        and(eq(userMcpServers.userId, userIdA), eq(userMcpServers.serverId, 'zhipu-web-search')),
      )
      .limit(1)
    const stored = JSON.parse(row!.headers) as Record<string, string>
    expect(stored.Authorization).not.toContain('plaintext-secret-xyz')
    expect(stored.Authorization!.startsWith('v1:')).toBe(true)
    // 内存仍是明文
    const cfg = await repo.get(userIdA, 'zhipu-web-search')
    expect(cfg?.headers.Authorization).toBe('Bearer plaintext-secret-xyz')
  })

  it('delete 仅作用本 user，preset 不可删', async () => {
    const repo = new DrizzleRepo()
    await repo.list(userIdA) // seed both via separate calls
    await repo.list(userIdB)
    await repo.create(userIdA, {
      id: 'a-only',
      displayName: 'A',
      description: '',
      url: 'x',
      headers: {},
      enabled: false,
      preset: false,
    })
    await repo.delete(userIdA, 'a-only')
    expect(await repo.get(userIdA, 'a-only')).toBeUndefined()
    // preset 不可删
    await expect(repo.delete(userIdA, 'zhipu-web-search')).rejects.toThrow(/preset/i)
    // B 用户不受影响
    expect(await repo.get(userIdB, 'zhipu-web-search')).toBeDefined()
  })

  it('update 不存在 id 抛 NotFound', async () => {
    const repo = new DrizzleRepo()
    await expect(repo.update(userIdA, 'nope', { enabled: true })).rejects.toThrow(/not found/i)
  })

  it('Phase 12.5 hotfix:list() 自动 heal preset 行缺 sentinel(老用户 dev DB 已 seed 空 headers)', async () => {
    const repo = new DrizzleRepo()
    // 手工写一行模拟"老 seed"：preset=true 但 headers 是空 JSON('{}')
    const db = getDb()
    await db.insert(userMcpServers).values({
      userId: userIdA,
      serverId: 'zhipu-web-search',
      displayName: '联网搜索(智谱)',
      description: '...',
      url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
      headers: '{}', // 老格式:空 headers
      enabled: false,
      preset: true,
      badge: '搜索',
    })
    // list 应自动补 sentinel(返回明文带 $LLM_KEY)
    const list = await repo.list(userIdA)
    const found = list.find((c) => c.id === 'zhipu-web-search')!
    expect(found.headers.Authorization).toBe('Bearer $LLM_KEY')
    // DB 里实际也已被 patch 更新(下次读不再触发 heal)
    const [row] = await db
      .select({ headers: userMcpServers.headers })
      .from(userMcpServers)
      .where(
        and(eq(userMcpServers.userId, userIdA), eq(userMcpServers.serverId, 'zhipu-web-search')),
      )
      .limit(1)
    const stored = JSON.parse(row!.headers) as Record<string, string>
    expect(stored.Authorization).toBeDefined()
    expect(stored.Authorization!.startsWith('v1:')).toBe(true) // 加密落盘
  })

  it('Phase 12.5 hotfix:auto-heal 保留用户已加的非默认 header(merge 而非 replace)', async () => {
    const repo = new DrizzleRepo()
    const { encryptApiKey } = await import('../src/crypto/apikey.js')
    const db = getDb()
    // 模拟老用户:preset 行有自定义 X-Custom header 但 Authorization 空
    const partialHeaders = JSON.stringify({
      'X-Custom': encryptApiKey('user-extra-val'),
    })
    await db.insert(userMcpServers).values({
      userId: userIdA,
      serverId: 'zhipu-web-search',
      displayName: '联网搜索(智谱)',
      description: '...',
      url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
      headers: partialHeaders,
      enabled: false,
      preset: true,
      badge: '搜索',
    })
    const list = await repo.list(userIdA)
    const found = list.find((c) => c.id === 'zhipu-web-search')!
    expect(found.headers.Authorization).toBe('Bearer $LLM_KEY') // 补的
    expect(found.headers['X-Custom']).toBe('user-extra-val') // 保留的
  })

  it('Phase 12.5 hotfix:auto-heal 不动 non-preset 行', async () => {
    const repo = new DrizzleRepo()
    // 用户自己加的 server,headers 空 → 不该被 heal
    await repo.create(userIdA, {
      id: 'my-custom',
      displayName: 'Mine',
      description: '',
      url: 'https://x.example/mcp',
      headers: {},
      enabled: false,
      preset: false,
    })
    const list = await repo.list(userIdA)
    const found = list.find((c) => c.id === 'my-custom')!
    expect(found.headers).toEqual({})
  })
})
