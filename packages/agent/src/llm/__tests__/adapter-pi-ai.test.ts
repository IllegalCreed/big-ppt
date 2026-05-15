/**
 * Phase 12.5 Task B：pi-ai-adapter 单测。
 *
 * 策略：用 pi-ai 内置 `registerFauxProvider` 注入脚本响应，验证
 *   1) canonical event 映射全 11 类 pi-ai 事件 → 8 类 canonical 事件
 *   2) error 翻译 6 个 LLMErrorCode + AbortError + non-Error + status fallback
 *   3) AbortSignal 透传 + 中途 cancel
 *   4) cost / cache.hit 透传
 *   5) canonical request → pi-ai Context 翻译（system 拆出 / tool_result / image）
 *
 * 注意：faux provider 不进 pi-ai 内置 MODELS 表，因此通过
 * `__setModelResolverForTesting` 注入 `reg.getModel()`（不走默认 getModel）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type FauxProviderRegistration,
} from '@earendil-works/pi-ai'
import {
  createPiAiAdapter,
  translatePiAiError,
  translatePiEvent,
  __setModelResolverForTesting,
} from '../adapters/pi-ai-adapter.js'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import { LLMError } from '../errors.js'
import type {
  CanonicalChatRequest,
  CanonicalEvent,
  CanonicalMessage,
} from '../types.js'

let faux: FauxProviderRegistration | null = null

beforeEach(() => {
  // 注册 faux provider 并把 resolver 指向它，让 adapter 拿到 faux model
  faux = registerFauxProvider({ tokensPerSecond: 100000 })
  const fauxModel = faux.getModel()
  __setModelResolverForTesting(() => fauxModel)
})

afterEach(() => {
  faux?.unregister()
  faux = null
  __setModelResolverForTesting(null)
})

function userText(text: string): CanonicalMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function buildAdapter(providerId = 'openai') {
  return createPiAiAdapter({ id: providerId, apiKey: 'sk-faux-key' })
}

async function collectEvents(
  req: CanonicalChatRequest,
  adapter = buildAdapter(),
  signal?: AbortSignal,
): Promise<CanonicalEvent[]> {
  const controller = new AbortController()
  const sig = signal ?? controller.signal
  const events: CanonicalEvent[] = []
  for await (const evt of adapter.streamChat(req, sig)) {
    events.push(evt)
  }
  return events
}

describe('createPiAiAdapter — text-only stream', () => {
  it('翻译 text-only 响应到 text.delta + finish', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('hello world')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    const types = events.map((e) => e.type)
    expect(types).toContain('text.delta')
    expect(types[types.length - 1]).toBe('finish')
  })

  it('text.delta 累加拼接还原原文', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('the quick brown fox')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    const joined = events
      .filter((e): e is { type: 'text.delta'; text: string } => e.type === 'text.delta')
      .map((e) => e.text)
      .join('')
    expect(joined).toBe('the quick brown fox')
  })

  it('drop start / text_start / text_end 包络事件', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('hi')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    // canonical 只有 8 类 type；不应见到 pi-ai 内部 start / *_start / *_end 名
    const types = events.map((e) => e.type)
    expect(types).not.toContain('start')
    expect(types).not.toContain('text_start')
    expect(types).not.toContain('text_end')
  })
})

describe('createPiAiAdapter — finish reason 映射', () => {
  it('stop → stop', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('ok')], { stopReason: 'stop' })])
    const events = await collectEvents({ messages: [userText('hi')] })
    const finish = events.find((e) => e.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('length → length', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxText('truncated')], { stopReason: 'length' }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const finish = events.find((e) => e.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: 'length' })
  })

  it('toolUse → tool_use', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxToolCall('foo', { x: 1 })], { stopReason: 'toolUse' }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const finish = events.find((e) => e.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: 'tool_use' })
  })
})

describe('createPiAiAdapter — thinking event 映射', () => {
  it('thinking_delta → canonical thinking.delta', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxThinking('let me reason'), fauxText('answer is 42')]),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const thinking = events.filter((e) => e.type === 'thinking.delta')
    expect(thinking.length).toBeGreaterThan(0)
    const joined = thinking
      .filter((e): e is { type: 'thinking.delta'; text: string } => e.type === 'thinking.delta')
      .map((e) => e.text)
      .join('')
    expect(joined).toBe('let me reason')
  })

  it('thinking + text 顺序保留', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxThinking('A'), fauxText('B')]),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const filtered = events.filter(
      (e) => e.type === 'thinking.delta' || e.type === 'text.delta',
    )
    expect(filtered[0]!.type).toBe('thinking.delta')
    expect(filtered[filtered.length - 1]!.type).toBe('text.delta')
  })

  it('drop thinking_start / thinking_end 包络', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxThinking('x'), fauxText('y')]),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const types = events.map((e) => e.type)
    expect(types).not.toContain('thinking_start')
    expect(types).not.toContain('thinking_end')
  })
})

describe('createPiAiAdapter — tool call event 映射', () => {
  it('toolcall_start → tool_call.start with id+name', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxToolCall('search', { q: 'cats' }, { id: 'tc_42' })], {
        stopReason: 'toolUse',
      }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const start = events.find((e) => e.type === 'tool_call.start')
    expect(start).toMatchObject({ type: 'tool_call.start', id: 'tc_42', name: 'search' })
  })

  it('toolcall_delta → tool_call.delta 透传 args chunk', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxToolCall('search', { q: 'cats' }, { id: 'tc_42' })], {
        stopReason: 'toolUse',
      }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const delta = events.find((e) => e.type === 'tool_call.delta')
    expect(delta).toBeDefined()
    expect(delta).toMatchObject({ type: 'tool_call.delta', id: 'tc_42' })
    expect((delta as { argsChunk: string }).argsChunk).toContain('cats')
  })

  it('toolcall_end → tool_call.end matches start id', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxToolCall('search', { q: 'x' }, { id: 'tc_xyz' })], {
        stopReason: 'toolUse',
      }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const end = events.find((e) => e.type === 'tool_call.end')
    expect(end).toMatchObject({ type: 'tool_call.end', id: 'tc_xyz' })
  })

  it('多个 tool call 同时存在时分别 emit start/delta/end', async () => {
    faux!.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('toolA', { a: 1 }, { id: 'tc_a' }),
          fauxToolCall('toolB', { b: 2 }, { id: 'tc_b' }),
        ],
        { stopReason: 'toolUse' },
      ),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const startIds = events
      .filter((e): e is { type: 'tool_call.start'; id: string; name: string } =>
        e.type === 'tool_call.start',
      )
      .map((e) => e.id)
    expect(startIds).toContain('tc_a')
    expect(startIds).toContain('tc_b')
    const endIds = events
      .filter((e): e is { type: 'tool_call.end'; id: string } => e.type === 'tool_call.end')
      .map((e) => e.id)
    expect(endIds).toContain('tc_a')
    expect(endIds).toContain('tc_b')
  })

  it('tool call 顺序：start before delta before end', async () => {
    faux!.setResponses([
      fauxAssistantMessage([fauxToolCall('foo', { x: 1 }, { id: 'tc_1' })], {
        stopReason: 'toolUse',
      }),
    ])
    const events = await collectEvents({ messages: [userText('hi')] })
    const toolEvents = events.filter(
      (e) =>
        e.type === 'tool_call.start' ||
        e.type === 'tool_call.delta' ||
        e.type === 'tool_call.end',
    )
    expect(toolEvents[0]!.type).toBe('tool_call.start')
    expect(toolEvents[toolEvents.length - 1]!.type).toBe('tool_call.end')
  })
})

describe('createPiAiAdapter — usage / cost / cache.hit 透传', () => {
  it('finish 带 usage.input + usage.output', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('hi')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    const finish = events.find((e) => e.type === 'finish')
    expect(finish).toBeDefined()
    expect((finish as { usage: { input: number; output: number } }).usage.input).toBeGreaterThanOrEqual(0)
    expect((finish as { usage: { input: number; output: number } }).usage.output).toBeGreaterThanOrEqual(0)
  })

  it('cacheRead = 0 时不 emit cache.hit', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('hi')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    expect(events.find((e) => e.type === 'cache.hit')).toBeUndefined()
  })

  it('cacheRead > 0 时 emit cache.hit + finish (cache.hit 先)', async () => {
    // faux provider 内部强制重置 usage（见 dist/providers/faux.js:140），无法
    // 在端到端流里注入定制 usage，所以这里通过 translatePiEvent 直接喂构造的
    // done 事件验证 done → cache.hit + finish 拆 2 个 event 的逻辑。
    const doneEvt = {
      type: 'done',
      reason: 'stop',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'cached' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 100,
          output: 5,
          cacheRead: 80,
          cacheWrite: 0,
          totalTokens: 185,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(doneEvt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: 'cache.hit', cachedTokens: 80, costTokens: 100 })
    expect(out[1]).toMatchObject({ type: 'finish', reason: 'stop' })
    expect((out[1] as { usage: { cached?: number } }).usage.cached).toBe(80)
  })

  it('translatePiEvent: done with cacheRead=0 不 emit cache.hit', async () => {
    const doneEvt = {
      type: 'done',
      reason: 'stop',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(doneEvt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out).toHaveLength(1)
    expect(out[0]!.type).toBe('finish')
  })

  it('translatePiEvent: 未知 stopReason fallback 到 stop', async () => {
    const doneEvt = {
      type: 'done',
      reason: 'someUnknownReason',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as unknown as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(doneEvt, new Map(), 'openai')) {
      out.push(e)
    }
    expect((out[0] as { reason: string }).reason).toBe('stop')
  })

  it('translatePiEvent: error event 翻译 + reason=error → code=unknown', async () => {
    const errEvt = {
      type: 'error',
      reason: 'error',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: 'upstream 500',
        timestamp: Date.now(),
      },
    } as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(errEvt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out[0]).toMatchObject({ type: 'error', code: 'unknown', message: 'upstream 500' })
  })

  it('translatePiEvent: error event with no errorMessage → fallback message', async () => {
    const errEvt = {
      type: 'error',
      reason: 'error',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        timestamp: Date.now(),
      },
    } as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(errEvt, new Map(), 'openai')) {
      out.push(e)
    }
    expect((out[0] as { message: string }).message).toBe('pi-ai stream error')
  })

  it('translatePiEvent: contentFilter / refusal stopReason → content_filter', async () => {
    for (const reason of ['contentFilter', 'refusal']) {
      const evt = {
        type: 'done',
        reason,
        message: {
          role: 'assistant',
          content: [],
          api: 'openai-completions',
          provider: 'openai',
          model: 'gpt-4o',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      } as unknown as AssistantMessageEvent
      const out: CanonicalEvent[] = []
      for await (const e of translatePiEvent(evt, new Map(), 'openai')) {
        out.push(e)
      }
      expect((out[0] as { reason: string }).reason).toBe('content_filter')
    }
  })

  it('usage.cached 仅在 cacheRead > 0 时填', async () => {
    faux!.setResponses([fauxAssistantMessage([fauxText('hi')])])
    const events = await collectEvents({ messages: [userText('hi')] })
    const finish = events.find((e) => e.type === 'finish')
    expect((finish as { usage: { cached?: number } }).usage.cached).toBeUndefined()
  })
})

describe('createPiAiAdapter — AbortSignal 透传', () => {
  it('中途 abort 触发 error event + aborted code', async () => {
    // 慢速 stream：tokensPerSecond 1，文本足够长 → 第一次 abort 才能命中
    faux?.unregister()
    faux = registerFauxProvider({ tokensPerSecond: 2, tokenSize: { min: 5, max: 5 } })
    __setModelResolverForTesting(() => faux!.getModel())
    faux.setResponses([
      fauxAssistantMessage([fauxText('a very long response that should be cancelled')]),
    ])

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)

    const events: CanonicalEvent[] = []
    for await (const evt of buildAdapter().streamChat(
      { messages: [userText('hi')] },
      controller.signal,
    )) {
      events.push(evt)
    }
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as { code: string }).code).toBe('aborted')
  })

  it('AbortSignal 取消后不再 yield 新事件', async () => {
    faux?.unregister()
    faux = registerFauxProvider({ tokensPerSecond: 2, tokenSize: { min: 5, max: 5 } })
    __setModelResolverForTesting(() => faux!.getModel())
    faux.setResponses([
      fauxAssistantMessage([fauxText('long response stream gets cancelled mid-flight')]),
    ])
    const controller = new AbortController()
    const events: CanonicalEvent[] = []
    setTimeout(() => controller.abort(), 30)
    for await (const evt of buildAdapter().streamChat(
      { messages: [userText('hi')] },
      controller.signal,
    )) {
      events.push(evt)
    }
    // 最后一个事件必须是 error（adapter 不会在 error 后继续 yield finish）
    expect(events[events.length - 1]!.type).toBe('error')
  })
})

describe('createPiAiAdapter — canonical request → pi-ai Context 翻译', () => {
  it('system message 拆出来作为 systemPrompt', async () => {
    let capturedSystem: string | undefined
    faux!.setResponses([
      (context) => {
        capturedSystem = context.systemPrompt
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'you are helpful' }] },
        userText('hi'),
      ],
    })
    expect(capturedSystem).toBe('you are helpful')
  })

  it('多条 system message 拼接成单 systemPrompt', async () => {
    let capturedSystem: string | undefined
    faux!.setResponses([
      (context) => {
        capturedSystem = context.systemPrompt
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'rule 1' }] },
        { role: 'system', content: [{ type: 'text', text: 'rule 2' }] },
        userText('hi'),
      ],
    })
    expect(capturedSystem).toBe('rule 1\nrule 2')
  })

  it('user message 带 image block 翻译为 pi-ai image content', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image', mediaType: 'image/png', dataBase64: 'fakebase64' },
          ],
        },
      ],
    })
    const userMsg = capturedMessages![0]
    expect(userMsg.role).toBe('user')
    const imageBlock = (userMsg.content as Array<{ type: string }>).find(
      (b) => b.type === 'image',
    ) as { mimeType: string; data: string } | undefined
    expect(imageBlock).toBeDefined()
    expect(imageBlock!.mimeType).toBe('image/png')
    expect(imageBlock!.data).toBe('fakebase64')
  })

  it('assistant message 带 thinking + tool_use blocks 翻译', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('please use the tool'),
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'I should use the tool' },
            { type: 'tool_use', id: 'tc_1', name: 'lookup', input: { q: 'foo' } },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tc_1',
              content: 'result here',
            },
          ],
        },
      ],
    })
    const assistantMsg = capturedMessages![1]
    expect(assistantMsg.role).toBe('assistant')
    const blocks = assistantMsg.content as Array<{ type: string }>
    expect(blocks.find((b) => b.type === 'thinking')).toBeDefined()
    expect(blocks.find((b) => b.type === 'toolCall')).toBeDefined()
  })

  it('tool message 翻译为 pi-ai toolResult role', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('q'),
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tc_x', name: 'search', input: {} }],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool_result', toolUseId: 'tc_x', content: 'search result' },
          ],
        },
      ],
    })
    const toolMsg = capturedMessages![2]
    expect(toolMsg.role).toBe('toolResult')
    expect((toolMsg as { toolCallId: string }).toolCallId).toBe('tc_x')
  })

  it('tool message with isError=true 透传 isError', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('q'),
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tc_x', name: 'search', input: {} }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tc_x',
              content: 'oops error',
              isError: true,
            },
          ],
        },
      ],
    })
    const toolMsg = capturedMessages![2]
    expect((toolMsg as { isError: boolean }).isError).toBe(true)
  })

  it('tools 字段透传到 pi-ai Context.tools', async () => {
    let capturedTools
    faux!.setResponses([
      (context) => {
        capturedTools = context.tools
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [userText('hi')],
      tools: [
        {
          name: 'mcp__svc__lookup',
          description: 'Lookup something',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    })
    expect(capturedTools).toHaveLength(1)
    expect(capturedTools![0]).toMatchObject({
      name: 'mcp__svc__lookup',
      description: 'Lookup something',
    })
  })

  it('canonical tool message 缺 tool_result block 抛错', async () => {
    const adapter = buildAdapter()
    const controller = new AbortController()
    await expect(async () => {
      for await (const _evt of adapter.streamChat(
        {
          messages: [
            {
              role: 'tool',
              content: [{ type: 'text', text: 'not a tool_result' }],
            },
          ],
        },
        controller.signal,
      )) {
        // drain
      }
    }).rejects.toThrow(/tool_result block/)
  })
})

describe('createPiAiAdapter — LLMProvider interface', () => {
  it('id 取自 ProviderConfig.id', () => {
    const a = createPiAiAdapter({ id: 'openai', apiKey: 'k' })
    expect(a.id).toBe('openai')
  })

  it('family = openai-compatible for openai / zhipu / deepseek / moonshot / qwen', () => {
    for (const id of ['openai', 'zhipu', 'deepseek', 'moonshot', 'qwen']) {
      expect(createPiAiAdapter({ id, apiKey: 'k' }).family).toBe('openai-compatible')
    }
  })

  it('family = anthropic for anthropic', () => {
    expect(createPiAiAdapter({ id: 'anthropic', apiKey: 'k' }).family).toBe('anthropic')
  })

  it('family = gemini for gemini', () => {
    expect(createPiAiAdapter({ id: 'gemini', apiKey: 'k' }).family).toBe('gemini')
  })
})

describe('translatePiAiError', () => {
  it('non-Error 输入 → code=unknown', () => {
    const err = translatePiAiError('plain string', 'openai')
    expect(err).toBeInstanceOf(LLMError)
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
    expect(err.provider).toBe('openai')
  })

  it('AbortError name → code=unknown, retryable=false', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    const err = translatePiAiError(e, 'openai')
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
  })

  it('status 401 → code=auth', () => {
    const e = Object.assign(new Error('Unauthorized'), { status: 401 })
    expect(translatePiAiError(e, 'openai').code).toBe('auth')
  })

  it('status 403 → code=auth', () => {
    const e = Object.assign(new Error('Forbidden'), { status: 403 })
    expect(translatePiAiError(e, 'openai').code).toBe('auth')
  })

  it('message "invalid api key" → code=auth (status-less)', () => {
    const e = new Error('invalid api key')
    expect(translatePiAiError(e, 'openai').code).toBe('auth')
  })

  it('status 429 → code=rate_limit, retryable=true', () => {
    const e = Object.assign(new Error('Rate limit exceeded'), { status: 429 })
    const err = translatePiAiError(e, 'openai')
    expect(err.code).toBe('rate_limit')
    expect(err.retryable).toBe(true)
  })

  it('message "rate limit" → code=rate_limit', () => {
    const e = new Error('rate limit hit')
    expect(translatePiAiError(e, 'openai').code).toBe('rate_limit')
  })

  it('status 400 + context window msg → code=context_too_long', () => {
    const e = Object.assign(new Error('context window exceeded'), { status: 400 })
    expect(translatePiAiError(e, 'openai').code).toBe('context_too_long')
  })

  it('status 400 普通 → code=invalid_request', () => {
    const e = Object.assign(new Error('Bad request'), { status: 400 })
    expect(translatePiAiError(e, 'openai').code).toBe('invalid_request')
  })

  it('status 500 → code=network, retryable=true', () => {
    const e = Object.assign(new Error('Server error'), { status: 500 })
    const err = translatePiAiError(e, 'openai')
    expect(err.code).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('status 503 → code=network', () => {
    const e = Object.assign(new Error('Service unavailable'), { status: 503 })
    expect(translatePiAiError(e, 'openai').code).toBe('network')
  })

  it('message "fetch failed" → code=network', () => {
    const e = new Error('fetch failed')
    expect(translatePiAiError(e, 'openai').code).toBe('network')
  })

  it('message "ECONNREFUSED" → code=network', () => {
    const e = new Error('connect ECONNREFUSED 127.0.0.1:80')
    expect(translatePiAiError(e, 'openai').code).toBe('network')
  })

  it('其他 Error → code=unknown', () => {
    const e = new Error('something weird happened')
    expect(translatePiAiError(e, 'openai').code).toBe('unknown')
  })

  it('provider 字段透传', () => {
    expect(translatePiAiError(new Error('x'), 'anthropic').provider).toBe('anthropic')
    expect(translatePiAiError(new Error('x'), 'gemini').provider).toBe('gemini')
  })

  it('cause 字段保留原始 error', () => {
    const e = new Error('original')
    const err = translatePiAiError(e, 'openai')
    expect(err.cause).toBe(e)
  })
})

describe('createPiAiAdapter — defensive block translation paths', () => {
  it('user message 内嵌入 thinking / tool_use / tool_result 被丢弃（只保留 text+image）', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'q' },
            { type: 'thinking', text: 'should be dropped' },
            { type: 'tool_use', id: 'x', name: 'y', input: {} },
            {
              type: 'tool_result',
              toolUseId: 'x',
              content: 'should be dropped',
            },
          ],
        },
      ],
    })
    const blocks = (capturedMessages![0].content as Array<{ type: string }>) ?? []
    // text 保留，其他 3 个被 filter null 丢弃
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('assistant message 内嵌入 image / tool_result 被丢弃', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('q'),
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'reply' },
            { type: 'image', mediaType: 'image/png', dataBase64: 'x' },
            { type: 'tool_result', toolUseId: 'x', content: 'should drop' },
          ],
        },
      ],
    })
    const blocks = (capturedMessages![1].content as Array<{ type: string }>) ?? []
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('tool_use block 缺 input 默认为 {}', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('q'),
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tc_y', name: 'foo', input: null as unknown },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolUseId: 'tc_y', content: 'r' }],
        },
      ],
    })
    const toolCall = (capturedMessages![1].content as Array<{ type: string; arguments?: unknown }>).find(
      (b) => b.type === 'toolCall',
    )
    expect(toolCall?.arguments).toEqual({})
  })

  it('tool_result content 是 Block[] 时翻译每个 block', async () => {
    let capturedMessages
    faux!.setResponses([
      (context) => {
        capturedMessages = context.messages
        return fauxAssistantMessage([fauxText('ok')])
      },
    ])
    await collectEvents({
      messages: [
        userText('q'),
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tc_z', name: 'foo', input: {} }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tc_z',
              content: [
                { type: 'text', text: 'result text' },
                { type: 'image', mediaType: 'image/jpeg', dataBase64: 'b64' },
              ],
            },
          ],
        },
      ],
    })
    const toolMsg = capturedMessages![2] as { content: Array<{ type: string }> }
    expect(toolMsg.content).toHaveLength(2)
    expect(toolMsg.content[0].type).toBe('text')
    expect(toolMsg.content[1].type).toBe('image')
  })
})

describe('translatePiEvent — 边界路径', () => {
  it('toolcall_start 缺 partial.content[ci] 静默 drop', async () => {
    const evt = {
      type: 'toolcall_start',
      contentIndex: 0,
      partial: { content: [] },
    } as unknown as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(evt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out).toHaveLength(0)
  })

  it('toolcall_delta 未在 state 中记录的 ci 静默 drop', async () => {
    const evt = {
      type: 'toolcall_delta',
      contentIndex: 99,
      delta: '{"x":1}',
    } as unknown as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(evt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out).toHaveLength(0)
  })

  it('toolcall_end 缺 state 也缺 evt.toolCall.id 时静默 drop', async () => {
    const evt = {
      type: 'toolcall_end',
      contentIndex: 99,
    } as unknown as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(evt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out).toHaveLength(0)
  })

  it('error event with reason=aborted → code=aborted', async () => {
    const evt = {
      type: 'error',
      reason: 'aborted',
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'aborted',
        errorMessage: 'Request was aborted',
        timestamp: Date.now(),
      },
    } as AssistantMessageEvent
    const out: CanonicalEvent[] = []
    for await (const e of translatePiEvent(evt, new Map(), 'openai')) {
      out.push(e)
    }
    expect(out[0]).toMatchObject({ type: 'error', code: 'aborted' })
  })
})

describe('createPiAiAdapter — resolver 抛错路径', () => {
  it('resolver 抛错被 translatePiAiError 包装', async () => {
    __setModelResolverForTesting(() => {
      throw new Error('model not found in registry')
    })
    const adapter = buildAdapter('openai')
    const controller = new AbortController()
    await expect(async () => {
      for await (const _evt of adapter.streamChat(
        { messages: [userText('hi')] },
        controller.signal,
      )) {
        // drain
      }
    }).rejects.toBeInstanceOf(LLMError)
  })
})
