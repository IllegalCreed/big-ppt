/**
 * Phase 12 Task I：多轮 tool call 完整循环 + canonical message 历史拼接测试。
 *
 * 用 MSW 拦 fetch（/api/auth/llm-settings、/api/tools、/api/llm/chat/completions、
 * /api/call-tool）模拟一次完整 user → tool_call → tool_result → tool_call → text
 * 的流程，验证：
 *
 * - canonical request body 形态正确（CanonicalChatRequest，含 messages + tools）
 * - 每轮 fetch 时 messages 历史按 canonical 形态拼接（system → user → assistant(tool_use) → tool → assistant(text)）
 * - tool result 入历史是 `{role:'tool', content:[{type:'tool_result',toolUseId,...}]}`
 * - 切换轮次时 chatMessages UI 气泡正确累积
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import { encodeSSEFrame, type CanonicalChatRequest, type CanonicalEvent } from '@big-ppt/shared'
import {
  __clearToolsCacheForTesting,
  invalidateLlmSettingsCache,
} from '../src/composables/useAIChat'

// Mock useSlideStore + useGenerateImageJob 避免拉真 store
vi.mock('../src/composables/useSlideStore', () => ({
  useSlideStore: () => ({
    setAIBusy: vi.fn(),
    setPage: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock('../src/composables/useGenerateImageJob', () => ({
  useGenerateImageJob: () => ({
    stage: ref('done'),
    start: vi.fn().mockResolvedValue({ state: 'done', slideIndex: 1, assetId: 'a1' }),
  }),
}))

// Mock buildSystemPrompt（避免拉 /api/system-prompt）
vi.mock('../src/prompts/buildSystemPrompt', () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue('SYSTEM_PROMPT_FIXTURE'),
}))

useMsw()

// crypto.randomUUID polyfill for test env
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` },
    writable: true,
  })
}

function buildSSEResponse(events: CanonicalEvent[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const evt of events) controller.enqueue(encoder.encode(encodeSSEFrame(evt)))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('useAIChat tool loop (canonical)', () => {
  beforeEach(() => {
    __clearToolsCacheForTesting()
    invalidateLlmSettingsCache()
    server.use(
      // 静默 logEvent 上报，避免 MSW onUnhandledRequest:error 噪音
      http.post('/api/log-event', () => HttpResponse.json({ success: true })),
      http.get('/api/auth/llm-settings', () =>
        HttpResponse.json({ provider: 'zhipu', model: 'GLM-5.1', hasApiKey: true }),
      ),
      http.get('/api/tools', () =>
        HttpResponse.json({
          success: true,
          tools: [
            {
              type: 'function',
              function: {
                name: 'read_slides',
                description: '读取当前 slides.md',
                parameters: { type: 'object', properties: {} },
              },
            },
            {
              type: 'function',
              function: {
                name: 'update_slide',
                description: '修改某页',
                parameters: {
                  type: 'object',
                  properties: { index: { type: 'number' }, body: { type: 'string' } },
                },
              },
            },
          ],
        }),
      ),
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  it('完整跑一轮：user → assistant(tool_use:read_slides) → tool → assistant(text)', async () => {
    const capturedRequests: CanonicalChatRequest[] = []
    const callToolBodies: unknown[] = []

    // /api/llm/chat/completions 第一次返 tool_use，第二次返 final text
    let llmCallCount = 0
    server.use(
      http.post('/api/llm/chat/completions', async ({ request }) => {
        const body = (await request.json()) as CanonicalChatRequest
        capturedRequests.push(body)
        llmCallCount++
        if (llmCallCount === 1) {
          return buildSSEResponse([
            { type: 'tool_call.start', id: 'c1', name: 'read_slides' },
            { type: 'tool_call.delta', id: 'c1', argsChunk: '{}' },
            { type: 'tool_call.end', id: 'c1' },
            { type: 'finish', reason: 'tool_use', usage: { input: 20, output: 5 } },
          ])
        }
        return buildSSEResponse([
          { type: 'text.delta', text: '当前有 3 页。' },
          { type: 'finish', reason: 'stop', usage: { input: 50, output: 8 } },
        ])
      }),
      http.post('/api/call-tool', async ({ request }) => {
        callToolBodies.push(await request.json())
        return HttpResponse.json({
          success: true,
          result: '{"slides":3,"title":"Test Deck"}',
        })
      }),
    )

    // 动态 import 让 vi.mock 生效（mock 必须在 import 前 register）
    const { useAIChat } = await import('../src/composables/useAIChat')
    const chat = useAIChat()
    await chat.sendMessage('当前几页？')

    // 两次 LLM 调用
    expect(llmCallCount).toBe(2)
    expect(callToolBodies).toHaveLength(1)
    expect(callToolBodies[0]).toMatchObject({
      name: 'read_slides',
      args: {},
    })

    // 第一次请求：messages = [system, user]
    const req1 = capturedRequests[0]!
    expect(req1.messages).toHaveLength(2)
    expect(req1.messages[0]).toMatchObject({
      role: 'system',
      content: [{ type: 'text', text: 'SYSTEM_PROMPT_FIXTURE' }],
    })
    expect(req1.messages[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: '当前几页？' }],
    })
    // tools 已被转成 canonical ToolDef[]
    expect(req1.tools).toEqual([
      {
        name: 'read_slides',
        description: '读取当前 slides.md',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'update_slide',
        description: '修改某页',
        inputSchema: {
          type: 'object',
          properties: { index: { type: 'number' }, body: { type: 'string' } },
        },
      },
    ])

    // 第二次请求：messages = [system, user, assistant(tool_use), tool(tool_result)]
    const req2 = capturedRequests[1]!
    expect(req2.messages).toHaveLength(4)
    expect(req2.messages[2]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'c1', name: 'read_slides', input: {} }],
    })
    expect(req2.messages[3]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'c1',
          content: '{"slides":3,"title":"Test Deck"}',
        },
      ],
    })

    // UI 气泡：user + assistant（最终 text）
    expect(chat.chatMessages.value).toHaveLength(2)
    expect(chat.chatMessages.value[0]).toMatchObject({ role: 'user', content: '当前几页？' })
    expect(chat.chatMessages.value[1]).toMatchObject({
      role: 'assistant',
      content: '当前有 3 页。',
    })
    // assistant bubble 上挂了 toolSteps 反映 tool 调用过程
    expect(chat.chatMessages.value[1]!.toolSteps).toBeDefined()
    expect(chat.chatMessages.value[1]!.toolSteps![0]).toMatchObject({
      name: 'read_slides',
      status: 'success',
    })

    // lastUsage / finishReason 取自最后一轮
    expect(chat.lastUsage.value).toEqual({ input: 50, output: 8 })
    expect(chat.finishReason.value).toBe('stop')
    // 没 cache.hit 事件，cacheStats 应保持初始 null
    expect(chat.lastCacheStats.value).toBeNull()
  })

  it('cache.hit 事件让 lastCacheStats 更新并写入 assistant bubble', async () => {
    server.use(
      http.post('/api/llm/chat/completions', () =>
        buildSSEResponse([
          { type: 'cache.hit', cachedTokens: 1024, costTokens: 128 },
          { type: 'text.delta', text: 'cached answer' },
          { type: 'finish', reason: 'stop', usage: { input: 1152, output: 5, cached: 1024 } },
        ]),
      ),
    )
    const { useAIChat } = await import('../src/composables/useAIChat')
    const chat = useAIChat()
    await chat.sendMessage('hi')

    expect(chat.lastCacheStats.value).toEqual({ cached: 1024, cost: 128 })
    expect(chat.chatMessages.value[1]!.cacheStats).toEqual({ cached: 1024, cost: 128 })
  })

  it('thinking event 同步累积到 thinkingContent + assistant bubble.thinking', async () => {
    server.use(
      http.post('/api/llm/chat/completions', () =>
        buildSSEResponse([
          { type: 'thinking.delta', text: 'Let me think...\n' },
          { type: 'thinking.delta', text: 'Answer is 42.\n' },
          { type: 'text.delta', text: '42' },
          { type: 'finish', reason: 'stop', usage: { input: 5, output: 1 } },
        ]),
      ),
    )
    const { useAIChat } = await import('../src/composables/useAIChat')
    const chat = useAIChat()
    await chat.sendMessage('what?')

    // 会话结束 thinkingContent 实时缓冲被清空（避免下次混入），但 bubble 上 thinking 保留
    expect(chat.thinkingContent.value).toBe('')
    expect(chat.chatMessages.value[1]).toMatchObject({
      role: 'assistant',
      content: '42',
      thinking: 'Let me think...\nAnswer is 42.\n',
    })
  })
})
