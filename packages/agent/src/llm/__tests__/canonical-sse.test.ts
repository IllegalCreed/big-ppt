/**
 * Phase 12 Task D：canonical event SSE wire format encoder + decoder 单测。
 *
 * 覆盖目标:
 * - encode → decode 严格 round-trip 所有 8 类 canonical event(strict equal)
 * - 多 event 拼一个 stream → decode 得到原序列(顺序保真)
 * - AsyncIterable 中途 throw → decoder 最后一个 event 是 `error` + 流正常关闭
 * - 半 frame 边界:chunk 切在 `data:` JSON 中间 / 切在 `\n\n` 分隔符中间,
 *   decoder 仍能正确 parse
 * - 容错:缺 event/data 行 / JSON corrupt 的 frame 静默跳过,不破坏后续流
 *
 * 测试通过 agent 端 thin re-export(`../canonical-sse.js`)入口,验证 shared →
 * agent re-export 链路完整(同 Task B 的测试 import pattern)。
 */

import { describe, expect, it } from 'vitest'
import {
  decodeSSEStream,
  encodeSSEFrame,
  eventsToSSEStream,
  parseSSEFrame,
} from '../canonical-sse.js'
import type { CanonicalEvent } from '../types.js'

// --- helpers ---------------------------------------------------------------

/** 把 CanonicalEvent[] 包成 AsyncIterable,喂给 eventsToSSEStream。 */
async function* asyncFrom(events: CanonicalEvent[]): AsyncIterable<CanonicalEvent> {
  for (const evt of events) {
    yield evt
  }
}

/** 中途 throw 的 AsyncIterable —— 测异常路径。 */
async function* asyncThrows(
  events: CanonicalEvent[],
  errorMsg: string,
): AsyncIterable<CanonicalEvent> {
  for (const evt of events) {
    yield evt
  }
  throw new Error(errorMsg)
}

/** decode 一个 ReadableStream<Uint8Array> 出所有 CanonicalEvent。 */
async function collectDecoded(
  stream: ReadableStream<Uint8Array>,
): Promise<CanonicalEvent[]> {
  const out: CanonicalEvent[] = []
  for await (const evt of decodeSSEStream(stream)) {
    out.push(evt)
  }
  return out
}

/** 手工构造 ReadableStream:把多个 string chunk 顺序 enqueue 然后 close。 */
function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

/** 把一段完整的 SSE wire(多个 frame 拼一起的字符串)在指定 byte 位置切两段。 */
function splitAt(wire: string, pos: number): [string, string] {
  return [wire.slice(0, pos), wire.slice(pos)]
}

// --- encode/decode round-trip ---------------------------------------------

describe('encodeSSEFrame + parseSSEFrame round-trip (8 类 event)', () => {
  // 每个 it 构造单个 event → encode → 取 frame 字符串(去掉尾部 \n\n)→ parseSSEFrame
  // → 严格相等。覆盖率上 encodeSSEFrame + parseSSEFrame 两条主路径。

  function roundTrip(evt: CanonicalEvent): CanonicalEvent | null {
    const wire = encodeSSEFrame(evt)
    expect(wire.endsWith('\n\n')).toBe(true)
    expect(wire.startsWith(`event: ${evt.type}\n`)).toBe(true)
    const frame = wire.slice(0, -2) // 去尾部 \n\n
    return parseSSEFrame(frame)
  }

  it('text.delta', () => {
    const evt: CanonicalEvent = { type: 'text.delta', text: 'Hello, 世界!' }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('tool_call.start', () => {
    const evt: CanonicalEvent = {
      type: 'tool_call.start',
      id: 'call_abc123',
      name: 'mcp__notion__searchPages',
    }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('tool_call.delta', () => {
    const evt: CanonicalEvent = {
      type: 'tool_call.delta',
      id: 'call_abc123',
      argsChunk: '{"query":"',
    }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('tool_call.end', () => {
    const evt: CanonicalEvent = { type: 'tool_call.end', id: 'call_abc123' }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('thinking.delta', () => {
    const evt: CanonicalEvent = {
      type: 'thinking.delta',
      text: 'pondering the user request...',
    }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('cache.hit', () => {
    const evt: CanonicalEvent = { type: 'cache.hit', cachedTokens: 1024, costTokens: 50 }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('finish', () => {
    const evt: CanonicalEvent = {
      type: 'finish',
      reason: 'tool_use',
      usage: { input: 100, output: 50, cached: 80 },
    }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('error', () => {
    const evt: CanonicalEvent = {
      type: 'error',
      code: 'rate_limit',
      message: '429 too many requests',
    }
    expect(roundTrip(evt)).toEqual(evt)
  })
})

// --- multi-event stream ----------------------------------------------------

describe('eventsToSSEStream + decodeSSEStream (多 event 序列保真)', () => {
  it('8 类 event 串成一个 stream → decode 出原序列', async () => {
    const input: CanonicalEvent[] = [
      { type: 'text.delta', text: 'Hello' },
      { type: 'tool_call.start', id: 't1', name: 'searchPages' },
      { type: 'tool_call.delta', id: 't1', argsChunk: '{"q":"' },
      { type: 'tool_call.delta', id: 't1', argsChunk: 'hello"}' },
      { type: 'tool_call.end', id: 't1' },
      { type: 'thinking.delta', text: 'thinking...' },
      { type: 'cache.hit', cachedTokens: 80, costTokens: 20 },
      { type: 'finish', reason: 'tool_use', usage: { input: 10, output: 5 } },
    ]

    const stream = eventsToSSEStream(asyncFrom(input))
    const output = await collectDecoded(stream)

    expect(output).toEqual(input)
  })

  it('单个 text.delta event 也能正确 round-trip', async () => {
    const input: CanonicalEvent[] = [{ type: 'text.delta', text: 'only one' }]
    const output = await collectDecoded(eventsToSSEStream(asyncFrom(input)))
    expect(output).toEqual(input)
  })

  it('空 stream → decode 出空数组(controller.close 后无 frame)', async () => {
    const stream = eventsToSSEStream(asyncFrom([]))
    const output = await collectDecoded(stream)
    expect(output).toEqual([])
  })
})

// --- mid-stream error ------------------------------------------------------

describe('eventsToSSEStream 异常路径', () => {
  it('AsyncIterable 中途 throw → 最后一个 event 为 type=error code=unknown,流正常关闭', async () => {
    const happy: CanonicalEvent[] = [
      { type: 'text.delta', text: 'partial' },
      { type: 'text.delta', text: ' result' },
    ]
    const stream = eventsToSSEStream(asyncThrows(happy, 'mid-stream boom'))
    const output = await collectDecoded(stream)

    expect(output).toHaveLength(3)
    expect(output[0]).toEqual({ type: 'text.delta', text: 'partial' })
    expect(output[1]).toEqual({ type: 'text.delta', text: ' result' })
    expect(output[2]).toEqual({ type: 'error', code: 'unknown', message: 'mid-stream boom' })
  })

  it('非 Error 抛(plain string) → message 字段走 String(e) fallback', async () => {
    async function* throwsString(): AsyncIterable<CanonicalEvent> {
      yield { type: 'text.delta', text: 'before' }
      throw 'plain string error' // eslint-disable-line @typescript-eslint/only-throw-error
    }
    const stream = eventsToSSEStream(throwsString())
    const output = await collectDecoded(stream)
    expect(output).toHaveLength(2)
    expect(output[1]).toEqual({
      type: 'error',
      code: 'unknown',
      message: 'plain string error',
    })
  })

  it('第一个 event 就 throw → 只有一个 error event', async () => {
    async function* throwsImmediately(): AsyncIterable<CanonicalEvent> {
      throw new Error('immediate boom')
      yield { type: 'text.delta', text: 'never' } // eslint-disable-line no-unreachable
    }
    const stream = eventsToSSEStream(throwsImmediately())
    const output = await collectDecoded(stream)
    expect(output).toEqual([{ type: 'error', code: 'unknown', message: 'immediate boom' }])
  })
})

// --- chunk boundary edge cases --------------------------------------------

describe('decodeSSEStream 跨 chunk 边界鲁棒性', () => {
  it('frame 拆成两个 chunk(切在 data: 字符串中间)→ 仍能正确 parse', async () => {
    const evt: CanonicalEvent = { type: 'text.delta', text: 'Hello, world!' }
    const wire = encodeSSEFrame(evt)
    // 切在 data: 后面的 JSON 中间(任意中间位置)
    const splitPos = wire.indexOf('"text"') + 4
    expect(splitPos).toBeGreaterThan(0)
    expect(splitPos).toBeLessThan(wire.length)
    const [first, second] = splitAt(wire, splitPos)
    const stream = chunkedStream([first, second])
    const output = await collectDecoded(stream)
    expect(output).toEqual([evt])
  })

  it('\\n\\n 跨 chunk 边界(第一个 chunk 以 \\n 结尾,第二个 chunk 以 \\n 开头)', async () => {
    const evt: CanonicalEvent = { type: 'finish', reason: 'stop', usage: { input: 1, output: 2 } }
    const wire = encodeSSEFrame(evt)
    // 切在倒数第二个字符前,让第一段以 ...}\n 结尾,第二段是 \n
    const splitPos = wire.length - 1
    const [first, second] = splitAt(wire, splitPos)
    expect(first.endsWith('\n')).toBe(true)
    expect(second).toBe('\n')
    const stream = chunkedStream([first, second])
    const output = await collectDecoded(stream)
    expect(output).toEqual([evt])
  })

  it('多个 frame 在一个 chunk + 切在第二个 frame 中间 → 顺序保真', async () => {
    const e1: CanonicalEvent = { type: 'text.delta', text: 'first' }
    const e2: CanonicalEvent = { type: 'text.delta', text: 'second' }
    const e3: CanonicalEvent = { type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }
    const wire = encodeSSEFrame(e1) + encodeSSEFrame(e2) + encodeSSEFrame(e3)
    // 切在第二个 frame 中间
    const splitPos = wire.indexOf('second') + 3
    const [first, second] = splitAt(wire, splitPos)
    const stream = chunkedStream([first, second])
    const output = await collectDecoded(stream)
    expect(output).toEqual([e1, e2, e3])
  })

  it('单 byte chunk(极端 chunked delivery)→ 仍能 parse 出全部 event', async () => {
    const events: CanonicalEvent[] = [
      { type: 'text.delta', text: 'abc' },
      { type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } },
    ]
    const wire = events.map(encodeSSEFrame).join('')
    // 每个字符独占一个 chunk
    const chunks = wire.split('').map((c) => c)
    const stream = chunkedStream(chunks)
    const output = await collectDecoded(stream)
    expect(output).toEqual(events)
  })

  it('中文字符跨 chunk byte 边界(UTF-8 多字节)→ TextDecoder stream:true 正确拼接', async () => {
    const evt: CanonicalEvent = { type: 'text.delta', text: '你好世界' }
    const wire = encodeSSEFrame(evt)
    // 用 TextEncoder 拿到 byte 数组,在中文字符 byte 中间切
    const encoder = new TextEncoder()
    const bytes = encoder.encode(wire)
    // 找到第一个中文字符的开始 byte(查 `}` 后面的位置 + 1)
    // 简单做法:在整个 byte 数组中间附近找一个 byte 位置切;`你好世界` 占
    // 12 byte(每字 3 byte),`data: {"type":"text.delta","text":"` 是 ASCII,
    // 故 byte 位置 wire.indexOf('"你好世界"') 之后切就能切到多字节中间
    const utf8StartChar = wire.indexOf('你')
    expect(utf8StartChar).toBeGreaterThan(0)
    // wire 是 string,index 是 char,转 byte:前缀 ASCII 部分 byte 数 = char 数
    // 然后中文字 byte = char_index * 3(我们要切到 `你` 的第二个 byte 上)
    const cutByte = utf8StartChar + 1 // ASCII 前缀 + 1 byte(切到 '你' 第二 byte)
    const firstBytes = bytes.slice(0, cutByte)
    const secondBytes = bytes.slice(cutByte)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstBytes)
        controller.enqueue(secondBytes)
        controller.close()
      },
    })
    const output = await collectDecoded(stream)
    expect(output).toEqual([evt])
  })
})

// --- parseSSEFrame 容错 -----------------------------------------------------

describe('parseSSEFrame 容错', () => {
  it('缺 event: 行 → 返回 null', () => {
    expect(parseSSEFrame('data: {"type":"text.delta","text":"x"}')).toBeNull()
  })

  it('缺 data: 行 → 返回 null', () => {
    expect(parseSSEFrame('event: text.delta')).toBeNull()
  })

  it('data: 后 JSON corrupt → 返回 null(不抛错)', () => {
    expect(parseSSEFrame('event: text.delta\ndata: {not-valid-json}')).toBeNull()
  })

  it('空 frame → 返回 null', () => {
    expect(parseSSEFrame('')).toBeNull()
  })

  it('decodeSSEStream 遇到 corrupt frame 静默跳过,后续 frame 仍能 parse', async () => {
    const good: CanonicalEvent = { type: 'text.delta', text: 'good' }
    // 手工拼一段 wire:corrupt + good
    const corrupt = 'event: foo\ndata: {not-json}\n\n'
    const wire = corrupt + encodeSSEFrame(good)
    const stream = chunkedStream([wire])
    const output = await collectDecoded(stream)
    expect(output).toEqual([good])
  })
})
