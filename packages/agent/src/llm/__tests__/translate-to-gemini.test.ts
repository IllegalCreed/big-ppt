/**
 * Phase 12 Task H:to-gemini translate 单测。
 *
 * 覆盖目标:
 * - system message:取 text 拼成 systemInstruction Content
 * - 多 system messages → 只保留第一个
 * - user message:text / image / tool_result blocks 翻译
 * - assistant message:text / tool_use → functionCall(thinking silent drop + warn)
 * - canonical role:'tool' message → Gemini user message + functionResponse parts
 * - functionResponse 用 name 匹配,从 id `gemini-fc-<hex>-<name>` 抽 name
 * - schema sanitization:drop additionalProperties / $ref / oneOf(含 nested)
 * - 综合 multi-turn 场景
 */

import { describe, expect, it, vi } from 'vitest'
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
  toGeminiInput,
  toGeminiTools,
  sanitizeForGemini,
} from '../translate/to-gemini.js'

describe('toGeminiInput — systemInstruction', () => {
  it('单 text system message → systemInstruction Content', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'You are helpful.' }] },
    ]
    const out = toGeminiInput(msgs)
    expect(out.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'You are helpful.' }],
    })
    expect(out.contents).toEqual([])
  })

  it('多 text blocks 的 system message → 拼成单 text', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
      },
    ]
    expect(toGeminiInput(msgs).systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'Part 1. Part 2.' }],
    })
  })

  it('cacheControl 在 system 上 → silent drop(Gemini 没等价机制)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        cacheControl: { type: 'ephemeral' },
        content: [{ type: 'text', text: 'cached prompt' }],
      },
    ]
    expect(toGeminiInput(msgs).systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'cached prompt' }],
    })
  })

  it('全空 text(只含 thinking)的 system message → systemInstruction undefined', () => {
    const thinking: ThinkingBlock = { type: 'thinking', text: 'inner' }
    const msgs: CanonicalMessage[] = [{ role: 'system', content: [thinking] }]
    const out = toGeminiInput(msgs)
    expect(out.systemInstruction).toBeUndefined()
    expect(out.contents).toEqual([])
  })

  it('两个 system messages → 只保留第一个,后续 silent drop', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'first' }] },
      { role: 'system', content: [{ type: 'text', text: 'second-ignored' }] },
    ]
    const out = toGeminiInput(msgs)
    expect(out.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'first' }],
    })
  })

  it('空 messages → systemInstruction undefined / contents 空', () => {
    expect(toGeminiInput([])).toEqual({ contents: [] })
  })
})

describe('toGeminiInput — user messages', () => {
  it('单 text user → role:user parts:[{text}]', () => {
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    expect(toGeminiInput(msgs).contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
    ])
  })

  it('user 含 image block → 翻译成 inlineData', () => {
    const image: ImageBlock = {
      type: 'image',
      mediaType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAA',
    }
    const msgs: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '看这张' }, image] },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: '看这张' },
          { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAA' } },
        ],
      },
    ])
  })

  it('user 含 tool_result block → 直接放在 user parts 内(Gemini 协议)', () => {
    const tr: ToolResultBlock = {
      type: 'tool_result',
      toolUseId: 'gemini-fc-abc12345-searchPages',
      content: 'ok',
    }
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [tr] }]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'searchPages',
              response: { content: 'ok' },
            },
          },
        ],
      },
    ])
  })

  it('tool_result id 不符合 gemini-fc-<hex>-<name> 格式 → fallback 用整 id 当 name', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'arbitrary-id', content: 'res' }],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: { name: 'arbitrary-id', response: { content: 'res' } },
          },
        ],
      },
    ])
  })

  it('tool_result content=Block[] → 取 text blocks 拼接,包成 response.content', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'gemini-fc-deadbeef-doThing',
            content: [
              { type: 'text', text: 'part1 ' },
              { type: 'image', mediaType: 'image/png', dataBase64: 'AAA' },
              { type: 'text', text: 'part2' },
            ],
          },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'doThing',
              response: { content: 'part1 part2' },
            },
          },
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
    expect(toGeminiInput(msgs).contents).toEqual([
      { role: 'user', parts: [{ text: 'real' }] },
    ])
  })

  it('user 全空 → 不输出 user content', () => {
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [] }]
    expect(toGeminiInput(msgs).contents).toEqual([])
  })
})

describe('toGeminiInput — assistant messages', () => {
  it('assistant 单 text → role:model parts:[{text}]', () => {
    const t: TextBlock = { type: 'text', text: 'sure' }
    expect(toGeminiInput([{ role: 'assistant', content: [t] }]).contents).toEqual([
      { role: 'model', parts: [{ text: 'sure' }] },
    ])
  })

  it('assistant 含 thinking block → silent drop + console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'pondering' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      { role: 'model', parts: [{ text: 'answer' }] },
    ])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dropping ThinkingBlock'),
    )
    warnSpy.mockRestore()
  })

  it('assistant tool_use → 翻译成 functionCall part', () => {
    const tu: ToolUseBlock = {
      type: 'tool_use',
      id: 'gemini-fc-abcd1234-searchPages',
      name: 'searchPages',
      input: { q: 'hello' },
    }
    expect(toGeminiInput([{ role: 'assistant', content: [tu] }]).contents).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { name: 'searchPages', args: { q: 'hello' } } }],
      },
    ])
  })

  it('assistant tool_use.input=undefined → args 为 {}', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'x', name: 'y', input: undefined } as ToolUseBlock,
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { name: 'y', args: {} } }],
      },
    ])
  })

  it('assistant tool_use.input 是 primitive → 包成 { value }', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'x', name: 'y', input: 'string-input' } as ToolUseBlock,
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { name: 'y', args: { value: 'string-input' } } }],
      },
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
    expect(toGeminiInput(msgs).contents).toEqual([])
  })

  it('assistant 多 part(text + functionCall)→ 保持顺序', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will search' },
          { type: 'tool_use', id: 'tool1', name: 'search', input: { q: 'x' } },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'I will search' },
          { functionCall: { name: 'search', args: { q: 'x' } } },
        ],
      },
    ])
  })
})

describe('toGeminiInput — role:tool message', () => {
  it('canonical role:tool message → 翻译成 Gemini user message 含 functionResponse', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'gemini-fc-cafebabe-myFn',
            content: 'res',
          },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'myFn', response: { content: 'res' } } }],
      },
    ])
  })

  it('canonical role:tool 多个 tool_result blocks → 同 user content 内全保留', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'gemini-fc-1111aaaa-a', content: '1' },
          { type: 'tool_result', toolUseId: 'gemini-fc-2222bbbb-b', content: '2' },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'a', response: { content: '1' } } },
          { functionResponse: { name: 'b', response: { content: '2' } } },
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
          { type: 'tool_result', toolUseId: 'gemini-fc-aaaa1234-real', content: 'ok' },
        ],
      },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'real', response: { content: 'ok' } } }],
      },
    ])
  })

  it('canonical role:tool 无 tool_result → 不输出', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'tool', content: [{ type: 'text', text: 'noise' }] },
    ]
    expect(toGeminiInput(msgs).contents).toEqual([])
  })
})

describe('toGeminiInput — multi-turn 综合', () => {
  it('system + user + assistant(text+tool_use)+ tool(tool_result) + user(text)', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'You are a helper.' }] },
      { role: 'user', content: [{ type: 'text', text: 'find X' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching' },
          {
            type: 'tool_use',
            id: 'gemini-fc-deadc0de-search',
            name: 'search',
            input: { q: 'X' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'gemini-fc-deadc0de-search',
            content: 'found',
          },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'summarize please' }] },
    ]

    const out = toGeminiInput(msgs)
    expect(out.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'You are a helper.' }],
    })
    expect(out.contents).toEqual([
      { role: 'user', parts: [{ text: 'find X' }] },
      {
        role: 'model',
        parts: [
          { text: 'searching' },
          { functionCall: { name: 'search', args: { q: 'X' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'search', response: { content: 'found' } } },
        ],
      },
      { role: 'user', parts: [{ text: 'summarize please' }] },
    ])
  })
})

describe('toGeminiTools', () => {
  it('单 ToolDef → Gemini Tool[] 形式(单 Tool 含 functionDeclarations)', () => {
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
    expect(toGeminiTools(tools)).toEqual([
      {
        functionDeclarations: [
          {
            name: 'mcp__notion__searchPages',
            description: 'Search Notion pages',
            parameters: {
              type: 'object',
              properties: { q: { type: 'string' } },
              required: ['q'],
            },
          },
        ],
      },
    ])
  })

  it('多 ToolDef → 同一 Tool 容器内 functionDeclarations 数组', () => {
    const tools: ToolDef[] = [
      { name: 'a', description: 'desc a', inputSchema: { type: 'object' } },
      { name: 'b', description: 'desc b', inputSchema: { type: 'object' } },
    ]
    const out = toGeminiTools(tools)
    expect(out).toHaveLength(1)
    expect(out[0]?.functionDeclarations).toHaveLength(2)
    expect(out[0]?.functionDeclarations?.[0]?.name).toBe('a')
    expect(out[0]?.functionDeclarations?.[1]?.name).toBe('b')
  })

  it('空 tools → 单 Tool 含空 functionDeclarations', () => {
    expect(toGeminiTools([])).toEqual([{ functionDeclarations: [] }])
  })

  it('schema 含 additionalProperties → drop 并 console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tools: ToolDef[] = [
      {
        name: 'tool',
        description: 'd',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { y: { type: 'number' } },
        },
      },
    ]
    const out = toGeminiTools(tools)
    expect(out[0]?.functionDeclarations?.[0]?.parameters).toEqual({
      type: 'object',
      properties: { y: { type: 'number' } },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dropping unsupported schema field "additionalProperties"'),
    )
    warnSpy.mockRestore()
  })
})

describe('sanitizeForGemini', () => {
  it('顶层 additionalProperties / $ref / oneOf 都 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForGemini({
      type: 'object',
      additionalProperties: true,
      $ref: '#/definitions/Foo',
      oneOf: [{}, {}],
      properties: { x: { type: 'string' } },
    })
    expect(out).toEqual({
      type: 'object',
      properties: { x: { type: 'string' } },
    })
    expect(warnSpy).toHaveBeenCalledTimes(3)
    warnSpy.mockRestore()
  })

  it('nested properties 内的 additionalProperties 也 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForGemini({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          additionalProperties: false,
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

  it('items 内的 $ref 也 drop', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = sanitizeForGemini({
      type: 'array',
      items: {
        type: 'object',
        $ref: '#/x',
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
    const out = sanitizeForGemini({
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

  it('保留基础字段:type / enum / format / pattern / nullable / etc.', () => {
    const schema = {
      type: 'string',
      enum: ['a', 'b'],
      format: 'email',
      pattern: '^.+@.+$',
      minLength: 3,
      maxLength: 100,
      default: 'a',
      nullable: true,
    }
    expect(sanitizeForGemini(schema)).toEqual(schema)
  })

  it('空 schema → 空 object', () => {
    expect(sanitizeForGemini({})).toEqual({})
  })

  it('anyOf 字段保留(Gemini 支持)', () => {
    const out = sanitizeForGemini({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    })
    expect(out).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    })
  })
})
