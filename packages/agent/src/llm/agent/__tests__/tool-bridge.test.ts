/**
 * Phase 12.7 Task B：tool-bridge 单测（6 测）。
 *
 * 覆盖：
 * 1. buildToolsForUser 返回该 user 视角下的全部 ToolDef wrap（全局 + per-user）
 * 2. AgentTool.execute 调 executeToolForUser 透传 args + signal，包成
 *    AgentToolResult shape
 * 3. AgentTool.execute 抛错时直接 propagate（不吞）
 * 4. AgentTool.parameters / description / label 字段正确（schema 来自 ToolDef）
 * 5. normalizeToolResultBlocks 三种输入 shape：string / Block[] / 任意对象
 * 6. buildToolsForUser 调 ensureInitialized（MCP 工具懒初始化必经路径）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as registry from '../../../tools/registry.js'
import * as mcpRegistry from '../../../mcp-registry/index.js'
import { buildToolsForUser, normalizeToolResultBlocks } from '../tool-bridge.js'
import type { ToolDef } from '../../../tools/registry.js'

let ensureInitializedSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  registry.__resetRegistry()
  // 默认让 ensureInitialized 解析成 undefined（无 side effect），单测可单独覆盖
  ensureInitializedSpy = vi
    .spyOn(mcpRegistry, 'getRegistry')
    .mockReturnValue({
      ensureInitialized: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof mcpRegistry.getRegistry>)
})

afterEach(() => {
  vi.restoreAllMocks()
  registry.__resetRegistry()
  ensureInitializedSpy = null
})

function makeStubTool(name: string, execImpl: ToolDef['exec'] = async () => 'ok'): ToolDef {
  return {
    name,
    description: `desc for ${name}`,
    parameters: {
      type: 'object',
      properties: { foo: { type: 'string' } },
      required: ['foo'],
    },
    exec: execImpl,
  }
}

describe('buildToolsForUser', () => {
  it('返回该 user 视角下全部 ToolDef wrap（全局 + per-user）', async () => {
    registry.register(makeStubTool('global_a'))
    registry.register(makeStubTool('global_b'))
    registry.registerForUser(42, makeStubTool('mcp__srv__foo'))

    const tools = await buildToolsForUser(42)
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['global_a', 'global_b', 'mcp__srv__foo'])

    // 跨 user 隔离：user 99 看不到 user 42 的 mcp 工具
    const tools99 = await buildToolsForUser(99)
    expect(tools99.map((t) => t.name).sort()).toEqual(['global_a', 'global_b'])
  })

  it('AgentTool.execute 透传 args 给 executeToolForUser 并包成 AgentToolResult', async () => {
    // 注:当前 signal 在 executeToolForUser 边界被丢弃(`_signal` 前缀),因为
    // 老 ToolDef.exec 协议没有 signal 参数。这里只断 args 透传 + 返回值
    // wrap shape。如未来给 ToolDef 加 signal-aware 抢占,补一条测覆盖 abort。
    const execSpy = vi.fn(async (args: Record<string, unknown>) => `got ${JSON.stringify(args)}`)
    registry.register(makeStubTool('echo', execSpy))

    const tools = await buildToolsForUser(7)
    const echo = tools.find((t) => t.name === 'echo')!
    const abort = new AbortController()
    const result = await echo.execute('call-1', { foo: 'bar' }, abort.signal)

    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(execSpy).toHaveBeenCalledWith({ foo: 'bar' })
    expect(result.content).toEqual([{ type: 'text', text: 'got {"foo":"bar"}' }])
    expect(result.details).toBe('got {"foo":"bar"}')
  })

  it('AgentTool.execute 抛错时直接 propagate（不吞、不变 isError）', async () => {
    registry.register(
      makeStubTool('boom', async () => {
        throw new Error('tool blew up')
      }),
    )

    const tools = await buildToolsForUser(1)
    const boom = tools.find((t) => t.name === 'boom')!
    await expect(boom.execute('call-2', { foo: 'x' })).rejects.toThrow('tool blew up')
  })

  it('AgentTool 字段映射：name / description / parameters / label 来自 ToolDef', async () => {
    const def = makeStubTool('schema_check')
    registry.register(def)

    const [tool] = await buildToolsForUser(1)
    expect(tool.name).toBe('schema_check')
    expect(tool.description).toBe('desc for schema_check')
    expect(tool.label).toBe('schema_check')
    expect(tool.parameters).toBe(def.parameters)
  })

  it('buildToolsForUser 调 getRegistry(userId).ensureInitialized （MCP 懒初始化）', async () => {
    const ensureInit = vi.fn(async () => undefined)
    ensureInitializedSpy!.mockReturnValue({
      ensureInitialized: ensureInit,
    } as unknown as ReturnType<typeof mcpRegistry.getRegistry>)

    await buildToolsForUser(123)
    expect(ensureInitializedSpy).toHaveBeenCalledWith(123)
    expect(ensureInit).toHaveBeenCalledTimes(1)
  })
})

describe('normalizeToolResultBlocks', () => {
  it('三 shape：string → 单 TextContent；Block[] 透传；其他对象 → JSON.stringify TextContent', () => {
    // string
    expect(normalizeToolResultBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }])

    // 已是合法 Block[]（包含 text + image）→ 过滤后透传
    const blockArr = [
      { type: 'text', text: 'a' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ]
    expect(normalizeToolResultBlocks(blockArr)).toEqual(blockArr)

    // 数组但无合法 block → 退化 JSON.stringify
    expect(normalizeToolResultBlocks([1, 2, 3])).toEqual([
      { type: 'text', text: '[1,2,3]' },
    ])

    // 任意对象 → JSON.stringify
    expect(normalizeToolResultBlocks({ result: 42 })).toEqual([
      { type: 'text', text: '{"result":42}' },
    ])

    // null / number 等 fallback
    expect(normalizeToolResultBlocks(null)).toEqual([{ type: 'text', text: 'null' }])
  })
})
