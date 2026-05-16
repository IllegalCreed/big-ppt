/** Phase 12.7 Task D: pi-agent-core push-based AgentEvent → canonical pull-based async generator. */

import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessageEvent, AssistantMessage, ToolCall } from '@earendil-works/pi-ai'
import type { CanonicalEvent, TokenUsage, FinishReason } from '../types.js'

/**
 * pi-agent-core 用 `agent.subscribe(handler)` 推事件,我们需要 yield 给上游 SSE。
 * 模式:subscribe 把事件推 buffer queue;generator 从 queue 拉,空时 await
 * `resolveNext` promise 等下一事件。`agent.prompt()` 不 await,让事件流通过
 * subscribe push 驱动,只 catch 它的 rejection 走 errored 标记唤醒 generator throw。
 *
 * 终止信号:agent_end(正常)、prompt rejection(异常)。`unsubscribe()` 在 finally
 * 兜底,防止 generator 提前 break / throw 后 listener 残留。
 *
 * pi-agent-core AgentEvent 真实 shape(`node_modules/@earendil-works/pi-agent-core/
 * dist/types.d.ts`)只有 9 个 type,**没有**顶层 `error` event;in-stream 错误走
 * `message_update.assistantMessageEvent: {type:'error', reason, error}` 这条嵌套
 * 路径(pi-ai AssistantMessageEvent.error)。plan 28 模板假设的顶层 error event
 * 不存在,本实现按真实嵌套路径映射。
 */
export async function* translateAgentStream(
  agent: Agent,
  prompt: string,
): AsyncGenerator<CanonicalEvent> {
  const queue: AgentEvent[] = []
  let resolveNext: (() => void) | null = null
  let ended = false
  let errored: Error | null = null

  const wakeUp = () => {
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  }

  const unsubscribe = agent.subscribe((event) => {
    queue.push(event)
    wakeUp()
  })

  agent.prompt(prompt).catch((err: unknown) => {
    errored = err instanceof Error ? err : new Error(String(err))
    wakeUp()
  })

  try {
    let turnId: string | null = null

    while (!ended) {
      if (queue.length === 0) {
        if (errored) throw errored
        await new Promise<void>((resolve) => {
          resolveNext = resolve
        })
        if (errored) throw errored
        continue
      }
      const event = queue.shift()!

      yield* mapEvent(event, () => turnId)

      if (event.type === 'agent_start' && turnId === null) {
        turnId = generateTurnId()
      }
      if (event.type === 'agent_end') {
        ended = true
      }
    }
  } finally {
    unsubscribe()
  }
}

function generateTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function* mapEvent(
  event: AgentEvent,
  _getTurnId: () => string | null,
): Generator<CanonicalEvent> {
  switch (event.type) {
    case 'agent_start': {
      yield { type: 'turn.start', turnId: generateTurnId() }
      return
    }

    case 'turn_start':
    case 'turn_end':
    case 'message_start':
    case 'message_end':
      // canonical 用 agent 维度的 turn.start/end 表达,pi-agent-core 的内部
      // turn / message 边界全部丢弃。
      return

    case 'message_update':
      yield* mapAssistantEvent(event.assistantMessageEvent)
      return

    case 'tool_execution_start':
      yield {
        type: 'tool_execution.start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      }
      return

    case 'tool_execution_update':
      yield {
        type: 'tool_execution.delta',
        toolCallId: event.toolCallId,
        partial: event.partialResult,
      }
      return

    case 'tool_execution_end':
      yield {
        type: 'tool_execution.end',
        toolCallId: event.toolCallId,
        isError: event.isError,
      }
      return

    case 'agent_end': {
      const usage = extractFinalUsage(event.messages)
      if (usage && usage.cached && usage.cached > 0) {
        yield {
          type: 'cache.hit',
          cachedTokens: usage.cached,
          costTokens: usage.input,
        }
      }
      yield {
        type: 'turn.end',
        usage: usage ?? { input: 0, output: 0 },
        reason: extractFinishReason(event.messages),
      }
      return
    }
  }
}

function* mapAssistantEvent(inner: AssistantMessageEvent): Generator<CanonicalEvent> {
  switch (inner.type) {
    case 'start':
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
    case 'done':
      return // 起止 marker 不映射,canonical 不区分 block 边界

    case 'text_delta':
      yield { type: 'text.delta', text: inner.delta }
      return

    case 'thinking_delta':
      yield { type: 'thinking.delta', text: inner.delta }
      return

    case 'toolcall_start': {
      const tc = extractToolCallAt(inner.partial, inner.contentIndex)
      if (!tc) return
      yield { type: 'tool_call.start', id: tc.id, name: tc.name }
      return
    }

    case 'toolcall_delta': {
      const tc = extractToolCallAt(inner.partial, inner.contentIndex)
      if (!tc) return
      yield { type: 'tool_call.delta', id: tc.id, argsChunk: inner.delta }
      return
    }

    case 'toolcall_end': {
      yield { type: 'tool_call.end', id: inner.toolCall.id }
      return
    }

    case 'error': {
      yield {
        type: 'error',
        code: inner.reason,
        message: inner.error.errorMessage ?? `assistant message ${inner.reason}`,
      }
      return
    }
  }
}

function extractToolCallAt(
  partial: AssistantMessage,
  index: number,
): ToolCall | null {
  const block = partial.content[index]
  if (block?.type !== 'toolCall') return null
  return block
}

/** 从 agent_end.messages 末尾的 assistant 提取 final usage(已聚合本轮所有 LLM 调用)。 */
function extractFinalUsage(
  messages: ReadonlyArray<{ role: string; usage?: { input: number; output: number; cacheRead: number; cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } } }>,
): TokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.usage) continue
    const u = m.usage
    const out: TokenUsage = { input: u.input, output: u.output }
    if (u.cacheRead > 0) out.cached = u.cacheRead
    if (u.cost) {
      out.cost = {
        total: u.cost.total,
        input: u.cost.input,
        output: u.cost.output,
        cacheRead: u.cost.cacheRead,
        cacheWrite: u.cost.cacheWrite,
      }
    }
    return out
  }
  return null
}

function extractFinishReason(
  messages: ReadonlyArray<{ role: string; stopReason?: string }>,
): FinishReason {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.stopReason) continue
    switch (m.stopReason) {
      case 'stop':
        return 'stop'
      case 'length':
        return 'length'
      case 'toolUse':
        return 'tool_use'
      default:
        return 'stop'
    }
  }
  return 'stop'
}
