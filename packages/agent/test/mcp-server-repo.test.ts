// packages/agent/test/mcp-server-repo.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonFileRepo } from '../src/mcp-server-repo/json-file-repo.js'
import { PRESET_MCP_SERVERS } from '../src/mcp-server-repo/presets.js'

let tmpFile: string

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-repo-'))
  tmpFile = path.join(dir, 'mcp.json')
})

afterEach(() => {
  try { fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }) } catch {}
})

describe('JsonFileRepo', () => {
  it('首次读不存在的文件会 seed 预置目录', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const list = await repo.list()
    expect(list).toHaveLength(PRESET_MCP_SERVERS.length)
    expect(list.map((c) => c.id).sort()).toEqual(PRESET_MCP_SERVERS.map((c) => c.id).sort())
    expect(fs.existsSync(tmpFile)).toBe(true)
    // 落盘的内容应与预置常量深相等
    const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))
    expect(onDisk).toEqual(PRESET_MCP_SERVERS)
  })

  it('get 返回指定 id', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const cfg = await repo.get('zhipu-web-search')
    expect(cfg?.displayName).toBe('联网搜索(智谱)')
  })

  it('create 新增自定义 server,list 能看到', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await repo.create({
      id: 'my-mcp',
      displayName: 'Mine',
      description: '',
      url: 'https://x.example/mcp',
      headers: { Authorization: 'Bearer k' },
      enabled: true,
      preset: false,
    })
    const list = await repo.list()
    expect(list.find((c) => c.id === 'my-mcp')?.enabled).toBe(true)
  })

  it('create 重复 id 抛错', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await expect(
      repo.create({
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

  it('update 合并 patch 并返回新配置（内存中仍是明文）', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const updated = await repo.update('zhipu-web-search', {
      enabled: true,
      headers: { Authorization: 'Bearer abc' },
    })
    expect(updated.enabled).toBe(true)
    expect(updated.headers.Authorization).toBe('Bearer abc')
    expect((await repo.get('zhipu-web-search'))!.enabled).toBe(true)
    // 再查一次确认 list/get 返回的仍是明文（内存一致）
    expect((await repo.get('zhipu-web-search'))!.headers.Authorization).toBe('Bearer abc')
  })

  it('持久化：headers value 在磁盘上被 AES-GCM 加密（v1: 前缀）', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await repo.update('zhipu-web-search', {
      headers: { Authorization: 'Bearer plaintext-secret-xyz' },
    })
    const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))
    const entry = onDisk.find((e: { id: string }) => e.id === 'zhipu-web-search')
    expect(entry.headers.Authorization).not.toContain('plaintext-secret-xyz')
    expect(entry.headers.Authorization.startsWith('v1:')).toBe(true)
    // 整个文件也应不含明文
    expect(fs.readFileSync(tmpFile, 'utf-8')).not.toContain('plaintext-secret-xyz')
  })

  it('兼容旧版明文文件：读时正常解出，下次写盘自动变密文', async () => {
    // 手写旧版文件
    fs.writeFileSync(
      tmpFile,
      JSON.stringify(
        [
          {
            id: 'legacy',
            displayName: 'L',
            description: '',
            url: 'https://l.example/mcp',
            headers: { Authorization: 'Bearer legacy-plain' },
            enabled: false,
            preset: false,
          },
        ],
        null,
        2,
      ),
    )
    const repo = new JsonFileRepo(tmpFile)
    // list 能拿到明文（兼容读）
    const list = await repo.list()
    expect(list.find((c) => c.id === 'legacy')!.headers.Authorization).toBe('Bearer legacy-plain')
    // 触发一次写盘
    await repo.update('legacy', { enabled: true })
    const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))
    const entry = onDisk.find((e: { id: string }) => e.id === 'legacy')
    expect(entry.headers.Authorization.startsWith('v1:')).toBe(true)
    expect(fs.readFileSync(tmpFile, 'utf-8')).not.toContain('legacy-plain')
  })

  it('update 不存在的 id 抛错', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await expect(repo.update('nope', { enabled: true })).rejects.toThrow(/not found/i)
  })

  it('delete 非预置,预置不能删', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await repo.create({
      id: 'to-delete',
      displayName: 'D',
      description: '',
      url: 'x',
      headers: {},
      enabled: false,
      preset: false,
    })
    await repo.delete('to-delete')
    expect(await repo.get('to-delete')).toBeUndefined()
    await expect(repo.delete('zhipu-web-search')).rejects.toThrow(/preset/i)
  })

  it('并发 5 次 create 不同 id,全部持久化', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
    await Promise.all(
      ids.map((id) =>
        repo.create({
          id,
          displayName: id,
          description: '',
          url: `https://${id}.example/mcp`,
          headers: {},
          enabled: false,
          preset: false,
        }),
      ),
    )
    const list = await repo.list()
    const customIds = list.filter((c) => !c.preset).map((c) => c.id).sort()
    expect(customIds).toEqual(ids)
    // 额外:文件真的含 4 个 preset + 5 个 custom = 9 条
    const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))
    expect(onDisk).toHaveLength(PRESET_MCP_SERVERS.length + 5)
  })

  it('持久化:第二个 repo 实例读得到第一个 repo 的写', async () => {
    const a = new JsonFileRepo(tmpFile)
    await a.update('zhipu-web-search', { enabled: true })
    const b = new JsonFileRepo(tmpFile)
    expect((await b.get('zhipu-web-search'))!.enabled).toBe(true)
  })
})
