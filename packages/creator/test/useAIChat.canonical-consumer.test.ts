/**
 * Phase 12 Task I：canonical event consumer 状态机单测。
 *
 * 用 fixture event 序列直接构造 SSE byte stream → `consumeCanonicalEventStream`
 * 应正确累积 text / tool_call / thinking / cache / finish，并按出现顺序输出
 * `finalizedToolCalls`。
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeSSEFrame, type CanonicalEvent } from '@big-ppt/shared'
import { consumeCanonicalEventStream } from '../src/composables/useAIChat'

function makeStream(events: CanonicalEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(encodeSSEFrame(evt)))
      }
      controller.close()
    },
  })
}

describe('consumeCanonicalEventStream', () => {
  it('累积 text.delta 到 content 并实时回调', async () => {
    const events: CanonicalEvent[] = [
      { type: 'text.delta', text: 'Hello' },
      { type: 'text.delta', text: ', ' },
      { type: 'text.delta', text: 'world' },
      { type: 'finish', reason: 'stop', usage: { input: 10, output: 3 } },
    ]
    const onText = vi.fn()
    const onThink = vi.fn()
    const result = await consumeCanonicalEventStream(makeStream(events), onText, onThink)
    expect(result.content).toBe('Hello, world')
    expect(onText).toHaveBeenCalledTimes(3)
    expect(onText.mock.calls.map((c) => c[0])).toEqual(['Hello', ', ', 'world'])
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ input: 10, output: 3 })
    expect(result.finalizedToolCalls).toEqual([])
  })

  it('按出现顺序拼装 tool_call 并合并 args fragment', async () => {
    const events: CanonicalEvent[] = [
      { type: 'tool_call.start', id: 'call_1', name: 'read_slides' },
      { type: 'tool_call.delta', id: 'call_1', argsChunk: '{"a":' },
      { type: 'tool_call.delta', id: 'call_1', argsChunk: '1}' },
      { type: 'tool_call.end', id: 'call_1' },
      { type: 'tool_call.start', id: 'call_2', name: 'update_slide' },
      { type: 'tool_call.delta', id: 'call_2', argsChunk: '{"index":2,' },
      { type: 'tool_call.delta', id: 'call_2', argsChunk: '"body":"hi"}' },
      { type: 'tool_call.end', id: 'call_2' },
      { type: 'finish', reason: 'tool_use', usage: { input: 50, output: 20 } },
    ]
    const result = await consumeCanonicalEventStream(makeStream(events), () => {}, () => {})
    expect(result.finalizedToolCalls).toEqual([
      { id: 'call_1', name: 'read_slides', argsRaw: '{"a":1}' },
      { id: 'call_2', name: 'update_slide', argsRaw: '{"index":2,"body":"hi"}' },
    ])
    expect(result.finishReason).toBe('tool_use')
  })

  it('交错的 tool_call 状态机（OpenAI 流可能多 tool 同时推 args）', async () => {
    const events: CanonicalEvent[] = [
      { type: 'tool_call.start', id: 'a', name: 'foo' },
      { type: 'tool_call.start', id: 'b', name: 'bar' },
      { type: 'tool_call.delta', id: 'a', argsChunk: '{"x":' },
      { type: 'tool_call.delta', id: 'b', argsChunk: '{"y":' },
      { type: 'tool_call.delta', id: 'a', argsChunk: '1}' },
      { type: 'tool_call.delta', id: 'b', argsChunk: '2}' },
      { type: 'tool_call.end', id: 'a' },
      { type: 'tool_call.end', id: 'b' },
      { type: 'finish', reason: 'tool_use', usage: { input: 30, output: 10 } },
    ]
    const result = await consumeCanonicalEventStream(makeStream(events), () => {}, () => {})
    expect(result.finalizedToolCalls).toEqual([
      { id: 'a', name: 'foo', argsRaw: '{"x":1}' },
      { id: 'b', name: 'bar', argsRaw: '{"y":2}' },
    ])
  })

  it('累积 thinking.delta 并通过 onThinkingChunk 推 UI', async () => {
    const events: CanonicalEvent[] = [
      { type: 'thinking.delta', text: 'Let me think...\n' },
      { type: 'thinking.delta', text: 'I should call read_slides first.\n' },
      { type: 'text.delta', text: 'Sure.' },
      { type: 'finish', reason: 'stop', usage: { input: 5, output: 1 } },
    ]
    const onText = vi.fn()
    const onThink = vi.fn()
    const result = await consumeCanonicalEventStream(makeStream(events), onText, onThink)
    expect(result.thinking).toBe('Let me think...\nI should call read_slides first.\n')
    expect(onThink).toHaveBeenCalledTimes(2)
    expect(result.content).toBe('Sure.')
  })

  it('捕获 cache.hit 数据', async () => {
    const events: CanonicalEvent[] = [
      { type: 'cache.hit', cachedTokens: 1024, costTokens: 256 },
      { type: 'text.delta', text: 'cached!' },
      { type: 'finish', reason: 'stop', usage: { input: 1280, output: 5, cached: 1024 } },
    ]
    const result = await consumeCanonicalEventStream(makeStream(events), () => {}, () => {})
    expect(result.cacheStats).toEqual({ cached: 1024, cost: 256 })
    expect(result.usage).toEqual({ input: 1280, output: 5, cached: 1024 })
  })

  it('遇到 error event 时抛出', async () => {
    const events: CanonicalEvent[] = [
      { type: 'text.delta', text: 'partial' },
      { type: 'error', code: 'rate_limit', message: 'Too many requests' },
    ]
    await expect(consumeCanonicalEventStream(makeStream(events), () => {}, () => {})).rejects.toThrow(
      /LLM error \[rate_limit\]: Too many requests/,
    )
  })

  it('空流时 finishReason / usage 为 null（保守兜底）', async () => {
    const result = await consumeCanonicalEventStream(makeStream([]), () => {}, () => {})
    expect(result.content).toBe('')
    expect(result.thinking).toBe('')
    expect(result.finalizedToolCalls).toEqual([])
    expect(result.finishReason).toBeNull()
    expect(result.usage).toBeNull()
    expect(result.cacheStats).toBeNull()
  })

  it('text + tool_call 混合：assistant 同时有 text 和 tool_use（Anthropic 风格）', async () => {
    const events: CanonicalEvent[] = [
      { type: 'text.delta', text: 'I will check slides first.\n' },
      { type: 'tool_call.start', id: 'c1', name: 'read_slides' },
      { type: 'tool_call.delta', id: 'c1', argsChunk: '{}' },
      { type: 'tool_call.end', id: 'c1' },
      { type: 'finish', reason: 'tool_use', usage: { input: 10, output: 3 } },
    ]
    const result = await consumeCanonicalEventStream(makeStream(events), () => {}, () => {})
    expect(result.content).toBe('I will check slides first.\n')
    expect(result.finalizedToolCalls).toEqual([{ id: 'c1', name: 'read_slides', argsRaw: '{}' }])
  })
})
