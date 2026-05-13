/**
 * Phase 12 Task G:to-anthropic translate 单测。
 *
 * 覆盖目标:
 * - system message:无 cacheControl → string;有 cacheControl → array
 * - 多 system messages → 只保留第一个
 * - user message:text / image / tool_result blocks 翻译
 * - assistant message:text / thinking / tool_use blocks 翻译
 * - canonical role:'tool' message → Anthropic user message + tool_result blocks
 * - cacheControl 标到最后一个 block
 * - input_schema sanitization:drop oneOf / allOf / anyOf / not / $ref(含 nested)
 * - 综合 multi-turn 场景
 */

import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type {
  CanonicalMessage,
  ImageBlock,
  TextBlock,
  ThinkingBlock,
  ToolDef,
  ToolResultBlock,
  ToolUseBlock,
} from '../types.js'
import {
  toAnthropicInput,
  toAnthropicTools,
  sanitizeForAnthropic,
} from '../translate/to-anthropic.js'

describe('toAnthropicInput — system field', () => {
  it('无 cacheControl 的 system message → system 为 string', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    ]
    const out = toAnthropicInput(msgs)
    expect(out.system).toBe('You are helpful.')
    expect(out.messages).toEqual([])
  })

  it('多 text blocks 的 system message → 拼成单 string', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).system).toBe('Part 1. Part 2.')
  })

  it('有 cacheControl 的 system message → system 为 array,最后一个 text 加 cache_control', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        cacheControl: { type: 'ephemeral' },
        content: [
          { type: 'text', text: 'preamble. ' },
          { type: 'text', text: 'cached body.' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).system).toEqual([
      { type: 'text', text: 'preamble. ' },
      { type: 'text', text: 'cached body.', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('全空 text(只含 thinking)的 system message → system 不输出', () => {
    const thinking: ThinkingBlock = { type: 'thinking', text: 'inner' }
    const msgs: CanonicalMessage[] = [{ role: 'system', content: [thinking] }]
    const out = toAnthropicInput(msgs)
    expect(out.system).toBeUndefined()
    expect(out.messages).toEqual([])
  })

  it('两个 system messages → 只保留第一个,后续 silent drop', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'first' }] },
      { role: 'system', content: [{ type: 'text', text: 'second-ignored' }] },
    ]
    const out = toAnthropicInput(msgs)
    expect(out.system).toBe('first')
  })

  it('空 messages → system undefined / messages 空', () => {
    expect(toAnthropicInput([])).toEqual({ messages: [] })
  })
})

describe('toAnthropicInput — user messages', () => {
  it('单 text user → role:user content:[{text}]', () => {
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    expect(toAnthropicInput(msgs).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ])
  })

  it('user 含 image block → 翻译成 image.source = base64', () => {
    const image: ImageBlock = {
      type: 'image',
      mediaType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAA',
    }
    const msgs: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '看这张' }, image] },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgoAAAA' },
          },
        ],
      },
    ])
  })

  it('user 含 tool_result block → 直接放在 user content 内(Anthropic 协议)', () => {
    const tr: ToolResultBlock = {
      type: 'tool_result',
      toolUseId: 'toolu_abc',
      content: 'ok',
    }
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [tr] }]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'ok' }],
      },
    ])
  })

  it('user 含多个 tool_result blocks + text(混合)→ 同 user content 内全保留', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_1', content: 'A' },
          { type: 'tool_result', toolUseId: 'call_2', content: 'B' },
          { type: 'text', text: 'thanks' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'A' },
          { type: 'tool_result', tool_use_id: 'call_2', content: 'B' },
          { type: 'text', text: 'thanks' },
        ],
      },
    ])
  })

  it('tool_result content=Block[] → 取 text blocks 拼接成 string', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'call_z',
            content: [
              { type: 'text', text: 'part1 ' },
              { type: 'image', mediaType: 'image/png', dataBase64: 'AAA' },
              { type: 'text', text: 'part2' },
            ],
          },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_z', content: 'part1 part2' }],
      },
    ])
  })

  it('tool_result isError=true → 设 is_error: true', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_err', content: 'boom', isError: true },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_err', content: 'boom', is_error: true },
        ],
      },
    ])
  })

  it('user 含 thinking / tool_use blocks → silent drop(只属 assistant)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'thinking', text: 'ignored' } as ThinkingBlock,
          { type: 'tool_use', id: 'x', name: 'y', input: {} } as ToolUseBlock,
          { type: 'text', text: 'real' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'real' }] },
    ])
  })

  it('user 全空 → 不输出 user message', () => {
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [] }]
    expect(toAnthropicInput(msgs).messages).toEqual([])
  })

  it('user 有 cacheControl → 最后一个 block 加 cache_control', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        cacheControl: { type: 'ephemeral' },
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: 'mark me' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: 'mark me', cache_control: { type: 'ephemeral' } },
        ],
      },
    ])
  })
})

describe('toAnthropicInput — assistant messages', () => {
  it('assistant 单 text → role:assistant', () => {
    const t: TextBlock = { type: 'text', text: 'sure' }
    expect(toAnthropicInput([{ role: 'assistant', content: [t] }]).messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'sure' }] },
    ])
  })

  it('assistant 含 thinking block → 翻译成 thinking block(signature 空串)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'pondering' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'pondering', signature: '' },
          { type: 'text', text: 'answer' },
        ],
      },
    ])
  })

  it('assistant tool_use → 翻译成 tool_use block', () => {
    const tu: ToolUseBlock = {
      type: 'tool_use',
      id: 'toolu_42',
      name: 'searchPages',
      input: { q: 'hello' },
    }
    expect(toAnthropicInput([{ role: 'assistant', content: [tu] }]).messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_42', name: 'searchPages', input: { q: 'hello' } },
        ],
      },
    ])
  })

  it('assistant tool_use.input=undefined → 序列化为 {}', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'x', name: 'y', input: undefined } as ToolUseBlock,
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }] },
    ])
  })

  it('assistant 全空 / 只含 image+tool_result → 不输出', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAA' },
          { type: 'tool_result', toolUseId: 'x', content: 'y' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([])
  })

  it('assistant thinking 在 tool_use 之前 → 保持原顺序(Anthropic spec 要求)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'reasoning' },
          { type: 'text', text: 'I will search' },
          { type: 'tool_use', id: 'tool1', name: 'search', input: { q: 'x' } },
        ],
      },
    ]
    const blocks = (toAnthropicInput(msgs).messages[0] as Anthropic.Messages.MessageParam).content
    expect(Array.isArray(blocks)).toBe(true)
    const arr = blocks as Anthropic.Messages.ContentBlockParam[]
    expect(arr[0]).toMatchObject({ type: 'thinking' })
    expect(arr[1]).toMatchObject({ type: 'text' })
    expect(arr[2]).toMatchObject({ type: 'tool_use' })
  })

  it('assistant 有 cacheControl → 最后 block 加 cache_control', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        cacheControl: { type: 'ephemeral' },
        content: [
          { type: 'text', text: 'final' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'final', cache_control: { type: 'ephemeral' } }],
      },
    ])
  })
})

describe('toAnthropicInput — role:tool message', () => {
  it('canonical role:tool message → 翻译成 Anthropic user message 含 tool_result', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'call_m', content: 'res' }],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_m', content: 'res' }],
      },
    ])
  })

  it('canonical role:tool 多个 tool_result blocks → 同 user message 内全保留', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'a', content: '1' },
          { type: 'tool_result', toolUseId: 'b', content: '2' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: '1' },
          { type: 'tool_result', tool_use_id: 'b', content: '2' },
        ],
      },
    ])
  })

  it('canonical role:tool 含非 tool_result blocks → 仅取 tool_result', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'text', text: 'noise' },
          { type: 'tool_result', toolUseId: 'real', content: 'ok' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'real', content: 'ok' }],
      },
    ])
  })

  it('canonical role:tool 无 tool_result → 不输出', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'tool', content: [{ type: 'text', text: 'noise' }] },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([])
  })

  it('canonical role:tool 有 cacheControl → 最后 tool_result 加 cache_control', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        cacheControl: { type: 'ephemeral' },
        content: [
          { type: 'tool_result', toolUseId: 'a', content: '1' },
          { type: 'tool_result', toolUseId: 'b', content: '2' },
        ],
      },
    ]
    expect(toAnthropicInput(msgs).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: '1' },
          {
            type: 'tool_result',
            tool_use_id: 'b',
            content: '2',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ])
  })
})

describe('toAnthropicInput — multi-turn 综合', () => {
  it('system + user + assistant(thinking+tool_use)+ user(tool_result) + user(text)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        cacheControl: { type: 'ephemeral' },
        content: [{ type: 'text', text: 'You are a helper.' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'find X' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'reason' },
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: 'tool_q', name: 'search', input: { q: 'X' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tool_q', content: 'found' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'summarize please' }],
      },
    ]

    const out = toAnthropicInput(msgs)
    expect(out.system).toEqual([
      { type: 'text', text: 'You are a helper.', cache_control: { type: 'ephemeral' } },
    ])
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'find X' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reason', signature: '' },
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: 'tool_q', name: 'search', input: { q: 'X' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool_q', content: 'found' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'summarize please' }] },
    ])
  })
})

describe('toAnthropicTools', () => {
  it('单 ToolDef → Anthropic Tool 形式', () => {
    const tools: ToolDef[] = [
      {
        name: 'mcp__notion__searchPages',
        description: 'Search Notion pages',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    ]
    expect(toAnthropicTools(tools)).toEqual([
      {
        name: 'mcp__notion__searchPages',
        description: 'Search Notion pages',
        input_schema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    ])
  })

  it('多 ToolDef → 按顺序映射', () => {
    const tools: ToolDef[] = [
      { name: 'a', description: 'desc a', inputSchema: { type: 'object' } },
      { name: 'b', description: 'desc b', inputSchema: { type: 'object' } },
    ]
    const out = toAnthropicTools(tools)
    expect(out).toHaveLength(2)
    expect(out[0]?.name).toBe('a')
    expect(out[1]?.name).toBe('b')
  })

  it('空 tools → 空数组', () => {
    expect(toAnthropicTools([])).toEqual([])
  })

  it('schema 含 oneOf → drop 并 console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tools: ToolDef[] = [
      {
        name: 'tool',
        description: 'd',
        inputSchema: {
          type: 'object',
          oneOf: [{ properties: { x: { type: 'string' } } }],
          properties: { y: { type: 'number' } },
        },
      },
    ]
    const out = toAnthropicTools(tools)
    expect(out[0]?.input_schema).toEqual({
      type: 'object',
      properties: { y: { type: 'number' } },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dropping unsupported schema field "oneOf"'),
    )
    warnSpy.mockRestore()
  })
})

describe('sanitizeForAnthropic', () => {
  it('顶层 oneOf / allOf / anyOf / not / $ref 都 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForAnthropic({
      type: 'object',
      oneOf: [{}],
      allOf: [{}],
      anyOf: [{}],
      not: {},
      $ref: '#/definitions/Foo',
      properties: { x: { type: 'string' } },
    })
    expect(out).toEqual({
      type: 'object',
      properties: { x: { type: 'string' } },
    })
    expect(warnSpy).toHaveBeenCalledTimes(5)
    warnSpy.mockRestore()
  })

  it('nested properties 内的 oneOf 也 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForAnthropic({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          oneOf: [{}],
          properties: { y: { type: 'number' } },
        },
      },
    })
    expect(out).toEqual({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { y: { type: 'number' } },
        },
      },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('properties.nested'),
    )
    warnSpy.mockRestore()
  })

  it('items 内的 oneOf 也 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForAnthropic({
      type: 'array',
      items: {
        type: 'object',
        oneOf: [{}],
        properties: { x: { type: 'string' } },
      },
    })
    expect(out).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { x: { type: 'string' } },
      },
    })
    warnSpy.mockRestore()
  })

  it('definitions 内部 schema 也递归 sanitize', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForAnthropic({
      type: 'object',
      definitions: {
        Inner: {
          type: 'object',
          oneOf: [{}],
          properties: { z: { type: 'boolean' } },
        },
      },
    })
    expect(out).toEqual({
      type: 'object',
      definitions: {
        Inner: {
          type: 'object',
          properties: { z: { type: 'boolean' } },
        },
      },
    })
    warnSpy.mockRestore()
  })

  it('additionalProperties 为 schema object 时递归 sanitize', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForAnthropic({
      type: 'object',
      additionalProperties: {
        type: 'string',
        anyOf: [{ pattern: '^a' }, { pattern: '^b' }],
      },
    })
    expect(out).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' },
    })
    warnSpy.mockRestore()
  })

  it('additionalProperties=false(boolean)不递归 / 保留', () => {
    const out = sanitizeForAnthropic({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
    expect(out).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
  })

  it('保留基础字段:type / enum / format / pattern / minLength / minimum / etc.', () => {
    const schema = {
      type: 'string',
      enum: ['a', 'b'],
      format: 'email',
      pattern: '^.+@.+$',
      minLength: 3,
      maxLength: 100,
      default: 'a',
    }
    expect(sanitizeForAnthropic(schema)).toEqual(schema)
  })

  it('空 schema → 空 object', () => {
    expect(sanitizeForAnthropic({})).toEqual({})
  })
})
