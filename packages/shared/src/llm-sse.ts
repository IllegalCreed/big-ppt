/**
 * Phase 12 Task D：canonical event SSE wire format(encoder + decoder)。
 *
 * 定义 agent → frontend 的有线协议:把 canonical event 流编码为标准 SSE frame
 * (`event: <type>\ndata: <json>\n\n`),frontend 通过 `decodeSSEStream` 反向消费。
 *
 * Why 放 shared 而非 agent:跟 Task B 的 llm-canonical.ts 同样的 single source of
 * truth + 跨包 rootDir 限制考量。frontend(creator)`import { decodeSSEStream }
 * from '@big-ppt/shared'` 直接拿;agent 通过 thin re-export
 * `packages/agent/src/llm/canonical-sse.ts` 让内部 import path 整齐。
 *
 * Wire 协议细节:
 * - 标准 SSE frame 用 `\n\n` 分隔,`event:` / `data:` 之间用单 `\n`
 * - `data:` 字段值是 `JSON.stringify(event)`,canonical event 内不含换行,
 *   故 frontend 浏览器 EventSource API 直接可消费(不必处理多行 data 拼接)
 * - 流中途异常 → emit 一个 `error` event(code='unknown')再 close,
 *   让 frontend 永远收到完整结束信号(不留半截 broken stream)
 *
 * TextDecoder 跨 chunk 边界:`decode(chunk, { stream: true })` 让多字节 UTF-8
 * (如中文字符)拆在两个 chunk 之间也能正确拼接;最终一次 `decode(value)` 不带
 * `stream: true` 会冲掉残余 byte(本实现里 final flush 不必,因为 frame 边界
 * `\n\n` 永远在完整 ASCII byte 上)。
 */

import type { CanonicalEvent } from './llm-canonical.js'

/** agent 端用:单个 event 编码为 SSE frame(event: type\ndata: json\n\n) */
export function encodeSSEFrame(evt: CanonicalEvent): string {
  return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`
}

/**
 * agent 端用:把 AsyncIterable<CanonicalEvent> 转成 ReadableStream<Uint8Array>,
 * 供 Hono response。
 *
 * 中途异常 → 强制 emit 一个 `error` event 再 close,frontend 永远拿到收尾信号。
 */
export function eventsToSSEStream(
  events: AsyncIterable<CanonicalEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const evt of events) {
          controller.enqueue(encoder.encode(encodeSSEFrame(evt)))
        }
        controller.close()
      } catch (e) {
        const errEvt: CanonicalEvent = {
          type: 'error',
          code: 'unknown',
          message: e instanceof Error ? e.message : String(e),
        }
        controller.enqueue(encoder.encode(encodeSSEFrame(errEvt)))
        controller.close()
      }
    },
  })
}

/**
 * frontend / test 端用:ReadableStream<Uint8Array> 解析回 AsyncIterable<CanonicalEvent>。
 *
 * 按 `\n\n` 切 frame;每个 frame 内找 `event: ` / `data: ` 行,JSON.parse data。
 * 半 frame 边界(chunk 切在 frame 中间)由内部 buffer 累积,直到下一次 `\n\n`
 * 出现才 yield。
 */
export async function* decodeSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<CanonicalEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // 按 \n\n 切 frame
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const evt = parseSSEFrame(frame)
      if (evt) yield evt
    }
  }
}

/**
 * 解析单个 SSE frame(不含尾部 `\n\n`)。
 *
 * 失败容忍:缺 event / data 行 → 返回 null(decoder 静默跳过该 frame);
 * JSON.parse 抛错 → 同样返回 null,避免一个 corrupt frame 让整个流崩。
 *
 * 注意:不导出对外,但本文件单测会从 llm-sse 内部 import 拿来覆盖率,
 * 同时 agent 端 canonical-sse.ts 通过 `export *` 也带出来(对调用方语义无意义,
 * 但保持 plan 中描述的 4 个名字 re-export)。
 */
export function parseSSEFrame(frame: string): CanonicalEvent | null {
  const lines = frame.split('\n')
  const eventLine = lines.find((l) => l.startsWith('event: '))
  const dataLine = lines.find((l) => l.startsWith('data: '))
  if (!eventLine || !dataLine) return null
  try {
    return JSON.parse(dataLine.slice('data: '.length)) as CanonicalEvent
  } catch {
    return null
  }
}
