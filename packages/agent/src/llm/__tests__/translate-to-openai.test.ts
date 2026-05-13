/**
 * Phase 12 Task C：to-openai translate 单测。
 *
 * 覆盖目标:
 * - 5 种 Block 类型(text / image / thinking / tool_use / tool_result)的翻译
 * - 4 种 role(system / user / assistant / tool)
 * - tool_result 拆分:user message 含多个 tool_result blocks → N 条 role:'tool' messages
 * - assistant mixed:text + tool_use 同时存在
 * - 多模态:image block → data URL
 * - thinking silent drop
 * - tool 翻译:ToolDef → OpenAI function tool shape
 */

import { describe, expect, it } from 'vitest'
import type {
  Block,
  CanonicalMessage,
  ImageBlock,
  TextBlock,
  ThinkingBlock,
  ToolDef,
  ToolResultBlock,
  ToolUseBlock,
} from '../types.js'
import { toOpenAIMessages, toOpenAITools } from '../translate/to-openai.js'

describe('toOpenAIMessages', () => {
  it('单 text user message → role:user / content:string(单 part 优化)', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('多 text user message → 拼成单 string(其实退化成 content array,因 length>1)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'part1 ' },
          { type: 'text', text: 'part2' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'part1 ' },
          { type: 'text', text: 'part2' },
        ],
      },
    ])
  })

  it('user message 带 image block → content array 含 image_url 形式 data URL', () => {
    const imageBlock: ImageBlock = {
      type: 'image',
      mediaType: 'image/png',
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAA',
    }
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: '看这张图' }, imageBlock],
      },
    ]
    const out = toOpenAIMessages(msgs)
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA' },
          },
        ],
      },
    ])
  })

  it('image block 用 image/jpeg mediaType → data URL 前缀对应', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'image', mediaType: 'image/jpeg', dataBase64: 'AAAA' } as ImageBlock,
        ],
      },
    ]
    const out = toOpenAIMessages(msgs)
    expect(out[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }],
    })
  })

  it('system message:多 text blocks 拼接成单 string', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'You are ' },
          { type: 'text', text: 'helpful.' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([{ role: 'system', content: 'You are helpful.' }])
  })

  it('system message:全空(无 text block)→ 不输出', () => {
    const thinking: ThinkingBlock = { type: 'thinking', text: 'pondering' }
    const msgs: CanonicalMessage[] = [
      { role: 'system', content: [thinking] }, // 非 text block 在 system 下被 drop
    ]
    expect(toOpenAIMessages(msgs)).toEqual([])
  })

  it('assistant text-only → content:string,无 tool_calls 字段', () => {
    const text: TextBlock = { type: 'text', text: 'sure thing' }
    const msgs: CanonicalMessage[] = [{ role: 'assistant', content: [text] }]
    expect(toOpenAIMessages(msgs)).toEqual([{ role: 'assistant', content: 'sure thing' }])
  })

  it('assistant tool_use only → content:null + tool_calls 数组', () => {
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: 'call_42',
      name: 'searchPages',
      input: { q: 'hi' },
    }
    const msgs: CanonicalMessage[] = [{ role: 'assistant', content: [toolUse] }]
    expect(toOpenAIMessages(msgs)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_42',
            type: 'function',
            function: { name: 'searchPages', arguments: '{"q":"hi"}' },
          },
        ],
      },
    ])
  })

  it('assistant mixed:text + tool_use 同时存在 → content:string + tool_calls 共存', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will look it up.' },
          {
            type: 'tool_use',
            id: 'call_99',
            name: 'lookup',
            input: { x: 1 },
          },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      {
        role: 'assistant',
        content: 'I will look it up.',
        tool_calls: [
          {
            id: 'call_99',
            type: 'function',
            function: { name: 'lookup', arguments: '{"x":1}' },
          },
        ],
      },
    ])
  })

  it('assistant 含 thinking block → silent drop(不影响其他 blocks)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'let me think...' },
          { type: 'text', text: 'final answer' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'assistant', content: 'final answer' },
    ])
  })

  it('assistant 含 tool_use.input=undefined → 序列化成 {}', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_no_input',
            name: 'noargs',
            input: undefined,
          } as ToolUseBlock,
        ],
      },
    ]
    const out = toOpenAIMessages(msgs)[0] as {
      tool_calls: Array<{ function: { arguments: string } }>
    }
    expect(out.tool_calls[0]!.function.arguments).toBe('{}')
  })

  it('assistant 全空(只有 thinking + image)→ 不输出', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'pondering' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([])
  })

  it('user message 含单个 tool_result block → 拆出 1 条 role:tool message,不输出 user', () => {
    const toolRes: ToolResultBlock = {
      type: 'tool_result',
      toolUseId: 'call_a',
      content: '{"ok":true}',
    }
    const msgs: CanonicalMessage[] = [{ role: 'user', content: [toolRes] }]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_a' },
    ])
  })

  it('user message 含 N 个 tool_result blocks → 拆成 N 条 role:tool messages(保序)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_1', content: 'result A' },
          { type: 'tool_result', toolUseId: 'call_2', content: 'result B' },
          { type: 'tool_result', toolUseId: 'call_3', content: 'result C' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: 'result A', tool_call_id: 'call_1' },
      { role: 'tool', content: 'result B', tool_call_id: 'call_2' },
      { role: 'tool', content: 'result C', tool_call_id: 'call_3' },
    ])
  })

  it('user message tool_result + text 混合 → tool messages 在前,user message 在后', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_x', content: 'result' },
          { type: 'text', text: 'now what?' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: 'result', tool_call_id: 'call_x' },
      { role: 'user', content: 'now what?' },
    ])
  })

  it('tool_result content=Block[] → 仅保留 text blocks 拼接', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'call_z',
            content: [
              { type: 'text', text: 'part1 ' },
              { type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' }, // 被 drop
              { type: 'text', text: 'part2' },
            ],
          },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: 'part1 part2', tool_call_id: 'call_z' },
    ])
  })

  it('tool_result isError=true → content 加 [ERROR] 前缀', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_err', content: 'oops', isError: true },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: '[ERROR] oops', tool_call_id: 'call_err' },
    ])
  })

  it('canonical role:tool message 直接含 tool_result blocks → 也走 tool message 拆分', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool_result', toolUseId: 'call_m', content: 'direct tool result' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'tool', content: 'direct tool result', tool_call_id: 'call_m' },
    ])
  })

  it('multi-turn 综合:system + user + assistant(tool_use) + user(tool_result) + user(text)', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'You are a helper.' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'find me X' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: '...' }, // drop
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: 'call_q', name: 'search', input: { q: 'X' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_q', content: 'found' },
          { type: 'text', text: 'great, summarize' },
        ],
      },
    ]
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'find me X' },
      {
        role: 'assistant',
        content: 'searching',
        tool_calls: [
          {
            id: 'call_q',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"X"}' },
          },
        ],
      },
      { role: 'tool', content: 'found', tool_call_id: 'call_q' },
      { role: 'user', content: 'great, summarize' },
    ])
  })

  it('空 messages → 空数组', () => {
    expect(toOpenAIMessages([])).toEqual([])
  })

  it('user message 全空 → 不输出 user(也不输出 tool)', () => {
    const blocks: Block[] = [] // empty
    expect(toOpenAIMessages([{ role: 'user', content: blocks }])).toEqual([])
  })
})

describe('toOpenAITools', () => {
  it('单 ToolDef → OpenAI function tool 包装', () => {
    const tools: ToolDef[] = [
      {
        name: 'mcp__notion__searchPages',
        description: 'Search Notion pages by query',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    ]
    expect(toOpenAITools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'mcp__notion__searchPages',
          description: 'Search Notion pages by query',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string' } },
            required: ['q'],
          },
        },
      },
    ])
  })

  it('多 ToolDef → 按顺序包装', () => {
    const tools: ToolDef[] = [
      { name: 'a', description: 'desc a', inputSchema: { type: 'object' } },
      { name: 'b', description: 'desc b', inputSchema: { type: 'object' } },
    ]
    const out = toOpenAITools(tools)
    expect(out).toHaveLength(2)
    // ChatCompletionTool 是 function | custom 的 union;narrow 到 function 后断言
    expect(out[0]?.type).toBe('function')
    expect(out[1]?.type).toBe('function')
    if (out[0]?.type === 'function' && out[1]?.type === 'function') {
      expect(out[0].function.name).toBe('a')
      expect(out[1].function.name).toBe('b')
    }
  })

  it('空 tools → 空数组', () => {
    expect(toOpenAITools([])).toEqual([])
  })
})
