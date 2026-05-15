import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  Block,
  CanonicalEvent,
  CanonicalMessage,
  ImageBlock,
  TextBlock,
  ThinkingBlock,
  ToolDef,
  ToolResultBlock,
  ToolUseBlock,
} from '../types.js'

/**
 * Phase 12 Task B canonical 类型断言:
 *
 * 重点是**编译期断言 union exhaustive**——TypeScript switch case 全覆盖
 * 后,加新 Block / Event 类型时未覆盖分支会编译报错,运行时永远跑不到
 * `assertNever`。这比"运行时跑一遍每个 case"更值钱(union 漏判全靠
 * 类型系统抓)。
 */

function assertNever(x: never): never {
  throw new Error(`unexpected union member: ${JSON.stringify(x)}`)
}

describe('canonical types', () => {
  it('Block union exhaustive (switch 全覆盖 → 加新类型必编译错)', () => {
    const blocks: Block[] = [
      { type: 'text', text: 'hi' },
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' },
      { type: 'thinking', text: 'pondering' },
      { type: 'tool_use', id: 't1', name: 'searchPages', input: { q: 'hello' } },
      {
        type: 'tool_result',
        toolUseId: 't1',
        content: 'ok',
      },
    ]

    const seen: string[] = []
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          expectTypeOf(block).toEqualTypeOf<TextBlock>()
          seen.push('text')
          break
        case 'image':
          expectTypeOf(block).toEqualTypeOf<ImageBlock>()
          seen.push('image')
          break
        case 'thinking':
          expectTypeOf(block).toEqualTypeOf<ThinkingBlock>()
          seen.push('thinking')
          break
        case 'tool_use':
          expectTypeOf(block).toEqualTypeOf<ToolUseBlock>()
          seen.push('tool_use')
          break
        case 'tool_result':
          expectTypeOf(block).toEqualTypeOf<ToolResultBlock>()
          seen.push('tool_result')
          break
        default:
          // 加新 block type 而未覆盖会让 block 类型不为 never,编译期红测
          assertNever(block)
      }
    }

    expect(seen).toEqual(['text', 'image', 'thinking', 'tool_use', 'tool_result'])
  })

  it('ToolResultBlock content 允许 string 或 Block[]', () => {
    const stringContent: ToolResultBlock = {
      type: 'tool_result',
      toolUseId: 'call_1',
      content: 'plain text result',
    }
    const blockContent: ToolResultBlock = {
      type: 'tool_result',
      toolUseId: 'call_2',
      content: [
        { type: 'text', text: 'multi-block ' },
        { type: 'image', mediaType: 'image/jpeg', dataBase64: 'BBBB' },
      ],
      isError: true,
    }
    expectTypeOf(stringContent.content).toEqualTypeOf<string | Block[]>()
    expectTypeOf(blockContent.content).toEqualTypeOf<string | Block[]>()
    expect(typeof stringContent.content).toBe('string')
    expect(Array.isArray(blockContent.content)).toBe(true)
    expect(blockContent.isError).toBe(true)
  })

  it('CanonicalEvent union exhaustive (13 类全覆盖 — 原 8 类 + Phase 12.7 新增 5 类)', () => {
    const events: CanonicalEvent[] = [
      { type: 'text.delta', text: 'hello' },
      { type: 'tool_call.start', id: 't1', name: 'searchPages' },
      { type: 'tool_call.delta', id: 't1', argsChunk: '{"q":"' },
      { type: 'tool_call.end', id: 't1' },
      { type: 'thinking.delta', text: 'pondering' },
      { type: 'cache.hit', cachedTokens: 100, costTokens: 5 },
      { type: 'finish', reason: 'stop', usage: { input: 10, output: 20 } },
      { type: 'error', code: 'rate_limit', message: 'too fast' },
      // Phase 12.7 新增:turn / tool_execution
      { type: 'turn.start', turnId: 'turn_1' },
      { type: 'turn.end', usage: { input: 10, output: 20 }, reason: 'stop' },
      { type: 'tool_execution.start', toolCallId: 't1', toolName: 'searchPages' },
      { type: 'tool_execution.delta', toolCallId: 't1', partial: { count: 3 } },
      { type: 'tool_execution.end', toolCallId: 't1', isError: false },
    ]

    const seen: string[] = []
    for (const event of events) {
      switch (event.type) {
        case 'text.delta':
          seen.push('text.delta')
          break
        case 'tool_call.start':
          seen.push('tool_call.start')
          break
        case 'tool_call.delta':
          seen.push('tool_call.delta')
          break
        case 'tool_call.end':
          seen.push('tool_call.end')
          break
        case 'thinking.delta':
          seen.push('thinking.delta')
          break
        case 'cache.hit':
          seen.push('cache.hit')
          break
        case 'finish':
          seen.push('finish')
          break
        case 'error':
          seen.push('error')
          break
        case 'turn.start':
          seen.push('turn.start')
          break
        case 'turn.end':
          seen.push('turn.end')
          break
        case 'tool_execution.start':
          seen.push('tool_execution.start')
          break
        case 'tool_execution.delta':
          seen.push('tool_execution.delta')
          break
        case 'tool_execution.end':
          seen.push('tool_execution.end')
          break
        default:
          assertNever(event)
      }
    }

    expect(seen).toEqual([
      'text.delta',
      'tool_call.start',
      'tool_call.delta',
      'tool_call.end',
      'thinking.delta',
      'cache.hit',
      'finish',
      'error',
      'turn.start',
      'turn.end',
      'tool_execution.start',
      'tool_execution.delta',
      'tool_execution.end',
    ])
  })

  it('CanonicalMessage 结构 + cacheControl 可选', () => {
    const msg: CanonicalMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    }
    const cached: CanonicalMessage = {
      role: 'system',
      content: [{ type: 'text', text: 'You are a helpful assistant.' }],
      cacheControl: { type: 'ephemeral' },
    }
    expectTypeOf(msg.role).toEqualTypeOf<'system' | 'user' | 'assistant' | 'tool'>()
    expect(cached.cacheControl?.type).toBe('ephemeral')
    expect(msg.cacheControl).toBeUndefined()
  })

  it('ToolDef inputSchema 为 JSON Schema 派生(Record<string, unknown>)', () => {
    const tool: ToolDef = {
      name: 'mcp__notion__searchPages',
      description: 'Search Notion pages by query',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    }
    expectTypeOf(tool.inputSchema).toEqualTypeOf<Record<string, unknown>>()
    expect(tool.name).toBe('mcp__notion__searchPages')
  })

  it('finish event reason 为 4 选 1 union', () => {
    const reasons: CanonicalEvent[] = [
      { type: 'finish', reason: 'stop', usage: { input: 1, output: 2 } },
      { type: 'finish', reason: 'length', usage: { input: 1, output: 2 } },
      { type: 'finish', reason: 'tool_use', usage: { input: 1, output: 2 } },
      { type: 'finish', reason: 'content_filter', usage: { input: 1, output: 2 } },
    ]
    expect(reasons).toHaveLength(4)
  })

  it('TokenUsage.cached 可选(non-Anthropic 留空)', () => {
    const usage = { input: 100, output: 50 }
    const withCache = { input: 100, output: 50, cached: 80 }
    const finishWithoutCache: CanonicalEvent = { type: 'finish', reason: 'stop', usage }
    const finishWithCache: CanonicalEvent = { type: 'finish', reason: 'stop', usage: withCache }
    expect(finishWithoutCache.type).toBe('finish')
    expect(finishWithCache.type).toBe('finish')
  })
})
