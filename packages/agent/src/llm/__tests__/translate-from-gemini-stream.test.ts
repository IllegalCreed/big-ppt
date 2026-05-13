/**
 * Phase 12 Task H:from-gemini-stream translate 单测。
 *
 * 用 4 个 fixture 模拟真 Gemini streaming response:
 * - text-only:纯文本 stream
 * - with-tool-use:text + functionCall(Gemini 一次性 emit)
 * - with-safety-stop:partial text 后 SAFETY 触发收尾
 * - with-cache-hit:含 cachedContentTokenCount(Gemini context caching 命中)
 *
 * 覆盖目标:
 * - 仅 text 的 stream
 * - functionCall part(一次性 emit start + delta + end)
 * - safety stop_reason → content_filter
 * - cache.hit 事件 emit + usage.cached 字段
 * - finishReason 各种值(STOP / MAX_TOKENS / SAFETY / MALFORMED_FUNCTION_CALL /
 *   RECITATION / OTHER / 未知 / undefined)的映射
 * - thinking part(part.thought=true)→ thinking.delta
 * - 未声明的 part 类型 silent drop
 * - id 生成可注入(_idSource)做确定性测试
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FinishReason as GeminiFinishReason } from '@google/genai'
import type { GenerateContentResponse } from '@google/genai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fromGeminiStream,
  __setIdSourceForTesting,
} from '../translate/from-gemini-stream.js'
import type { CanonicalEvent } from '../types.js'

type StreamChunk = Partial<GenerateContentResponse> & Record<string, unknown>

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): StreamChunk[] {
  const filePath = path.join(__dirname, 'fixtures', name)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

async function* yieldFixture(events: StreamChunk[]): AsyncIterable<GenerateContentResponse> {
  for (const event of events) {
    yield event as GenerateContentResponse
  }
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

// 测试期注入确定性 id 来源:每次返同串
beforeEach(() => {
  __setIdSourceForTesting(() => 'fixedid1')
})

afterEach(() => {
  __setIdSourceForTesting(null)
})

describe('fromGeminiStream — text-only stream', () => {
  it('text fragment 拼装 + finish stop + usage', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-text-only.json'))),
    )

    expect(events).toEqual([
      { type: 'text.delta', text: 'Hello' },
      { type: 'text.delta', text: ', ' },
      { type: 'text.delta', text: 'world!' },
      { type: 'finish', reason: 'stop', usage: { input: 12, output: 8 } },
    ])
  })

  it('text-only 不 emit cache.hit / thinking.delta / tool_call 事件', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-text-only.json'))),
    )
    const types = events.map((e) => e.type)
    expect(types).not.toContain('cache.hit')
    expect(types).not.toContain('thinking.delta')
    expect(types).not.toContain('tool_call.start')
  })
})

describe('fromGeminiStream — with tool use', () => {
  it('text → functionCall 一次性 emit start/delta/end → finish stop', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-tool-use.json'))),
    )

    expect(events).toEqual([
      { type: 'text.delta', text: 'Let me search.' },
      { type: 'tool_call.start', id: 'gemini-fc-fixedid1-searchPages', name: 'searchPages' },
      {
        type: 'tool_call.delta',
        id: 'gemini-fc-fixedid1-searchPages',
        argsChunk: '{"q":"hello world"}',
      },
      { type: 'tool_call.end', id: 'gemini-fc-fixedid1-searchPages' },
      { type: 'finish', reason: 'stop', usage: { input: 24, output: 18 } },
    ])
  })

  it('argsChunk 完整拼装 = JSON.stringify(args)', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-tool-use.json'))),
    )
    const delta = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
        e.type === 'tool_call.delta',
    )
    expect(delta).toBeDefined()
    expect(JSON.parse(delta!.argsChunk)).toEqual({ q: 'hello world' })
  })
})

describe('fromGeminiStream — with safety stop', () => {
  it('SAFETY finishReason → finish.reason=content_filter', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-safety-stop.json'))),
    )

    const finish = events[events.length - 1]
    expect(finish).toMatchObject({ type: 'finish', reason: 'content_filter' })
  })

  it('partial text 仍 emit', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-safety-stop.json'))),
    )
    expect(events.filter((e) => e.type === 'text.delta')).toEqual([
      { type: 'text.delta', text: "I'll try to" },
    ])
  })
})

describe('fromGeminiStream — with cache hit', () => {
  it('cachedContentTokenCount > 0 → emit cache.hit event(只 emit 一次)', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-cache-hit.json'))),
    )

    const cacheHits = events.filter((e) => e.type === 'cache.hit')
    expect(cacheHits).toHaveLength(1)
    expect(cacheHits[0]).toEqual({
      type: 'cache.hit',
      cachedTokens: 800,
      costTokens: 100,
    })
  })

  it('finish.usage.cached = cachedContentTokenCount', async () => {
    const events = await collect(
      fromGeminiStream(yieldFixture(loadFixture('gemini-stream-with-cache-hit.json'))),
    )
    const finish = events.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage).toEqual({ input: 100, output: 5, cached: 800 })
  })
})

describe('fromGeminiStream — finishReason mapping', () => {
  async function streamWithFinishReason(
    reason: GeminiFinishReason | string | undefined,
  ): Promise<CanonicalEvent[]> {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }], role: 'model' },
            ...(reason ? { finishReason: reason as GeminiFinishReason } : {}),
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
        },
      } as StreamChunk,
    ]
    return collect(fromGeminiStream(yieldFixture(events)))
  }

  it('STOP → finish.reason=stop', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.STOP)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('MAX_TOKENS → finish.reason=length', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.MAX_TOKENS)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'length' })
  })

  it('SAFETY → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.SAFETY)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('PROHIBITED_CONTENT → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.PROHIBITED_CONTENT)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('RECITATION → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.RECITATION)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('SPII → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.SPII)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('BLOCKLIST → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.BLOCKLIST)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('LANGUAGE → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.LANGUAGE)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('IMAGE_SAFETY → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.IMAGE_SAFETY)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('IMAGE_PROHIBITED_CONTENT → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.IMAGE_PROHIBITED_CONTENT)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('IMAGE_RECITATION → finish.reason=content_filter', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.IMAGE_RECITATION)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'content_filter',
    })
  })

  it('MALFORMED_FUNCTION_CALL → finish.reason=tool_use', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.MALFORMED_FUNCTION_CALL)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'tool_use',
    })
  })

  it('UNEXPECTED_TOOL_CALL → finish.reason=tool_use', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.UNEXPECTED_TOOL_CALL)
    expect(events[events.length - 1]).toMatchObject({
      type: 'finish',
      reason: 'tool_use',
    })
  })

  it('OTHER → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.OTHER)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('NO_IMAGE → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.NO_IMAGE)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('IMAGE_OTHER → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.IMAGE_OTHER)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('FINISH_REASON_UNSPECIFIED → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason(GeminiFinishReason.FINISH_REASON_UNSPECIFIED)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('未声明 finishReason → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason(undefined)
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('未知 finishReason 字符串 → finish.reason=stop 兜底', async () => {
    const events = await streamWithFinishReason('FUTURE_REASON_VALUE')
    expect(events[events.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })
})

describe('fromGeminiStream — edge cases', () => {
  it('空 stream → 仅 emit finish stop usage 0/0', async () => {
    const events = await collect(fromGeminiStream(yieldFixture([])))
    expect(events).toEqual([
      { type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } },
    ])
  })

  it('cachedContentTokenCount=0 → 不 emit cache.hit / usage.cached 不设', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }], role: 'model' },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          cachedContentTokenCount: 0,
          totalTokenCount: 15,
        },
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result.find((e) => e.type === 'cache.hit')).toBeUndefined()
    const finish = result.find((e) => e.type === 'finish') as Extract<
      CanonicalEvent,
      { type: 'finish' }
    >
    expect(finish.usage.cached).toBeUndefined()
  })

  it('cachedContentTokenCount 后续 chunk 重复 → cache.hit 只 emit 一次', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: { parts: [{ text: 'a' }], role: 'model' },
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 1,
          cachedContentTokenCount: 500,
          totalTokenCount: 601,
        },
      } as StreamChunk,
      {
        candidates: [
          {
            content: { parts: [{ text: 'b' }], role: 'model' },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 2,
          cachedContentTokenCount: 500,
          totalTokenCount: 602,
        },
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result.filter((e) => e.type === 'cache.hit')).toHaveLength(1)
  })

  it('thinking part(part.thought=true)→ thinking.delta event', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'reasoning...' },
                { text: 'answer' },
              ],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result).toEqual([
      { type: 'thinking.delta', text: 'reasoning...' },
      { type: 'text.delta', text: 'answer' },
      { type: 'finish', reason: 'stop', usage: { input: 10, output: 5 } },
    ])
  })

  it('inlineData / 未知 part 类型 → silent drop', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { mimeType: 'image/png', data: 'AAA' } },
                { text: 'hello' },
                // executableCode / codeExecutionResult 等 — canonical 没对应
                { executableCode: { code: 'print(1)' } } as never,
              ],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    // 仅 text.delta 应该 emit;其它 silent drop
    expect(result).toEqual([
      { type: 'text.delta', text: 'hello' },
      { type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } },
    ])
  })

  it('chunk 没 candidates → silent skip', async () => {
    const events: StreamChunk[] = [
      {
        // 没 candidates(异常 chunk)
      },
      {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }], role: 'model' },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 1,
          totalTokenCount: 6,
        },
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result).toEqual([
      { type: 'text.delta', text: 'ok' },
      { type: 'finish', reason: 'stop', usage: { input: 5, output: 1 } },
    ])
  })

  it('candidates[0].content 缺 parts → silent skip(不崩)', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: { role: 'model' },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result).toEqual([
      { type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } },
    ])
  })

  it('functionCall.args 为 undefined → 序列化为 {}', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'doFn' } }],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    const delta = result.find(
      (e): e is Extract<CanonicalEvent, { type: 'tool_call.delta' }> =>
        e.type === 'tool_call.delta',
    )
    expect(delta).toBeDefined()
    expect(JSON.parse(delta!.argsChunk)).toEqual({})
  })

  it('functionCall.name 缺失 → silent drop', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { args: { x: 1 } } }],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    // 没 tool_call.* event(name 缺失 silent drop)
    expect(result.filter((e) => e.type.startsWith('tool_call'))).toEqual([])
  })

  it('多个 functionCall 在同 chunk → 各自完整 emit 一组 start/delta/end', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'fnA', args: { x: 1 } } },
                { functionCall: { name: 'fnB', args: { y: 2 } } },
              ],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    const toolCallEvents = result.filter((e) => e.type.startsWith('tool_call'))
    expect(toolCallEvents).toHaveLength(6) // 2 个 fn × 3 个 event(start/delta/end)
    expect(toolCallEvents[0]).toMatchObject({ type: 'tool_call.start', name: 'fnA' })
    expect(toolCallEvents[3]).toMatchObject({ type: 'tool_call.start', name: 'fnB' })
  })

  it('text 为空串 → silent drop', async () => {
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [{ text: '' }, { text: 'real' }],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    expect(result.filter((e) => e.type === 'text.delta')).toEqual([
      { type: 'text.delta', text: 'real' },
    ])
  })

  it('__setIdSourceForTesting(null) → 恢复默认 crypto 随机 id', async () => {
    __setIdSourceForTesting(null)
    const events: StreamChunk[] = [
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'fn', args: {} } }],
              role: 'model',
            },
            finishReason: GeminiFinishReason.STOP,
          },
        ],
      } as StreamChunk,
    ]
    const result = await collect(fromGeminiStream(yieldFixture(events)))
    const start = result.find(
      (e): e is Extract<CanonicalEvent, { type: 'tool_call.start' }> =>
        e.type === 'tool_call.start',
    )
    expect(start).toBeDefined()
    // 默认 id 应该 match `gemini-fc-<8hex>-fn`
    expect(start!.id).toMatch(/^gemini-fc-[0-9a-f]{8}-fn$/)
  })
})
