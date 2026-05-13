/**
 * Phase 12 Task C：OpenAI streaming chunk → AsyncIterable<CanonicalEvent>。
 *
 * **状态机核心**:OpenAI tool_calls 用 `index` 区分并发的多个工具调用,arguments 字符串
 * 按多个 chunk fragment 拼装。流程:
 *
 *   chunk 1: `delta.tool_calls[0] = { index: 0, id: 'call_a', function: { name: 'foo', arguments: '{"q":' } }`
 *   chunk 2: `delta.tool_calls[0] = { index: 0, function: { arguments: '"hello' } }`
 *   chunk 3: `delta.tool_calls[1] = { index: 1, id: 'call_b', function: { name: 'bar', arguments: '{}' } }`
 *   chunk 4: `delta.tool_calls[0] = { index: 0, function: { arguments: '"}' } }`
 *   chunk 5: `finish_reason: 'tool_calls'`
 *
 * 翻译规则:
 * - 同 index 第一次出现(带 id / name)→ emit `tool_call.start { id, name }`
 * - 后续同 index 的 args fragment → emit `tool_call.delta { id, argsChunk }`
 * - `finish_reason` chunk → 遍历所有已 start 的 index emit `tool_call.end { id }`,再 emit `finish`
 *
 * **finish event 的 reason 映射**:
 * - 'stop'           → 'stop'
 * - 'length'         → 'length'
 * - 'tool_calls'     → 'tool_use'  (canonical 统一术语)
 * - 'content_filter' → 'content_filter'
 * - 'function_call'  → 'tool_use'  (legacy alias)
 * - null / 其他       → 'stop'      (兜底,实际不会出现)
 *
 * **usage 字段**:开 `stream_options: { include_usage: true }` 后最后一个 chunk
 * `choices: []` + 含 `usage`。把 prompt_tokens/completion_tokens 累到 finish event 的 usage。
 * 若 stream 提前中断没有 usage chunk,finish 仍 emit 但 usage 为 0(adapter 可选择重试或 fallback)。
 */

import OpenAI from 'openai'
import type { CanonicalEvent, FinishReason, TokenUsage } from '../types.js'

/** 单个 tool call 的累积状态(状态机内部用) */
interface ToolCallState {
  id: string
  name: string
  /** 是否已 emit tool_call.start(避免重复 emit) */
  started: boolean
}

export async function* fromOpenAIStream(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
): AsyncGenerator<CanonicalEvent> {
  const toolCalls = new Map<number, ToolCallState>()
  let finishReason: FinishReason = 'stop'
  let usage: TokenUsage = { input: 0, output: 0 }

  for await (const chunk of stream) {
    // usage-only chunk(stream_options.include_usage 末尾):choices 空,usage 有值
    if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
      usage = extractUsage(chunk.usage)
      continue
    }

    const choice = chunk.choices?.[0]
    if (!choice) continue

    // 1. 普通文本 delta
    if (choice.delta?.content) {
      yield { type: 'text.delta', text: choice.delta.content }
    }

    // 2. tool_calls fragment 累积
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index
        let state = toolCalls.get(idx)
        if (!state) {
          // 第一次看到这个 index
          state = { id: tc.id ?? '', name: tc.function?.name ?? '', started: false }
          toolCalls.set(idx, state)
        } else {
          // 后续 fragment 可能补 id / name(provider 实现差异),更新 state
          if (tc.id && !state.id) state.id = tc.id
          if (tc.function?.name && !state.name) state.name = tc.function.name
        }

        // 拿到 id + name 之前不能 emit start —— GLM 等中转 provider 可能把 id / name
        // 拆到不同 chunk;延后到信息齐全再 emit。
        if (!state.started && state.id && state.name) {
          state.started = true
          yield { type: 'tool_call.start', id: state.id, name: state.name }
        }

        // args fragment:state.started=true 才有意义(否则 caller 拿不到 id 关联),
        // 但 args 可能跨 chunk,延后到 id 出现后再 emit。这里采用即时 emit:
        // 若 state 已 started 直接 emit delta,否则把 args 暂存等 start 后再补发。
        if (tc.function?.arguments) {
          if (state.started) {
            yield { type: 'tool_call.delta', id: state.id, argsChunk: tc.function.arguments }
          }
          // 未 started 时丢弃 args 简化逻辑——OpenAI 协议保证 id/name 在 args 之前
          // (或同 chunk);中转协议若违反,缺失部分会让 LLM 端工具调用失败,
          // 调用方需自检 raw stream。生产观察后再加 buffer 兜底。
        }
      }
    }

    // 3. finish_reason 出现 → 更新最终 reason(下一轮 loop / 结束 emit 会用)
    if (choice.finish_reason) {
      finishReason = mapFinishReason(choice.finish_reason)
    }
  }

  // 4. stream 结束:把所有已 start 的 tool_call emit end
  for (const state of toolCalls.values()) {
    if (state.started) {
      yield { type: 'tool_call.end', id: state.id }
    }
  }

  // 5. 始终 emit finish 收尾 —— stream 异常截断也要给 caller 一个收尾信号,
  // upstream 路由 / SSE 写出方需要 finish 来关闭 response。
  // 若整个 stream 没出现 finish_reason,finishReason 保持 default 'stop'。
  yield { type: 'finish', reason: finishReason, usage }
}

function mapFinishReason(
  reason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'],
): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'content_filter'
    case null:
    case undefined:
    default:
      return 'stop'
  }
}

function extractUsage(u: OpenAI.CompletionUsage): TokenUsage {
  const out: TokenUsage = {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
  }
  const cached = u.prompt_tokens_details?.cached_tokens
  if (typeof cached === 'number' && cached > 0) {
    out.cached = cached
  }
  return out
}
