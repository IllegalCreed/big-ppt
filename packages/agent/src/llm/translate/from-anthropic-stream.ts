/**
 * Phase 12 Task G:Anthropic streaming events → AsyncIterable<CanonicalEvent>。
 *
 * **Anthropic streaming protocol**(SDK 提供的 RawMessageStreamEvent union):
 *
 *   - `message_start`:首 event。`message.usage` 含 `input_tokens` +
 *     `cache_read_input_tokens?` + `cache_creation_input_tokens?`(prompt caching 信号)
 *   - `content_block_start` { index, content_block }:每个 content block 开始,带 index 关联后续 delta
 *     - content_block.type = 'text' → 后续 text_delta
 *     - content_block.type = 'thinking' → 后续 thinking_delta
 *     - content_block.type = 'tool_use' → 后续 input_json_delta + 自带 id/name
 *   - `content_block_delta` { index, delta }:
 *     - delta.type = 'text_delta' → emit text.delta
 *     - delta.type = 'thinking_delta' → emit thinking.delta
 *     - delta.type = 'input_json_delta' → emit tool_call.delta(args fragment)
 *     - delta.type = 'citations_delta' / 'signature_delta':silent drop(canonical 没对应类型)
 *   - `content_block_stop` { index }:tool_use 类 block 时 emit tool_call.end
 *   - `message_delta` { delta, usage }:含最终 stop_reason + 累计 output_tokens
 *   - `message_stop`:收尾。emit finish event(从前面累计的 stop_reason + usage)
 *
 * **状态机**:维护 `Map<index, BlockState>` 追踪每个 content block 的类型 + tool 信息。
 *
 * **cache.hit 事件**:`message_start.usage.cache_read_input_tokens > 0` 时 emit。
 * `cachedTokens` 取 cache_read_input_tokens,`costTokens` 取 input_tokens(实际付费 token 数)。
 *
 * **stop_reason 映射**:
 * - 'end_turn'      → 'stop'
 * - 'stop_sequence' → 'stop'(canonical 没 stop_sequence 单独 reason,合并为 stop)
 * - 'max_tokens'    → 'length'
 * - 'tool_use'      → 'tool_use'
 * - 'pause_turn'    → 'stop'(长时间任务暂停,canonical 视为正常 stop)
 * - 'refusal'       → 'content_filter'(策略拒绝)
 * - null            → 'stop'(stream 异常截断兜底)
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { CanonicalEvent, FinishReason, TokenUsage } from '../types.js'

type AnthropicStreamEvent = Anthropic.Messages.RawMessageStreamEvent

interface BlockState {
  type: 'text' | 'thinking' | 'tool_use' | 'other'
  /** tool_use 才有的 id,后续 tool_call.delta / end 用 */
  toolId?: string
}

export async function* fromAnthropicStream(
  stream: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<CanonicalEvent> {
  const blocks = new Map<number, BlockState>()
  let stopReason: FinishReason = 'stop'
  let usage: TokenUsage = { input: 0, output: 0 }

  for await (const event of stream) {
    switch (event.type) {
      case 'message_start': {
        const u = event.message.usage
        usage = {
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        }
        const cached = u.cache_read_input_tokens ?? 0
        if (cached > 0) {
          usage.cached = cached
          // emit cache.hit:cachedTokens = 读缓存的 token 数,costTokens = 本次实际付费 input
          yield { type: 'cache.hit', cachedTokens: cached, costTokens: u.input_tokens ?? 0 }
        }
        break
      }

      case 'content_block_start': {
        const block = event.content_block
        if (block.type === 'text') {
          blocks.set(event.index, { type: 'text' })
        } else if (block.type === 'thinking') {
          blocks.set(event.index, { type: 'thinking' })
        } else if (block.type === 'tool_use') {
          blocks.set(event.index, { type: 'tool_use', toolId: block.id })
          yield { type: 'tool_call.start', id: block.id, name: block.name }
        } else {
          // server_tool_use / web_search / code_execution 等扩展 block 类型 — canonical
          // 没对应表达,silent drop;调用方若需要这些扩展,canonical event 要扩展。
          blocks.set(event.index, { type: 'other' })
        }
        break
      }

      case 'content_block_delta': {
        const state = blocks.get(event.index)
        if (!state) break // 防御:理论不会发生
        const delta = event.delta
        if (delta.type === 'text_delta' && state.type === 'text') {
          yield { type: 'text.delta', text: delta.text }
        } else if (delta.type === 'thinking_delta' && state.type === 'thinking') {
          yield { type: 'thinking.delta', text: delta.thinking }
        } else if (delta.type === 'input_json_delta' && state.type === 'tool_use' && state.toolId) {
          yield { type: 'tool_call.delta', id: state.toolId, argsChunk: delta.partial_json }
        }
        // citations_delta / signature_delta 等 silent drop
        break
      }

      case 'content_block_stop': {
        const state = blocks.get(event.index)
        if (state?.type === 'tool_use' && state.toolId) {
          yield { type: 'tool_call.end', id: state.toolId }
        }
        // text / thinking block stop:canonical 没对应 end event,silent drop
        break
      }

      case 'message_delta': {
        // 这里 delta.stop_reason + delta.usage 是**累计**值;output_tokens 是累计输出
        if (event.delta.stop_reason) {
          stopReason = mapStopReason(event.delta.stop_reason)
        }
        const u = event.usage
        if (typeof u.output_tokens === 'number') {
          usage.output = u.output_tokens
        }
        // input_tokens 在 message_start 已经定;不覆盖(避免被 null overwrite)
        if (typeof u.input_tokens === 'number' && u.input_tokens > usage.input) {
          usage.input = u.input_tokens
        }
        break
      }

      case 'message_stop': {
        // finish 在外部 loop 后 emit(让 message_stop 是哨兵)
        break
      }

      // 未知事件类型直接忽略(SDK 后续可能加新事件)
      default:
        break
    }
  }

  // stream 结束:emit finish 收尾
  yield { type: 'finish', reason: stopReason, usage }
}

function mapStopReason(reason: Anthropic.Messages.StopReason): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_use'
    case 'refusal':
      return 'content_filter'
    default:
      // canonical fallback:未知 reason 视作 'stop'
      return 'stop'
  }
}
