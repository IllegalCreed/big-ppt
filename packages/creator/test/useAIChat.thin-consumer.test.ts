/**
 * Phase 12.7 Task G：useAIChat thin canonical event consumer 单测。
 *
 * - mock `chatTurn` 返 fake ReadableStream（encodeSSEFrame 出 canonical event 序列）
 * - 验状态机：idle → sending → streaming → idle/error
 * - 验 13 类 canonical event 各自正确驱动 streamingContent / thinkingContent /
 *   currentToolExecutions / lastUsage / lastTurnId
 * - 验 AbortError 静默回 idle；非 abort 错走 error 终态
 * - 验 turn.end 后调 listChats 刷新历史
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { encodeSSEFrame, type CanonicalEvent } from '@big-ppt/shared'
import { DECK_CHAT_CONTEXT, useAIChat, type UseAIChatReturn } from '../src/composables/useAIChat'

// useSlideStore + useDecks 都 mock 掉避免真 API
const setPageMock = vi.fn()
const refreshMock = vi.fn()
const setAIBusyMock = vi.fn()
vi.mock('../src/composables/useSlideStore', () => ({
  useSlideStore: () => ({
    setAIBusy: setAIBusyMock,
    setPage: setPageMock,
    refresh: refreshMock,
  }),
}))

const listChatsMock = vi.fn()
vi.mock('../src/composables/useDecks', () => ({
  useDecks: () => ({
    listChats: listChatsMock,
  }),
}))

// chatTurn mock: 默认每个 test 在 it 内通过 mockResolvedValueOnce 配置
const chatTurnMock = vi.fn()
vi.mock('../src/api/chat', () => ({
  chatTurn: (...args: unknown[]) => chatTurnMock(...args),
}))

// Phase 12.7-G fix：useGenerateImageJob mock，记录 start() 调到的 jobId
// Phase 12.7 dogfood 二次修正:useAIChat 现在 watch 实例的 stage/progressRatio/info refs
// + 在 clearHistory 调 instance.abort(),mock 需要给出完整接口。
//
// dogfood 三连击补测:把每次 useGenerateImageJob() 创建的 refs 暴露给当前 test
// 通过 imageJobInstances 拿到引用,从外部驱动 stage/progressRatio 模拟 worker 进度
// (verify auto-prune / errorMsg 流转必须从外部喂数据,顶层 mock 共用 refs 不够用)。
import type { Ref, ShallowRef } from 'vue'
import type { ImageJobState, ImageJobInfo } from '../src/composables/useDecks'
const imageJobStartMock = vi.fn()
const imageJobAbortMock = vi.fn()
type ImageJobInstanceHandle = {
  stage: Ref<ImageJobState>
  progressRatio: Ref<number>
  error: Ref<string | null>
  info: ShallowRef<ImageJobInfo | null>
  result: ShallowRef<ImageJobInfo | null>
  running: Ref<boolean>
  start: typeof imageJobStartMock
  abort: typeof imageJobAbortMock
  cancel: () => void
}
const imageJobInstances: ImageJobInstanceHandle[] = []
vi.mock('../src/composables/useGenerateImageJob', async () => {
  const { ref, shallowRef } = await import('vue')
  return {
    useGenerateImageJob: () => {
      const inst: ImageJobInstanceHandle = {
        stage: ref<ImageJobState>('pending'),
        progressRatio: ref(0),
        error: ref<string | null>(null),
        info: shallowRef<ImageJobInfo | null>(null),
        result: shallowRef<ImageJobInfo | null>(null),
        running: ref(false),
        start: imageJobStartMock,
        abort: imageJobAbortMock,
        cancel: vi.fn(),
      }
      imageJobInstances.push(inst)
      return inst
    },
  }
})

function makeSSEResponse(events: CanonicalEvent[]): Response {
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

/** 用 Vue test-utils 在一个 host 里 provide DECK_CHAT_CONTEXT 后 useAIChat。 */
function setupChat(deckId = 7) {
  const box: { chat: UseAIChatReturn | null } = { chat: null }
  // 两层组件：父 provide，子 inject + useAIChat。同组件内 provide 不能被自己 inject。
  const Child = defineComponent({
    setup() {
      box.chat = useAIChat()
      return () => h('div')
    },
  })
  const Host = defineComponent({
    components: { Child },
    setup() {
      provide(DECK_CHAT_CONTEXT, {
        deckId,
        templateId: 'beitou-standard',
        initialHistory: [],
      })
      return () => h(Child)
    },
  })
  const wrapper = mount(Host)
  if (!box.chat) throw new Error('useAIChat not captured')
  return { chat: box.chat, wrapper }
}

describe('useAIChat (thin consumer)', () => {
  beforeEach(() => {
    chatTurnMock.mockReset()
    listChatsMock.mockReset()
    listChatsMock.mockResolvedValue([]) // 默认空，单 test 内可覆盖
    setPageMock.mockReset()
    refreshMock.mockReset()
    setAIBusyMock.mockReset()
    imageJobStartMock.mockReset()
    imageJobStartMock.mockResolvedValue({ state: 'done', slideIndex: 1, assetId: 'a1' })
    imageJobAbortMock.mockReset()
    imageJobInstances.length = 0
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('初始状态：status=idle、所有 ref 为空/null', () => {
    const { chat } = setupChat()
    expect(chat.status.value).toBe('idle')
    expect(chat.streamingContent.value).toBe('')
    expect(chat.thinkingContent.value).toBe('')
    expect(chat.lastUsage.value).toBeNull()
    expect(chat.lastTurnId.value).toBeNull()
    expect(chat.currentToolExecutions.value.size).toBe(0)
    expect(chat.chatMessages.value).toEqual([])
    expect(chat.isGenerating.value).toBe(false)
  })

  it('sendMessage 成功路径：累积 text.delta + 设 lastUsage + 刷历史 → idle', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'turn.start', turnId: 'turn-1' },
        { type: 'text.delta', text: 'Hello' },
        { type: 'text.delta', text: ', world' },
        { type: 'turn.end', usage: { input: 10, output: 5 }, reason: 'stop' },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello, world' },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('hi')
    await flushPromises()

    expect(chatTurnMock).toHaveBeenCalledWith(
      { deckId: 7, message: 'hi' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(chat.status.value).toBe('idle')
    expect(chat.lastTurnId.value).toBe('turn-1')
    expect(chat.lastUsage.value).toEqual({ input: 10, output: 5 })
    // streaming 缓冲在 turn.end 后被清空，避免和 history 气泡重复
    expect(chat.streamingContent.value).toBe('')
    expect(chat.chatMessages.value).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello, world' },
    ])
    expect(listChatsMock).toHaveBeenCalledWith(7)
    expect(refreshMock).toHaveBeenCalled()
  })

  it('thinking.delta 累积到 thinkingContent，turn.end 后清空', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'thinking.delta', text: 'Let me think...\n' },
        { type: 'thinking.delta', text: 'Answer is 42.\n' },
        { type: 'text.delta', text: '42' },
        { type: 'turn.end', usage: { input: 5, output: 1 }, reason: 'stop' },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([{ role: 'assistant', content: '42' }])

    const { chat } = setupChat()
    await chat.sendMessage('what?')
    await flushPromises()

    // turn.end 后清空 thinkingContent
    expect(chat.thinkingContent.value).toBe('')
    expect(chat.status.value).toBe('idle')
  })

  it('tool_execution.start → state=running 出现在 Map', async () => {
    let resolveStream: (() => void) | null = null
    const events: CanonicalEvent[] = [
      { type: 'turn.start', turnId: 't1' },
      { type: 'tool_execution.start', toolCallId: 'tc-1', toolName: 'read_slides' },
    ]
    // 用半开 stream 让 sendMessage 在 tool_execution.start 后挂起
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(encodeSSEFrame(e)))
        resolveStream = () => {
          controller.enqueue(
            encoder.encode(
              encodeSSEFrame({ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }),
            ),
          )
          controller.close()
        }
      },
    })
    chatTurnMock.mockResolvedValueOnce(new Response(stream, { status: 200 }))
    listChatsMock.mockResolvedValueOnce([])

    const { chat } = setupChat()
    const promise = chat.sendMessage('go')

    // 等 tool_execution.start 被消费
    await new Promise((r) => setTimeout(r, 20))
    expect(chat.currentToolExecutions.value.size).toBe(1)
    expect(chat.currentToolExecutions.value.get('tc-1')).toEqual({
      toolName: 'read_slides',
      state: 'running',
    })

    // 收尾 stream
    resolveStream?.()
    await promise
    await flushPromises()
  })

  it('tool_execution.end isError=false → state 转 done', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'tool_execution.start', toolCallId: 'a', toolName: 'foo' },
        { type: 'tool_execution.end', toolCallId: 'a', isError: false },
        { type: 'tool_execution.start', toolCallId: 'b', toolName: 'bar' },
        { type: 'tool_execution.end', toolCallId: 'b', isError: true },
        { type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([])

    const { chat } = setupChat()

    // 在流式途中挂个 watcher 抓 done / error 中间态——简化版：sendMessage await 完成后
    // currentToolExecutions 会被 finally 清空，所以这条断言要在流式期间。
    // 用一个挂起 stream 拿到中间态。
    // 实际上我们让 stream 跑完，验 finally 已清 Map，这里跑无挂起版做断言：
    await chat.sendMessage('x')
    await flushPromises()

    // turn.end 后 finally 清空 currentToolExecutions
    expect(chat.currentToolExecutions.value.size).toBe(0)
  })

  it('tool_execution 中间状态：start→end isError=false→done；start→end isError=true→error', async () => {
    // 用半开 stream 捕获 done / error 中间态
    const encoder = new TextEncoder()
    let push: (evt: CanonicalEvent) => void = () => {}
    let close: () => void = () => {}
    const stream = new ReadableStream({
      start(controller) {
        push = (evt) => controller.enqueue(encoder.encode(encodeSSEFrame(evt)))
        close = () => controller.close()
      },
    })
    chatTurnMock.mockResolvedValueOnce(new Response(stream, { status: 200 }))
    listChatsMock.mockResolvedValueOnce([])

    const { chat } = setupChat()
    const promise = chat.sendMessage('x')

    push({ type: 'tool_execution.start', toolCallId: 'a', toolName: 'foo' })
    await new Promise((r) => setTimeout(r, 10))
    expect(chat.currentToolExecutions.value.get('a')?.state).toBe('running')

    push({ type: 'tool_execution.end', toolCallId: 'a', isError: false })
    await new Promise((r) => setTimeout(r, 10))
    expect(chat.currentToolExecutions.value.get('a')?.state).toBe('done')

    push({ type: 'tool_execution.start', toolCallId: 'b', toolName: 'bar' })
    push({ type: 'tool_execution.end', toolCallId: 'b', isError: true })
    await new Promise((r) => setTimeout(r, 10))
    expect(chat.currentToolExecutions.value.get('b')?.state).toBe('error')

    push({ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' })
    close()
    await promise
    await flushPromises()
  })

  it('cancel() abort fetch，status=idle 静默回 idle', async () => {
    let aborted = false
    chatTurnMock.mockImplementationOnce(async (_req: unknown, opts: { signal?: AbortSignal }) => {
      // 让 stream 挂起，等到 abort
      return new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          aborted = true
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })
    listChatsMock.mockResolvedValueOnce([])

    const { chat } = setupChat()
    const promise = chat.sendMessage('hang')
    await new Promise((r) => setTimeout(r, 10))
    chat.cancel()
    await promise
    await flushPromises()

    expect(aborted).toBe(true)
    expect(chat.status.value).toBe('idle')
  })

  it('dispose() abort 当前请求并跳过卸载后的 refresh', async () => {
    let aborted = false
    chatTurnMock.mockImplementationOnce(async (_req: unknown, opts: { signal?: AbortSignal }) => {
      return new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          aborted = true
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    })

    const { chat } = setupChat()
    const promise = chat.sendMessage('hang')
    await new Promise((r) => setTimeout(r, 10))
    chat.dispose()
    await promise
    await flushPromises()

    expect(aborted).toBe(true)
    expect(chat.status.value).toBe('idle')
    expect(chat.chatMessages.value).toEqual([])
    expect(listChatsMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('非 abort 错误：status=error + statusText 含错误信息', async () => {
    chatTurnMock.mockRejectedValueOnce(new Error('upstream 500'))
    listChatsMock.mockResolvedValueOnce([])
    const { chat } = setupChat()
    await chat.sendMessage('boom')
    await flushPromises()

    expect(chat.status.value).toBe('error')
    expect(chat.statusText.value).toContain('upstream 500')
  })

  it('stream 内 error event → status=error', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'text.delta', text: 'partial' },
        { type: 'error', code: 'rate_limit', message: 'Too many requests' },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([])
    const { chat } = setupChat()
    await chat.sendMessage('test')
    await flushPromises()
    expect(chat.status.value).toBe('error')
    expect(chat.statusText.value).toContain('rate_limit')
  })

  it('finish event 兼容（非 agent 路径）：lastUsage 写入', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'text.delta', text: 'ok' },
        { type: 'finish', reason: 'stop', usage: { input: 3, output: 1 } },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([])
    const { chat } = setupChat()
    await chat.sendMessage('hi')
    await flushPromises()
    expect(chat.lastUsage.value).toEqual({ input: 3, output: 1 })
    expect(chat.status.value).toBe('idle')
  })

  it('clearHistory() 清空所有状态', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'text.delta', text: 'hello' },
        { type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' },
      ]),
    )
    listChatsMock.mockResolvedValueOnce([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }])
    const { chat } = setupChat()
    await chat.sendMessage('hi')
    await flushPromises()
    expect(chat.chatMessages.value.length).toBeGreaterThan(0)

    chat.clearHistory()
    expect(chat.chatMessages.value).toEqual([])
    expect(chat.lastUsage.value).toBeNull()
    expect(chat.lastTurnId.value).toBeNull()
    expect(chat.status.value).toBe('idle')
  })

  it('appendLocalMessage 仅添加到 chatMessages 不发 LLM', () => {
    const { chat } = setupChat()
    chat.appendLocalMessage('本地提示')
    expect(chat.chatMessages.value).toEqual([{ role: 'assistant', content: '本地提示' }])
    expect(chatTurnMock).not.toHaveBeenCalled()
  })

  it('retryLastUserMessage 找最后一条 user 消息重发；无则提示', async () => {
    chatTurnMock.mockResolvedValue(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValue([])
    const { chat } = setupChat()

    // 空状态调 retry → 提示无可重试
    chat.retryLastUserMessage()
    await nextTick()
    expect(chat.chatMessages.value).toEqual([{ role: 'assistant', content: '没有可重试的用户消息。' }])
    expect(chatTurnMock).not.toHaveBeenCalled()

    // 加一条 user 后 retry → 触发 sendMessage
    chat.appendLocalMessage('') // 让 chatMessages 有非空
    chat.chatMessages.value.push({ role: 'user', content: '帮我做幻灯片' })
    chat.retryLastUserMessage()
    await flushPromises()
    expect(chatTurnMock).toHaveBeenCalledWith(
      { deckId: 7, message: '帮我做幻灯片' },
      expect.any(Object),
    )
  })

  // Phase 12.7-G code review M-3：retry 守护从 status !== 'idle' 改成
  // sending/streaming 拒绝,允许 error 终态重试(用户最常见 /retry 场景)。
  it('retryLastUserMessage 在 error 状态下也能重试（M-3）', async () => {
    // 第一次失败 → status='error'
    chatTurnMock.mockRejectedValueOnce(new Error('upstream 500'))
    // 第二次（retry）成功
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    // listChats 在 failed turn 后仍会被 backend 写入 user 行(persistTurnToDeckChats
    // 在 agent_end 即使错也照样落 user message),mock 模拟之
    listChatsMock.mockResolvedValue([
      { id: 1, deckId: 7, role: 'user', content: 'first try', toolCallId: null, createdAt: 't1' },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('first try')
    await flushPromises()
    expect(chat.status.value).toBe('error')
    expect(chatTurnMock).toHaveBeenCalledTimes(1)
    // chatMessages 包含 user "first try"(refresh 后 backend 视图)
    expect(chat.chatMessages.value.some((m) => m.role === 'user' && m.content === 'first try')).toBe(true)

    // error 终态 retry：旧守护会 silent return,新守护放行
    chat.retryLastUserMessage()
    await flushPromises()
    expect(chatTurnMock).toHaveBeenCalledTimes(2)
    expect(chatTurnMock).toHaveBeenLastCalledWith(
      { deckId: 7, message: 'first try' },
      expect.any(Object),
    )
    expect(chat.status.value).toBe('idle')
  })

  it('sendMessage 重入保护：sending/streaming 期间再调直接返回', async () => {
    let resolveFirst: (r: Response) => void = () => {}
    chatTurnMock.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          resolveFirst = res
        }),
    )
    listChatsMock.mockResolvedValue([])
    const { chat } = setupChat()
    const first = chat.sendMessage('one')
    await nextTick()
    expect(chat.status.value).toBe('sending')

    // 再发一条：应该直接 return（不调 chatTurn）
    await chat.sendMessage('two')
    expect(chatTurnMock).toHaveBeenCalledTimes(1)

    resolveFirst(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    await first
    await flushPromises()
  })

  it('用户 user message 即刻 echo 到 chatMessages（不等 backend round-trip）', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([])

    const { chat } = setupChat()
    const promise = chat.sendMessage('hi')
    // status 已经变 sending，user echo 已入数组
    expect(chat.chatMessages.value).toEqual([{ role: 'user', content: 'hi' }])
    await promise
    await flushPromises()
  })

  // Phase 12.7-G code review fix：异步 image-gen polling 回桥
  it('refresh 后扫 tool 行 generate_slide_image jobId 启 image-job polling', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      { id: 1, deckId: 7, role: 'user', content: '生成图片', toolCallId: null, createdAt: 't1' },
      {
        id: 2,
        deckId: 7,
        role: 'assistant',
        content: '好的',
        toolCallId: null,
        createdAt: 't2',
      },
      {
        id: 3,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'img-job-abc' }),
        toolCallId: 'tc-1',
        createdAt: 't3',
      },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('生成图片')
    await flushPromises()

    expect(imageJobStartMock).toHaveBeenCalledWith({ jobId: 'img-job-abc' })
    expect(imageJobStartMock).toHaveBeenCalledTimes(1)
  })

  it('已 track 过的 jobId 不重复 start（多 turn 累积去重）', async () => {
    chatTurnMock.mockResolvedValue(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValue([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'img-1' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('a')
    await flushPromises()
    await chat.sendMessage('b')
    await flushPromises()

    // 两次 refresh 都见到 img-1，但只 start 一次
    expect(imageJobStartMock).toHaveBeenCalledTimes(1)
  })

  it('tool 行 success=false 不 start polling（job 创建失败 / 工具其他错）', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: false, error: 'quota exceeded' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('try')
    await flushPromises()
    expect(imageJobStartMock).not.toHaveBeenCalled()
  })

  it('tool 行 content 不是 JSON / 无 jobId 字段：silent skip', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: 'plain text result, not JSON',
        toolCallId: 'tc',
        createdAt: 't',
      },
      {
        id: 2,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, slides: 5 }),
        toolCallId: 'tc2',
        createdAt: 't2',
      },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('read')
    await flushPromises()
    expect(imageJobStartMock).not.toHaveBeenCalled()
  })

  it('clearHistory 清空 trackedImageJobIds → 同 jobId 再出现时重新 start', async () => {
    chatTurnMock.mockResolvedValue(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValue([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'job-reusable' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])
    const { chat } = setupChat()
    await chat.sendMessage('a')
    await flushPromises()
    expect(imageJobStartMock).toHaveBeenCalledTimes(1)

    chat.clearHistory()
    await chat.sendMessage('b')
    await flushPromises()
    // clearHistory 清掉 dedup 集后,同 jobId 应再 track 一次
    expect(imageJobStartMock).toHaveBeenCalledTimes(2)
  })

  // ─────────────────────────────────────────────────────────────
  // Phase 12.7 dogfood 补测 1:handleRunFailure 路径
  //
  // 背景(commit 9da0ed0):pi-agent-core handleRunFailure 把 LLM 抛错包装成
  // agent_end + 一条 role:'assistant' 含 errorMessage 字段的 failureMessage,
  // **不发独立 error event**。Task D translateAgentStream 已修:扫
  // agent_end.messages 提 errorMessage 后 yield canonical error event,
  // 紧跟着照常 yield turn.end。
  //
  // 这里测的是 **frontend useAIChat consumer 角度**:error event 落地后:
  // - status='error'
  // - statusText 含 errorMessage
  // - 仍走 turn.end 路径(refresh / 清缓冲)? —— 实际上 consumeEvent
  //   遇到 error throw → for-await 中断 → 走 catch 分支(status='error'),
  //   finally 仍 refreshFromBackend + 清缓冲。
  // ─────────────────────────────────────────────────────────────
  it('handleRunFailure 路径:error event 后再 turn.end → status=error 且 refresh 已跑', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([
        { type: 'turn.start', turnId: 't-fail' },
        { type: 'text.delta', text: '部分输出' },
        {
          type: 'error',
          code: 'agent_run_failed',
          message: 'API key missing for openai-compatible',
        },
        // translateAgentStream 在 error 后照常 yield turn.end;但 consumer 在 error
        // 处 throw,不会走到 turn.end —— for-await 中断
        { type: 'turn.end', usage: { input: 0, output: 0 }, reason: 'stop' },
      ]),
    )
    // refresh 仍跑(finally 不依赖 catch),返当前 deck_chats 视图
    listChatsMock.mockResolvedValueOnce([
      { id: 1, deckId: 7, role: 'user', content: '触发失败', toolCallId: null, createdAt: 't1' },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('触发失败')
    await flushPromises()

    expect(chat.status.value).toBe('error')
    expect(chat.statusText.value).toContain('agent_run_failed')
    expect(chat.statusText.value).toContain('API key missing for openai-compatible')
    // streaming 缓冲在 finally 被清(避免和 history 重复)
    expect(chat.streamingContent.value).toBe('')
    // finally 仍跑 refreshFromBackend
    expect(listChatsMock).toHaveBeenCalledWith(7)
    // user 气泡保留(refresh 后从 backend 拿到)
    expect(chat.chatMessages.value.some((m) => m.role === 'user' && m.content === '触发失败')).toBe(
      true,
    )
  })

  // ─────────────────────────────────────────────────────────────
  // Phase 12.7 dogfood 补测 2:imageJobs auto-prune 跨 turn 持久 + 终态 5s 退场
  //
  // 背景(commit b01c6da):imageJobs Map 跨 turn 跨 bubble 汇总;每个 job
  // composable 实例的 stage / progressRatio / info / error refs 通过 watch
  // 同步回 Map;terminal 后保留 5s 让用户看到 ✅/❌ 终态再 auto-prune(避免
  // 「啪一下消失」)。
  //
  // 这里覆盖:
  // - 单 turn 触发 jobId → Map 立即有 entry,初始 stage='pending'
  // - 改 mock 内部 ref 模拟 worker 进度推进(pending → running → done)
  //   → Map 同步更新
  // - 终态 5s 后 auto-prune(用 vi.useFakeTimers fast-forward)
  // ─────────────────────────────────────────────────────────────
  it('imageJobs Map 跨 watcher 同步 stage / progressRatio / info;终态后 5s auto-prune', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'job-progress' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])
    // 模拟 worker 异步阻塞:start 不 resolve,让 case 通过 inst.stage 手工驱动
    let resolveStart: (v: { state: ImageJobState }) => void = () => {}
    imageJobStartMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveStart = res
        }),
    )

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { chat } = setupChat()
    await chat.sendMessage('生成图片')
    await flushPromises()

    // imageJobs Map 立即有 entry(pending),imageJobInstances 收到 1 个实例
    expect(chat.imageJobs.value.size).toBe(1)
    expect(imageJobInstances.length).toBe(1)
    const inst = imageJobInstances[0]!
    const initial = chat.imageJobs.value.get('job-progress')!
    expect(initial.stage).toBe('pending')
    expect(initial.progressRatio).toBe(0)

    // 通过 inst.stage / progressRatio / info 推进 → useAIChat 内 watch 同步回 Map
    inst.stage.value = 'running'
    inst.progressRatio.value = 0.5
    inst.info.value = {
      id: 'job-progress',
      state: 'running',
      slideIndex: 2,
      createdAt: 't',
    } as ImageJobInfo
    await flushPromises()
    const r = chat.imageJobs.value.get('job-progress')!
    expect(r.stage).toBe('running')
    expect(r.progressRatio).toBe(0.5)
    expect(r.slideIndex).toBe(2)

    // 推进到 done(terminal) → 立即不 prune(stopWatch 触发,排 5s timer)
    inst.stage.value = 'done'
    inst.progressRatio.value = 1
    await flushPromises()
    expect(chat.imageJobs.value.has('job-progress')).toBe(true)
    expect(chat.imageJobs.value.get('job-progress')!.stage).toBe('done')

    // fast-forward 5s → auto-prune
    vi.advanceTimersByTime(5_001)
    await flushPromises()
    expect(chat.imageJobs.value.has('job-progress')).toBe(false)

    // 清理:resolve 挂起的 start promise 让 fire-and-forget rejection 不污染
    resolveStart({ state: 'done' })
    vi.useRealTimers()
  })

  it('imageJobs:failed 终态 errorMsg 写进 Map,**不**自动 prune(留着等用户主动 dismiss)', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'job-fail' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { chat } = setupChat()
    await chat.sendMessage('生成失败的图')
    await flushPromises()

    expect(imageJobInstances.length).toBe(1)
    const inst = imageJobInstances[0]!

    // 推进到 failed + errorMsg(通过 watcher 路径,模拟真实 backend job failed 流程,
    // 不走 instance.start reject 路径 —— 那条路径在新逻辑下表示「backend 404」会清 Map)
    inst.stage.value = 'failed'
    inst.error.value = 'quota exceeded'
    await flushPromises()
    const r = chat.imageJobs.value.get('job-fail')!
    expect(r.stage).toBe('failed')
    expect(r.errorMsg).toBe('quota exceeded')

    // Phase 11.8 dogfood:failed 不自动 prune,让用户能看到第几页失败
    vi.advanceTimersByTime(10_000)
    await flushPromises()
    expect(chat.imageJobs.value.has('job-fail')).toBe(true)

    // 用户主动 dismiss 才清掉
    chat.dismissImageJob('job-fail')
    expect(chat.imageJobs.value.has('job-fail')).toBe(false)

    vi.useRealTimers()
  })

  it('imageJobs:instance.start reject(backend 404 / job 不存在)→ Map 立刻清掉 stale 占位', async () => {
    // 背景:agent 进程内存 jobs Map dev 重启后丢,老 jobId GET 返 404 → instance.start
    // reject → Map 应立刻清那条 stale "pending",防面板堆假记录
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'stale-old-job' }),
        toolCallId: 'tc',
        createdAt: 't',
      },
    ])
    imageJobStartMock.mockImplementationOnce(() => Promise.reject(new Error('job not found')))

    const { chat } = setupChat()
    await chat.sendMessage('触发拉历史')
    await flushPromises()
    // 给 catch 一个 microtask 跑
    await flushPromises()

    expect(chat.imageJobs.value.has('stale-old-job')).toBe(false)
  })

  it('clearHistory:abort 所有 image job composable 实例', async () => {
    chatTurnMock.mockResolvedValueOnce(
      makeSSEResponse([{ type: 'turn.end', usage: { input: 1, output: 1 }, reason: 'stop' }]),
    )
    listChatsMock.mockResolvedValueOnce([
      {
        id: 1,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'j1' }),
        toolCallId: 'tc1',
        createdAt: 't1',
      },
      {
        id: 2,
        deckId: 7,
        role: 'tool',
        content: JSON.stringify({ success: true, jobId: 'j2' }),
        toolCallId: 'tc2',
        createdAt: 't2',
      },
    ])

    const { chat } = setupChat()
    await chat.sendMessage('生成两张图')
    await flushPromises()
    expect(chat.imageJobs.value.size).toBe(2)
    expect(imageJobAbortMock).not.toHaveBeenCalled()

    chat.clearHistory()
    // 两个实例都被 abort
    expect(imageJobAbortMock).toHaveBeenCalledTimes(2)
    expect(chat.imageJobs.value.size).toBe(0)
  })
})
