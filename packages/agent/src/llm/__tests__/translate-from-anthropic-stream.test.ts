/**
 * Phase 12 Task G:from-anthropic-stream translate 单测。
 *
 * 用 4 个 fixture 模拟真 Anthropic streaming response:
 * - text-only:纯文本 stream
 * - with-thinking:thinking block + text block
 * - with-tool-use:text + tool_use(input_json_delta 多 fragment 累积)
 * - with-cache-hit:含 cache_read_input_tokens(prompt caching 命中)
 *
 * 覆盖目标:
 * - 仅 text 的 stream
 * - thinking.delta 事件
 * - 单 tool call(start / delta / end)+ finish.reason=tool_use
 * - cache.hit 事件 emit + usage.cached 字段
 * - stop_reason 多种值(end_turn / stop_sequence / max_tokens / tool_use / refusal / null)的映射
 * - 多并发 tool_use(不同 index)
 * - 未知 / 不匹配的 event 类型不破坏状态机
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { fromAnthropicStream } from '../translate/from-anthropic-stream.js'
import type { CanonicalEvent } from '../types.js'

type StreamEvent = Anthropic.Messages.RawMessageStreamEvent

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): StreamEvent[] {
  const filePath = path.join(__dirname, 'fixtures', name)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

async function* yieldFixture(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const event of events) {
    yield event
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

describe('fromAnthropicStream — text-only stream', () => {
  it('text fragment 拼装 + finish stop + usage', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-text-only.json'))))

    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello' },
      { type: 'text.delta', text: ', ' },
      { type: 'text.delta', text: 'world!' },
      { type: 'finish', reason: 'stop', usage: { input: 15, output: 8 } },
    ])
  })

  it('text-only 不 emit cache.hit / thinking.delta / tool_call 事件', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-text-only.json'))))
    const types = events.map((e) => e.type)
    expect(types).not.toContain('cache.hit')
    expect(types).not.toContain('thinking.delta')
    expect(types).not.toContain('tool_call.start')
  })
})

describe('fromAnthropicStream — with thinking', () => {
  it('thinking_delta 拼装成 thinking.delta + 后续 text.delta', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-thinking.json'))))

    expect(events).toEqual([
      { type: 'thinking.delta', text: 'Let me consider ' },
      { type: 'thinking.delta', text: 'this carefully.' },
      { type: 'text.delta', text: 'The answer is 42.' },
      { type: 'finish', reason: 'stop', usage: { input: 20, output: 18 } },
    ])
  })

  it('thinking blocks 的 content_block_stop 不 emit 任何收尾事件(只 tool_use 才需)', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-thinking.json'))))
    // 验证没有 tool_call.end(thinking stop 不应触发任何 end 事件)
    expect(events.filter((e) => e.type === 'tool_call.end')).toEqual([])
  })
})

describe('fromAnthropicStream — with tool use', () => {
  it('text → tool_use.start → input_json_delta x3 → tool_use.end → finish tool_use', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-tool-use.json'))))

    expect(events).toEqual([
      { type: 'text.delta', text: 'Let me look that up.' },
      { type: 'tool_call.start', id: 'toolu_abc123', name: 'searchPages' },
      { type: 'tool_call.delta', id: 'toolu_abc123', argsChunk: '{"q":' },
      { type: 'tool_call.delta', id: 'toolu_abc123', argsChunk: '"hello' },
      { type: 'tool_call.delta', id: 'toolu_abc123', argsChunk: ' world"}' },
      { type: 'tool_call.end', id: 'toolu_abc123' },
      { type: 'finish', reason: 'tool_use', usage: { input: 30, output: 22 } },
    ])
  })

  it('完整拼装 input args = {"q":"hello world"}', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-tool-use.json'))))
    const deltas = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
        e.type === 'tool_call.delta',
    )
    const merged = deltas.map((d) => d.argsChunk).join('')
    expect(JSON.parse(merged)).toEqual({ q: 'hello world' })
  })
})

describe('fromAnthropicStream — with cache hit', () => {
  it('cache_read_input_tokens > 0 → emit cache.hit event(在 message_start 时)', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-cache-hit.json'))))

    // cache.hit 应该是第一个事件(在 text.delta 之前)
    expect(events[0]).toEqual({ type: 'cache.hit', cachedTokens: 1200, costTokens: 12 })
  })

  it('finish.usage.cached = cache_read_input_tokens', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture(loadFixture('anthropic-stream-with-cache-hit.json'))))
    const finish = events.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage).toEqual({ input: 12, output: 5, cached: 1200 })
  })
})

describe('fromAnthropicStream — stop_reason mapping', () => {
  async function streamWithStopReason(
    reason: Anthropic.Messages.StopReason | null,
  ): Promise<CanonicalEvent[]> {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: reason, stop_sequence: null, container: null, stop_details: null },
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    return collect(fromAnthropicStream(yieldFixture(events)))
  }

  it('stop_reason=end_turn → finish.reason=stop', async () => {
    const events = await streamWithStopReason('end_turn')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('stop_reason=stop_sequence → finish.reason=stop', async () => {
    const events = await streamWithStopReason('stop_sequence')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('stop_reason=max_tokens → finish.reason=length', async () => {
    const events = await streamWithStopReason('max_tokens')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'length' })
  })

  it('stop_reason=tool_use → finish.reason=tool_use', async () => {
    const events = await streamWithStopReason('tool_use')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'tool_use' })
  })

  it('stop_reason=pause_turn → finish.reason=stop', async () => {
    const events = await streamWithStopReason('pause_turn')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('stop_reason=refusal → finish.reason=content_filter', async () => {
    const events = await streamWithStopReason('refusal')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'content_filter' })
  })

  it('stop_reason=null(stream 异常截断)→ finish.reason=stop 兜底', async () => {
    const events = await streamWithStopReason(null)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('未知 stop_reason → finish.reason=stop 兜底', async () => {
    const events = await streamWithStopReason('made_up' as Anthropic.Messages.StopReason)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })
})

describe('fromAnthropicStream — edge cases', () => {
  it('空 stream → 仅 emit finish stop usage 0/0', async () => {
    const events = await collect(fromAnthropicStream(yieldFixture([])))
    expect(events).toEqual([{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }])
  })

  it('cache_read_input_tokens=0 → 不 emit cache.hit / usage.cached 不设', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 10,
            output_tokens: 1,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: 0,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, container: null, stop_details: null },
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: 0,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    expect(result.find((e) => e.type === 'cache.hit')).toBeUndefined()
    const finish = result.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage.cached).toBeUndefined()
  })

  it('content_block_delta 出现在未声明的 index → silent skip,不崩', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        },
      },
      // 跳过 content_block_start,直接发 delta(异常 stream)
      {
        type: 'content_block_delta',
        index: 99,
        delta: { type: 'text_delta', text: 'orphan' },
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    // 应该没有 text.delta(state 缺失,silent skip)
    expect(result.filter((e) => e.type === 'text.delta')).toEqual([])
    expect(result[result.length - 1]).toMatchObject({ type: 'finish' })
  })

  it('content_block_stop 出现在未声明的 index → silent,不崩', async () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_stop',
        index: 5,
      },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    expect(result).toEqual([{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }])
  })

  it('unknown content_block type → 不 emit start,后续 delta silent drop', async () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          // 模拟未来扩展类型 server_tool_use(canonical 没对应)
          type: 'server_tool_use',
          id: 'srv_1',
          name: 'web_search',
          input: {},
          caller: { type: 'direct' },
        } as unknown as Extract<
          Anthropic.Messages.RawContentBlockStartEvent['content_block'],
          { type: 'server_tool_use' }
        >,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    // 没有 tool_call.start(因为不是 tool_use type)
    expect(result.filter((e) => e.type === 'tool_call.start')).toEqual([])
    expect(result.filter((e) => e.type === 'tool_call.delta')).toEqual([])
    expect(result.filter((e) => e.type === 'tool_call.end')).toEqual([])
    expect(result[result.length - 1]).toMatchObject({ type: 'finish' })
  })

  it('多个并发 tool_use(不同 index)→ 各自 start / delta / end 正确', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tu_a',
          name: 'first',
          input: {},
          caller: { type: 'direct' },
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'tu_b',
          name: 'second',
          input: {},
          caller: { type: 'direct' },
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"y":2}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null, container: null, stop_details: null },
        usage: {
          input_tokens: 5,
          output_tokens: 12,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    expect(result).toEqual([
      { type: 'tool_call.start', id: 'tu_a', name: 'first' },
      { type: 'tool_call.delta', id: 'tu_a', argsChunk: '{"x":1}' },
      { type: 'tool_call.end', id: 'tu_a' },
      { type: 'tool_call.start', id: 'tu_b', name: 'second' },
      { type: 'tool_call.delta', id: 'tu_b', argsChunk: '{"y":2}' },
      { type: 'tool_call.end', id: 'tu_b' },
      { type: 'finish', reason: 'tool_use', usage: { input: 5, output: 12 } },
    ])
  })

  it('text_delta 在 thinking block 上(类型不匹配)→ silent drop', async () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      // 错配:text_delta 发给 thinking 状态的 block
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'mismatch' },
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    expect(result.filter((e) => e.type === 'text.delta')).toEqual([])
    expect(result.filter((e) => e.type === 'thinking.delta')).toEqual([])
  })

  it('citations_delta / signature_delta(扩展 delta 类型)→ silent drop', async () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
      // SDK 中存在但 canonical 没对应类型的 delta(用 cast 跳过 SDK 严格类型)
      {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'citations_delta',
          citation: {
            type: 'char_location',
            cited_text: 'x',
            document_index: 0,
            document_title: null,
            file_id: null,
            start_char_index: 0,
            end_char_index: 1,
          },
        } as unknown as Anthropic.Messages.RawContentBlockDeltaEvent['delta'] extends infer D ? D : never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' } as unknown as Anthropic.Messages.RawContentBlockDelta,
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    // 无 text.delta / thinking.delta / tool_call.* 事件
    expect(result).toEqual([{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }])
  })

  it('message_delta 含 stop_reason 但 usage 缺 output_tokens → 不报错', async () => {
    const events: StreamEvent[] = [
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null, container: null, stop_details: null },
        usage: {
          input_tokens: 3,
          output_tokens: null as unknown as number, // 异常 provider 漏发 output_tokens
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
      },
      { type: 'message_stop' },
    ]
    const result = await collect(fromAnthropicStream(yieldFixture(events)))
    const finish = result[result.length - 1] as Extract<CanonicalEvent, { type: 'finish' }>
    expect(finish.reason).toBe('stop')
    // 未覆盖到 output → 默认 0
    expect(finish.usage.output).toBe(0)
  })
})
