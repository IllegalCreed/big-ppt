/**
 * Phase 12 Task F:chat-row.ts(rowToCanonical / canonicalToRow / legacyRowToCanonical)单测。
 *
 * 覆盖:
 * 1. rowToCanonical 双路径:含 canonicalContent / 仅 legacy fallback
 * 2. legacyRowToCanonical 4 类历史 row 形态:
 *    - role='tool' content=tool result text toolCallId='tc-1'
 *    - role='assistant' content=OpenAI delta JSON 含 text + tool_calls
 *    - role='assistant' content=纯文本(老 turn 没 tool)
 *    - role='user' / 'system' content=纯文本
 * 3. canonicalToRow round-trip:canonicalToRow → rowToCanonical 等价(canonicalContent 走优先路径)
 * 4. 边缘:canonicalContent 损坏 JSON / canonicalContent 非数组 → fallback legacy
 */
import { describe, expect, it } from 'vitest'
import { canonicalToRow, legacyRowToCanonical, rowToCanonical } from '../chat-row.js'
import type { CanonicalMessage } from '../types.js'

describe('rowToCanonical', () => {
  it('canonicalContent 优先:有 JSON Block[] 时直接 parse', () => {
    const blocks = [{ type: 'text', text: 'hello canonical' }]
    const result = rowToCanonical({
      role: 'user',
      content: 'old text(ignored)',
      toolCallId: null,
      canonicalContent: JSON.stringify(blocks),
    })
    expect(result).toEqual({ role: 'user', content: blocks })
  })

  it('canonicalContent NULL → 走 legacy fallback', () => {
    const result = rowToCanonical({
      role: 'user',
      content: 'plain text',
      toolCallId: null,
      canonicalContent: null,
    })
    expect(result).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'plain text' }],
    })
  })

  it('canonicalContent 损坏 JSON → 容错降级 legacy', () => {
    const result = rowToCanonical({
      role: 'assistant',
      content: 'fallback text',
      toolCallId: null,
      canonicalContent: '{not-valid-json',
    })
    expect(result.role).toBe('assistant')
    expect(result.content).toEqual([{ type: 'text', text: 'fallback text' }])
  })

  it('canonicalContent 是合法 JSON 但不是数组 → 降级 legacy', () => {
    const result = rowToCanonical({
      role: 'assistant',
      content: 'fallback',
      toolCallId: null,
      canonicalContent: JSON.stringify({ type: 'not-array' }),
    })
    expect(result.content).toEqual([{ type: 'text', text: 'fallback' }])
  })

  it('canonicalContent 空数组 → 直接用空数组(不降级)', () => {
    // empty array 是有效 canonical(虽然没意义),让 caller 自己决定怎么显示
    const result = rowToCanonical({
      role: 'user',
      content: 'should not be used',
      toolCallId: null,
      canonicalContent: '[]',
    })
    expect(result).toEqual({ role: 'user', content: [] })
  })
})

describe('legacyRowToCanonical(4 类历史 row 形态)', () => {
  it("role='tool':content=tool result text + toolCallId → ToolResultBlock", () => {
    const result = legacyRowToCanonical({
      role: 'tool',
      content: '{"images":[{"id":"asset-1"}]}',
      toolCallId: 'tc-abc',
    })
    expect(result).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'tc-abc',
          content: '{"images":[{"id":"asset-1"}]}',
        },
      ],
    })
  })

  it("role='tool' toolCallId 为 NULL → toolUseId 用空串", () => {
    const result = legacyRowToCanonical({
      role: 'tool',
      content: 'no-id-result',
      toolCallId: null,
    })
    expect(result.content[0]).toMatchObject({ type: 'tool_result', toolUseId: '' })
  })

  it("role='assistant':content=OpenAI delta JSON 含 content + tool_calls → text + 多 ToolUseBlock 顺序保留", () => {
    const content = JSON.stringify({
      content: 'thinking aloud...',
      tool_calls: [
        { id: 'tc-1', function: { name: 'edit_slide', arguments: '{"index":2}' } },
        { id: 'tc-2', function: { name: 'generate_image', arguments: '{"prompt":"sunrise"}' } },
      ],
    })
    const result = legacyRowToCanonical({
      role: 'assistant',
      content,
      toolCallId: null,
    })
    expect(result).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking aloud...' },
        { type: 'tool_use', id: 'tc-1', name: 'edit_slide', input: { index: 2 } },
        { type: 'tool_use', id: 'tc-2', name: 'generate_image', input: { prompt: 'sunrise' } },
      ],
    })
  })

  it("role='assistant':OpenAI delta 的 tool_calls.arguments parse 失败 → 当字符串保留", () => {
    const content = JSON.stringify({
      content: null,
      tool_calls: [{ id: 'tc-x', function: { name: 'bad', arguments: 'not-json-args' } }],
    })
    const result = legacyRowToCanonical({ role: 'assistant', content, toolCallId: null })
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'tc-x', name: 'bad', input: 'not-json-args' },
    ])
  })

  it("role='assistant':content=纯文本(非 JSON)→ 单 TextBlock", () => {
    const result = legacyRowToCanonical({
      role: 'assistant',
      content: 'just a plain reply',
      toolCallId: null,
    })
    expect(result).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'just a plain reply' }],
    })
  })

  it("role='assistant':content 是合法 JSON 但不是 OpenAI shape(如 \"{}\") → 当文本保留", () => {
    const result = legacyRowToCanonical({
      role: 'assistant',
      content: '"hello"',
      toolCallId: null,
    })
    expect(result.content).toEqual([{ type: 'text', text: '"hello"' }])
  })

  it("role='assistant':OpenAI shape 但 content 字段缺失 + tool_calls 字段在 → 只 tool_use blocks", () => {
    const content = JSON.stringify({
      tool_calls: [{ id: 'tc-1', function: { name: 'foo', arguments: '{}' } }],
    })
    const result = legacyRowToCanonical({ role: 'assistant', content, toolCallId: null })
    expect(result.content).toEqual([{ type: 'tool_use', id: 'tc-1', name: 'foo', input: {} }])
  })

  it("role='assistant':OpenAI shape 但 content 是空串 + tool_calls 也空 → fallback 整个 row.content 当文本", () => {
    const content = JSON.stringify({ content: '', tool_calls: [] })
    const result = legacyRowToCanonical({ role: 'assistant', content, toolCallId: null })
    // 没生成任何 block → 走 fallback: text=row.content(完整 JSON 字符串)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: 'text', text: content })
  })

  it("role='user':content=纯文本 → TextBlock", () => {
    const result = legacyRowToCanonical({
      role: 'user',
      content: '帮我把第 2 页加张图',
      toolCallId: null,
    })
    expect(result).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '帮我把第 2 页加张图' }],
    })
  })

  it("role='system':content=纯文本 → TextBlock", () => {
    const result = legacyRowToCanonical({
      role: 'system',
      content: 'You are an AI presentation assistant.',
      toolCallId: null,
    })
    expect(result).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'You are an AI presentation assistant.' }],
    })
  })
})

describe('canonicalToRow', () => {
  it('user TextBlock:content=text,toolCallId=null', () => {
    const msg: CanonicalMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    }
    expect(canonicalToRow(msg)).toEqual({
      content: 'hi',
      toolCallId: null,
      canonicalContent: JSON.stringify(msg.content),
    })
  })

  it('tool ToolResultBlock:toolCallId 取 toolUseId,content 拍平', () => {
    const msg: CanonicalMessage = {
      role: 'tool',
      content: [{ type: 'tool_result', toolUseId: 'tc-9', content: 'result text' }],
    }
    const row = canonicalToRow(msg)
    expect(row.toolCallId).toBe('tc-9')
    expect(row.content).toBe('result text')
    expect(row.canonicalContent).toBe(JSON.stringify(msg.content))
  })

  it('assistant text + tool_use:toolCallId 取首个 tool_use.id', () => {
    const msg: CanonicalMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: '思考中...' },
        { type: 'tool_use', id: 'tc-1', name: 'foo', input: { a: 1 } },
        { type: 'tool_use', id: 'tc-2', name: 'bar', input: {} },
      ],
    }
    const row = canonicalToRow(msg)
    expect(row.toolCallId).toBe('tc-1')
    expect(row.content).toBe('思考中...') // 仅 text + tool_result 拍入 content;tool_use 跳过
    expect(JSON.parse(row.canonicalContent)).toEqual(msg.content)
  })

  it('tool_result.content 是 Block[](嵌套结构)→ 递归拍平', () => {
    const msg: CanonicalMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'tc-1',
          content: [
            { type: 'text', text: 'part-A ' },
            { type: 'text', text: 'part-B' },
          ],
        },
      ],
    }
    const row = canonicalToRow(msg)
    expect(row.content).toBe('part-A part-B')
  })

  it('全 thinking blocks(没 text / tool)→ content 空串', () => {
    const msg: CanonicalMessage = {
      role: 'assistant',
      content: [{ type: 'thinking', text: 'silent thoughts' }],
    }
    const row = canonicalToRow(msg)
    expect(row.content).toBe('')
    expect(row.toolCallId).toBe(null)
  })

  it('空 content[] → 全 null/empty', () => {
    const msg: CanonicalMessage = { role: 'user', content: [] }
    expect(canonicalToRow(msg)).toEqual({
      content: '',
      toolCallId: null,
      canonicalContent: '[]',
    })
  })
})

describe('round-trip:canonicalToRow → rowToCanonical 等价', () => {
  const cases: Array<{ name: string; msg: CanonicalMessage }> = [
    {
      name: 'user text only',
      msg: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
    {
      name: 'system text only',
      msg: { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
    },
    {
      name: 'assistant text + tool_use mixed',
      msg: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'tc-1', name: 'read_slides', input: { index: 0 } },
        ],
      },
    },
    {
      name: 'tool result',
      msg: {
        role: 'tool',
        content: [{ type: 'tool_result', toolUseId: 'tc-1', content: 'ok' }],
      },
    },
    {
      name: 'assistant with thinking + text',
      msg: {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'planning...' },
          { type: 'text', text: 'final answer' },
        ],
      },
    },
  ]
  for (const { name, msg } of cases) {
    it(name, () => {
      const row = canonicalToRow(msg)
      const recovered = rowToCanonical({
        role: msg.role,
        content: row.content,
        toolCallId: row.toolCallId,
        canonicalContent: row.canonicalContent,
      })
      expect(recovered).toEqual(msg)
    })
  }
})
