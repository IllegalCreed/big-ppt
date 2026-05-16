/** Phase 12.7 Task D: translate-events 单测(7 测)—— pi-agent-core push event → canonical pull stream。 */

import { describe, expect, it } from 'vitest'
import { translateAgentStream } from '../translate-events.js'
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { CanonicalEvent } from '../../types.js'

/**
 * 构造 fake Agent:`subscribe` 注册 handler(签名跟真 Agent.subscribe 一致:
 * `(event, signal)`,signal 用 dummy AbortController.signal 占位);`prompt`
 * 被调时按脚本同步推所有 events,每条之间 `await Promise.resolve()` 让
 * generator 有机会 yield。
 */
function fakeAgent(scriptedEvents: AgentEvent[]): Agent {
  type Listener = (event: AgentEvent, signal: AbortSignal) => void | Promise<void>
  const handlers: Listener[] = []
  const dummySignal = new AbortController().signal
  return {
    subscribe(handler: Listener) {
      handlers.push(handler)
      return () => {
        const i = handlers.indexOf(handler)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    async prompt() {
      for (const e of scriptedEvents) {
        for (const h of handlers) h(e, dummySignal)
        // yield event loop: 让 generator 拉到这条再喂下一条
        await Promise.resolve()
      }
    },
  } as unknown as Agent
}

async function collect(stream: AsyncGenerator<CanonicalEvent>): Promise<CanonicalEvent[]> {
  const events: CanonicalEvent[] = []
  for await (const e of stream) events.push(e)
  return events
}

/** 构造一个 minimal assistant message,只填我们映射逻辑读到的字段(usage / stopReason)。 */
function assistantMsg(opts: {
  usage?: { input: number; output: number; cacheRead: number; cacheWrite?: number; cost?: AssistantMessage['usage']['cost'] }
  stopReason?: AssistantMessage['stopReason']
}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'unknown',
    model: 'unknown',
    usage: {
      input: opts.usage?.input ?? 0,
      output: opts.usage?.output ?? 0,
      cacheRead: opts.usage?.cacheRead ?? 0,
      cacheWrite: opts.usage?.cacheWrite ?? 0,
      totalTokens:
        (opts.usage?.input ?? 0) +
        (opts.usage?.output ?? 0) +
        (opts.usage?.cacheRead ?? 0) +
        (opts.usage?.cacheWrite ?? 0),
      cost: opts.usage?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: opts.stopReason ?? 'stop',
    timestamp: 1,
  }
}

describe('translateAgentStream', () => {
  it('simple text: agent_start → turn.start; text_delta → text.delta; agent_end → turn.end', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: assistantMsg({}),
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Hello',
          partial: assistantMsg({}),
        },
      },
      {
        type: 'message_update',
        message: assistantMsg({}),
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: ' world',
          partial: assistantMsg({}),
        },
      },
      { type: 'agent_end', messages: [assistantMsg({})] },
    ])
    const events = await collect(translateAgentStream(agent, 'hi'))
    expect(events.map((e) => e.type)).toEqual(['turn.start', 'text.delta', 'text.delta', 'turn.end'])
    expect((events[1] as { text: string }).text).toBe('Hello')
    expect((events[2] as { text: string }).text).toBe(' world')
  })

  it('tool call + tool execution: emits tool_call.{start,delta,end} + tool_execution.{start,end}', async () => {
    const toolCallBlock = { type: 'toolCall' as const, id: 'call_1', name: 'get_weather', arguments: {} }
    const partialWithToolCall: AssistantMessage = {
      ...assistantMsg({}),
      content: [toolCallBlock],
    }
    const agent = fakeAgent([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: partialWithToolCall,
        assistantMessageEvent: {
          type: 'toolcall_start',
          contentIndex: 0,
          partial: partialWithToolCall,
        },
      },
      {
        type: 'message_update',
        message: partialWithToolCall,
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{"loc":',
          partial: partialWithToolCall,
        },
      },
      {
        type: 'message_update',
        message: partialWithToolCall,
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall: toolCallBlock,
          partial: partialWithToolCall,
        },
      },
      { type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'get_weather', args: {} },
      {
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        result: 'sunny',
        isError: false,
      },
      { type: 'agent_end', messages: [assistantMsg({ stopReason: 'toolUse' })] },
    ])
    const events = await collect(translateAgentStream(agent, 'weather?'))
    const types = events.map((e) => e.type)
    expect(types).toContain('tool_call.start')
    expect(types).toContain('tool_call.delta')
    expect(types).toContain('tool_call.end')
    expect(types).toContain('tool_execution.start')
    expect(types).toContain('tool_execution.end')

    const start = events.find((e) => e.type === 'tool_call.start') as
      | { type: 'tool_call.start'; id: string; name: string }
      | undefined
    expect(start?.id).toBe('call_1')
    expect(start?.name).toBe('get_weather')

    const delta = events.find((e) => e.type === 'tool_call.delta') as
      | { type: 'tool_call.delta'; argsChunk: string }
      | undefined
    expect(delta?.argsChunk).toBe('{"loc":')

    const execStart = events.find((e) => e.type === 'tool_execution.start') as
      | { type: 'tool_execution.start'; toolCallId: string; toolName: string }
      | undefined
    expect(execStart?.toolCallId).toBe('call_1')
    expect(execStart?.toolName).toBe('get_weather')

    const turnEnd = events.find((e) => e.type === 'turn.end') as
      | { type: 'turn.end'; reason: string }
      | undefined
    expect(turnEnd?.reason).toBe('tool_use')
  })

  it('thinking: thinking_delta → thinking.delta(原文 text)', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: assistantMsg({}),
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: 'pondering...',
          partial: assistantMsg({}),
        },
      },
      { type: 'agent_end', messages: [assistantMsg({})] },
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    expect(events.map((e) => e.type)).toEqual(['turn.start', 'thinking.delta', 'turn.end'])
    expect((events[1] as { text: string }).text).toBe('pondering...')
  })

  it('cache hit: usage.cacheRead > 0 → 先 emit cache.hit 再 turn.end', async () => {
    const lastMsg = assistantMsg({
      usage: {
        input: 200,
        output: 50,
        cacheRead: 1500,
        cost: { input: 0.001, output: 0.0005, cacheRead: 0.0001, cacheWrite: 0, total: 0.0016 },
      },
    })
    const agent = fakeAgent([
      { type: 'agent_start' },
      { type: 'agent_end', messages: [lastMsg] },
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    expect(events.map((e) => e.type)).toEqual(['turn.start', 'cache.hit', 'turn.end'])
    const cacheHit = events[1] as { type: 'cache.hit'; cachedTokens: number; costTokens: number }
    expect(cacheHit.cachedTokens).toBe(1500)
    expect(cacheHit.costTokens).toBe(200) // input,不是 cacheRead
    const turnEnd = events[2] as { type: 'turn.end'; usage: { input: number; cached?: number; cost?: { total: number } } }
    expect(turnEnd.usage.input).toBe(200)
    expect(turnEnd.usage.cached).toBe(1500)
    expect(turnEnd.usage.cost?.total).toBe(0.0016)
  })

  it('error in-stream: assistantMessageEvent.error → canonical error', async () => {
    const errMsg = assistantMsg({ stopReason: 'error' })
    errMsg.errorMessage = 'rate limited'
    const agent = fakeAgent([
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: errMsg,
        assistantMessageEvent: {
          type: 'error',
          reason: 'error',
          error: errMsg,
        },
      },
      { type: 'agent_end', messages: [errMsg] },
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    const errorEvt = events.find((e) => e.type === 'error') as
      | { type: 'error'; code: string; message: string }
      | undefined
    expect(errorEvt).toBeDefined()
    expect(errorEvt!.message).toBe('rate limited')
    expect(errorEvt!.code).toBe('error')
  })

  it('handleRunFailure: agent_end 含 errorMessage 失败 message → emit canonical error', async () => {
    // 2026-05-16 dogfood 修正:pi-agent-core handleRunFailure 把 LLM 抛错包装成
    // agent_end + 一条 role:'assistant' 含 errorMessage 字段的 failureMessage,
    // 不发独立 error event(plan 27 + agent.js:325)。translateAgentStream 必须
    // 主动扫 messages 提 errorMessage 转 canonical error,否则上层只看到 turn.end
    // usage=0 silent fail。
    const failureMsg = assistantMsg({
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
    })
    failureMsg.errorMessage = 'missing api key for zai'
    const agent = fakeAgent([
      { type: 'agent_start' },
      // 注意:这里没有 message_update —— handleRunFailure 路径下 streamFn 直接抛错,
      // 不走 stream loop,只 emit agent_end with failureMessage
      { type: 'agent_end', messages: [failureMsg] },
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    const types = events.map((e) => e.type)
    expect(types).toContain('error')
    const errorEvt = events.find((e) => e.type === 'error') as
      | { type: 'error'; code: string; message: string }
      | undefined
    expect(errorEvt).toBeDefined()
    expect(errorEvt!.message).toBe('missing api key for zai')
    expect(errorEvt!.code).toBe('agent_run_failed')
    // turn.end 仍在(usage 全 0)
    expect(types[types.length - 1]).toBe('turn.end')
  })

  it('prompt() rejection: agent.prompt throw → generator throws', async () => {
    const agent = {
      subscribe: () => () => {},
      prompt: async () => {
        throw new Error('boom')
      },
    } as unknown as Agent
    await expect(collect(translateAgentStream(agent, 'q'))).rejects.toThrow('boom')
  })

  it('drop internal turn/message events: turn_start / turn_end / message_start / message_end 全 drop', async () => {
    const msg = assistantMsg({})
    const agent = fakeAgent([
      { type: 'agent_start' },
      { type: 'turn_start' },
      { type: 'message_start', message: msg },
      { type: 'message_end', message: msg },
      { type: 'turn_end', message: msg, toolResults: [] },
      { type: 'agent_end', messages: [msg] },
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    expect(events.map((e) => e.type)).toEqual(['turn.start', 'turn.end'])
  })
})
