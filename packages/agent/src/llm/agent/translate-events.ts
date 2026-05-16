/** Phase 12.7 Task D: pi-agent-core push-based AgentEvent → canonical pull-based async generator. */

import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessageEvent, AssistantMessage, ToolCall } from '@earendil-works/pi-ai'
import type { CanonicalEvent, TokenUsage, FinishReason } from '../types.js'
import { assertNever } from '../types.js'

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

  const unsubscribe = agent.subscribe((event, _signal) => {
    queue.push(event)
    wakeUp()
  })

  agent.prompt(prompt).catch((err: unknown) => {
    errored = err instanceof Error ? err : new Error(String(err))
    wakeUp()
  })

  try {
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

      yield* mapEvent(event)

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

function* mapEvent(event: AgentEvent): Generator<CanonicalEvent> {
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
      // pi-agent-core handleRunFailure 把 LLM 调用抛错包装成 agent_end + 一条
      // role:'assistant' 含 errorMessage 字段的 failureMessage(agent.js:325)。
      // 不存在 top-level error event 让我们直接 catch 这条路径 —— 必须扫描
      // messages 找 errorMessage,转 canonical error event 让前端看见
      // (2026-05-16 dogfood: missing API key 路径全套 silent fail)。
      const failure = extractFailureMessage(event.messages)
      if (failure) {
        yield { type: 'error', code: 'agent_run_failed', message: failure }
      }
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

    default:
      // pi-agent-core AgentEvent 加新 variant 时编译期 catch(而非运行期 silent drop)。
      return assertNever(event)
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

    default:
      // pi-ai AssistantMessageEvent 加新 variant 时编译期 catch。
      return assertNever(inner)
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
function extractFinalUsage(messages: ReadonlyArray<AgentMessage>): TokenUsage | null {
  const assistants = messages.filter(
    (m): m is AssistantMessage => m.role === 'assistant',
  )
  const last = assistants.at(-1)
  if (!last) return null
  const u = last.usage
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

/**
 * 扫 agent_end.messages 提 failure 文案(pi-agent-core handleRunFailure
 * 写入 AssistantMessage.errorMessage 字段)。无失败返 null。
 */
function extractFailureMessage(messages: ReadonlyArray<AgentMessage>): string | null {
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const errMsg = (m as AssistantMessage).errorMessage
    if (typeof errMsg === 'string' && errMsg.length > 0) return errMsg
  }
  return null
}

function extractFinishReason(messages: ReadonlyArray<AgentMessage>): FinishReason {
  const assistants = messages.filter(
    (m): m is AssistantMessage => m.role === 'assistant',
  )
  const last = assistants.at(-1)
  if (!last) return 'stop'
  switch (last.stopReason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'toolUse':
      return 'tool_use'
    default:
      // 'error' / 'aborted' / 未来扩展 → canonical 没对应位,fallback 'stop'
      // (error 路径已被 canonical error event 表达)。
      return 'stop'
  }
}
