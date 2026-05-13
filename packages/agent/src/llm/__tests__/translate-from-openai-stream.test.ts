/**
 * Phase 12 Task C：from-openai-stream translate 单测。
 *
 * 用 4 个 fixture(stored JSON 数组)模拟 OpenAI streaming response;async generator
 * yield 这些 chunks 喂给 fromOpenAIStream。
 *
 * 覆盖目标:
 * - 仅 text 的 stream(text-only fixture)
 * - 单 tool call 含 args fragment(single-tool-call fixture)
 * - 多 tool call 并发 index 交错(multi-tool-call fixture)
 * - text 后接 tool call(text-then-tool fixture)
 * - usage chunk(choices 空 + usage 字段)
 * - finish_reason 多种值(stop / tool_calls / length / content_filter)的映射
 * - 无 usage chunk 时 finish 仍 emit
 * - 兜底 chunks(role-only / 空 delta)不破坏状态机
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { fromOpenAIStream } from '../translate/from-openai-stream.js'
import type { CanonicalEvent } from '../types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): OpenAI.Chat.ChatCompletionChunk[] {
  const filePath = path.join(__dirname, 'fixtures', name)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

async function* yieldFixture(
  chunks: OpenAI.Chat.ChatCompletionChunk[],
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  for (const chunk of chunks) {
    yield chunk
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

describe('fromOpenAIStream — text-only stream', () => {
  it('text fragment 拼装 + finish stop + usage 含 prompt/completion_tokens', async () => {
    const chunks = loadFixture('openai-stream-text-only.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))

    // 期望 events 序列:三个 text.delta + finish
    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello' },
      { type: 'text.delta', text: ', ' },
      { type: 'text.delta', text: 'world!' },
      { type: 'finish', reason: 'stop', usage: { input: 12, output: 8 } },
    ])
  })

  it('role-only chunk(无 content)+ empty content delta 不破坏后续 text.delta', async () => {
    // 第一个 chunk delta.role = 'assistant' content = ''(空)→ 不该 emit text.delta
    const chunks = loadFixture('openai-stream-text-only.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    // events[0] 应是 'Hello',不是 '' 空 text
    expect(events[0]).toEqual({ type: 'text.delta', text: 'Hello' })
  })
})

describe('fromOpenAIStream — single tool call', () => {
  it('args fragment 累积:start → 多个 delta → end → finish tool_use', async () => {
    const chunks = loadFixture('openai-stream-single-tool-call.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))

    expect(events).toEqual([
      { type: 'tool_call.start', id: 'call_abc123', name: 'searchPages' },
      // 第一个 chunk 带 arguments="" 空字符串,会调用 emit 但内容空。
      // 看下 fixture:第一个 chunk function.arguments="",会让 if(tc.function?.arguments) 假;
      // 实际上 "" 是 falsy,不会 emit delta(空 args fragment 无意义)。
      { type: 'tool_call.delta', id: 'call_abc123', argsChunk: '{"q":' },
      { type: 'tool_call.delta', id: 'call_abc123', argsChunk: '"hello' },
      { type: 'tool_call.delta', id: 'call_abc123', argsChunk: ' world"}' },
      { type: 'tool_call.end', id: 'call_abc123' },
      { type: 'finish', reason: 'tool_use', usage: { input: 30, output: 15 } },
    ])
  })

  it('完整拼装 args = {"q":"hello world"}', async () => {
    const chunks = loadFixture('openai-stream-single-tool-call.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    const deltas = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
        e.type === 'tool_call.delta',
    )
    const merged = deltas.map((d) => d.argsChunk).join('')
    expect(JSON.parse(merged)).toEqual({ q: 'hello world' })
  })
})

describe('fromOpenAIStream — multi tool call(并发 index)', () => {
  it('多 index 交错时按 index 累积各自 args,end events 顺序按 Map 插入序', async () => {
    const chunks = loadFixture('openai-stream-multi-tool-call.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))

    // 两个 tool_call.start
    const starts = events.filter((e) => e.type === 'tool_call.start')
    expect(starts).toEqual([
      { type: 'tool_call.start', id: 'call_first', name: 'lookup_a' },
      { type: 'tool_call.start', id: 'call_second', name: 'lookup_b' },
    ])

    // 两个 tool_call.end
    const ends = events.filter((e) => e.type === 'tool_call.end')
    expect(ends).toEqual([
      { type: 'tool_call.end', id: 'call_first' },
      { type: 'tool_call.end', id: 'call_second' },
    ])

    // 各自 args 累积正确
    const firstDeltas = events
      .filter(
        (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
          e.type === 'tool_call.delta' && e.id === 'call_first',
      )
      .map((d) => d.argsChunk)
      .join('')
    const secondDeltas = events
      .filter(
        (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
          e.type === 'tool_call.delta' && e.id === 'call_second',
      )
      .map((d) => d.argsChunk)
      .join('')

    expect(JSON.parse(firstDeltas)).toEqual({ id: 1 })
    expect(JSON.parse(secondDeltas)).toEqual({ id: 2 })

    // finish
    expect(events[events.length - 1]).toEqual({
      type: 'finish',
      reason: 'tool_use',
      usage: { input: 50, output: 22 },
    })
  })
})

describe('fromOpenAIStream — text then tool', () => {
  it('text.delta 在前,tool_call 在后,finish.reason=tool_use,usage 含 cached', async () => {
    const chunks = loadFixture('openai-stream-text-then-tool.json')
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))

    expect(events).toEqual([
      { type: 'text.delta', text: 'Let me look that up.' },
      { type: 'tool_call.start', id: 'call_xyz', name: 'fetchData' },
      { type: 'tool_call.delta', id: 'call_xyz', argsChunk: '{}' },
      { type: 'tool_call.end', id: 'call_xyz' },
      {
        type: 'finish',
        reason: 'tool_use',
        usage: { input: 18, output: 12, cached: 10 },
      },
    ])
  })
})

describe('fromOpenAIStream — finish_reason mapping', () => {
  async function streamWithFinish(
    reason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'],
  ): Promise<CanonicalEvent[]> {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: {}, finish_reason: reason }],
      },
    ]
    return collect(fromOpenAIStream(yieldFixture(chunks)))
  }

  it('finish_reason=stop → finish.reason=stop', async () => {
    const events = await streamWithFinish('stop')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('finish_reason=length → finish.reason=length', async () => {
    const events = await streamWithFinish('length')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'length' })
  })

  it('finish_reason=tool_calls → finish.reason=tool_use(canonical 统一术语)', async () => {
    const events = await streamWithFinish('tool_calls')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'tool_use' })
  })

  it('finish_reason=function_call(legacy)→ finish.reason=tool_use', async () => {
    const events = await streamWithFinish('function_call')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'tool_use' })
  })

  it('finish_reason=content_filter → finish.reason=content_filter', async () => {
    const events = await streamWithFinish('content_filter')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'content_filter' })
  })

  it('finish_reason=null(stream 异常截断)→ finish.reason=stop 兜底', async () => {
    const events = await streamWithFinish(null)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })
})

describe('fromOpenAIStream — edge cases', () => {
  it('空 stream(0 chunk)→ 仅 emit finish stop usage 0/0', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = []
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events).toEqual([{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }])
  })

  it('没有 usage chunk → finish.usage = 0/0', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events).toContainEqual({
      type: 'finish',
      reason: 'stop',
      usage: { input: 0, output: 0 },
    })
  })

  it('choices 空 + usage 字段 → 累积 usage,不 emit 任何文本/工具事件', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events).toEqual([
      { type: 'text.delta', text: 'hello' },
      { type: 'finish', reason: 'stop', usage: { input: 7, output: 3 } },
    ])
  })

  it('cached_tokens=0 时 usage 不带 cached 字段', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'stop' }],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    const finish = events.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage).toEqual({ input: 5, output: 2 })
    expect(finish.usage.cached).toBeUndefined()
  })

  it('choice 为 undefined(异常 provider 返空 choices 数组)→ 不崩,正常 emit finish', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        // @ts-expect-error 故意构造 choices:undefined 异常 chunk
        choices: undefined,
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events).toEqual([{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }])
  })

  it('tool_call id / name 在不同 chunk 拆分(中转 provider 边界场景)— 信息齐全前不 emit start', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: 'call_split', type: 'function' }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { name: 'delayedTool', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events).toEqual([
      { type: 'tool_call.start', id: 'call_split', name: 'delayedTool' },
      { type: 'tool_call.delta', id: 'call_split', argsChunk: '{}' },
      { type: 'tool_call.end', id: 'call_split' },
      { type: 'finish', reason: 'tool_use', usage: { input: 0, output: 0 } },
    ])
  })

  it('tool_call args 到达时 state 未 started(name 缺失)→ args drop,无 delta emit', async () => {
    // 模拟反常 provider:第一个 chunk 只有 id 没 name,且立刻发 args
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_orphan',
                  function: { arguments: '{"oops":' }, // 有 args 没 name
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      // 后续 chunk 补 name,start 才 emit;但之前的 args 已 drop
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { name: 'late', arguments: 'true}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    // 第一个 chunk:name 缺,started=false,args 被 drop
    // 第二个 chunk:补 name,start emit + 之后 args="true}" emit
    expect(events).toEqual([
      { type: 'tool_call.start', id: 'call_orphan', name: 'late' },
      { type: 'tool_call.delta', id: 'call_orphan', argsChunk: 'true}' },
      { type: 'tool_call.end', id: 'call_orphan' },
      { type: 'finish', reason: 'tool_use', usage: { input: 0, output: 0 } },
    ])
  })

  it('tool_call 首次出现时 id 为空字符串(reuse 已有 state 后)— 不覆盖原有 id', async () => {
    // 第一个 chunk:id='call_initial',name='', no args
    // 第二个 chunk:id='',name='set',args=...(模拟 provider 漏发 id 的反常 chunk)
    // 期望:state.id 保留 'call_initial',state.name 被 set,start emit
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: 'call_initial', type: 'function' }],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              // tc.id 缺失 / undefined,但 function.name 补上
              tool_calls: [{ index: 0, function: { name: 'enrichedName' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    expect(events[0]).toEqual({
      type: 'tool_call.start',
      id: 'call_initial',
      name: 'enrichedName',
    })
  })

  it('CompletionUsage 缺失 prompt_tokens / completion_tokens 字段(异常 provider)— 兜底为 0', async () => {
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'stop' }],
      },
      {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [],
        // 故意构造缺字段的 usage(实际生产可能遇到中转返不完整数据)
        usage: { total_tokens: 0 } as unknown as OpenAI.CompletionUsage,
      },
    ]
    const events = await collect(fromOpenAIStream(yieldFixture(chunks)))
    const finish = events.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage).toEqual({ input: 0, output: 0 })
  })
})
