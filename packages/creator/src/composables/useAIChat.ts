/** Phase 12.7 Task G：thin canonical event consumer —— agent loop 由后端 pi-agent-core 接管。 */
import { computed, inject, ref, shallowRef, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import {
  decodeSSEStream,
  type CanonicalEvent,
  type ChatBubble,
  type TokenUsage,
} from '@big-ppt/shared'
import { chatTurn } from '../api/chat'
import { useDecks, type DeckChat } from './useDecks'
import { useSlideStore } from './useSlideStore'
import { useGenerateImageJob } from './useGenerateImageJob'

/**
 * DECK_CHAT_CONTEXT：DeckEditorCanvas provide 给下游 ChatPanel + useAIChat。
 *
 * Phase 12.7：删了 persistChat —— backend agent loop 的 agent_end subscribe
 * 已经把 turn 写入 deck_chats，frontend 通过 refreshChats 拉新历史回来即可。
 */
export type DeckChatContext = {
  /** Phase 10.5：deckId 由编辑器层注入；chatTurn 用它做 ownership + ALS activeDeckId。 */
  deckId: number
  templateId: string
  initialHistory: ChatBubble[]
}

export const DECK_CHAT_CONTEXT: InjectionKey<DeckChatContext> = Symbol('DECK_CHAT_CONTEXT')

/** Phase 12.7：useAIChat 公开的状态机 4 态 —— sending=发请求；streaming=收 event；error=异常终态。 */
export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error'

export type ToolExecutionStateName = 'pending' | 'running' | 'done' | 'error'

export interface ToolExecutionState {
  toolName: string
  state: ToolExecutionStateName
  argsPreview?: string
  resultPreview?: string
}

export interface UseAIChatReturn {
  /** ChatPanel 渲染的气泡数组（user / assistant）。turn.end 后从 backend refresh。 */
  chatMessages: Ref<ChatBubble[]>
  streamingContent: Ref<string>
  thinkingContent: Ref<string>
  lastUsage: Ref<TokenUsage | null>
  lastTurnId: Ref<string | null>
  currentToolExecutions: ShallowRef<Map<string, ToolExecutionState>>
  status: Ref<ChatStatus>
  statusText: ComputedRef<string>
  isGenerating: ComputedRef<boolean>
  sendMessage: (userText: string) => Promise<void>
  cancel: () => void
  clearHistory: () => void
  appendLocalMessage: (content: string) => void
  retryLastUserMessage: () => void
}

/**
 * Phase 12.7：thin canonical event consumer。
 *
 * - 不再跑 frontend tool loop（已移到 backend pi-agent-core，Task F 路由）
 * - 不再 POST /api/decks/:id/chats（backend agent_end subscribe 内部落库）
 * - 不再缓存 llm-settings / system prompt / tools list（agent 自维护）
 * - 仅消费 13 类 canonical event；turn.end 后 refreshChats 拿后端写好的历史
 */
export function useAIChat(): UseAIChatReturn {
  const deckCtx = inject(DECK_CHAT_CONTEXT, null)
  const slideStore = useSlideStore()
  const { listChats } = useDecks()

  const chatMessages = ref<ChatBubble[]>(deckCtx ? [...deckCtx.initialHistory] : [])
  const streamingContent = ref('')
  const thinkingContent = ref('')
  const lastUsage: Ref<TokenUsage | null> = ref(null)
  const lastTurnId: Ref<string | null> = ref(null)
  const currentToolExecutions = shallowRef<Map<string, ToolExecutionState>>(new Map())
  const status = ref<ChatStatus>('idle')
  const errorMessage = ref('')

  let abortController: AbortController | null = null

  /**
   * Phase 11.5 / Phase 12.7-G fix：异步 image-gen job 跟踪。
   *
   * 背景：`generate_slide_image` 工具同步只返 `{success, jobId}` —— backend
   * 把 tool_execution.end 报为 isError=false（工具入队成功），但实际图片
   * worker 异步还在跑。pi-agent-core 的 canonical tool_execution.end 不带
   * 工具 result 字段，故无法直接从 SSE 流提 jobId。
   *
   * 策略：每次 turn.end 后 listChats 拉全 deck_chats（含 tool 行）；扫所有
   * tool 行的 content（JSON），凡有 `jobId` 字段且未见过的，启 useGenerateImageJob
   * 轮询；done / fallback-rewrote 时 composable 内部已经 slideStore.refresh()
   * 把图片或兜底重写后的内容同步给 DeckRenderer。
   */
  const trackedImageJobIds = new Set<string>()

  const isGenerating = computed(() => status.value === 'sending' || status.value === 'streaming')

  const statusText = computed(() => {
    if (status.value === 'sending') return '正在思考...'
    if (status.value === 'streaming') {
      const running = [...currentToolExecutions.value.values()].find((s) => s.state === 'running')
      if (running) return `正在调用 ${running.toolName}...`
      return ''
    }
    if (status.value === 'error') return errorMessage.value || '出错了'
    return ''
  })

  /** turn.end 后从 backend 拉最新 deck_chats 写回 chatMessages（pi-agent-core 已写库）。 */
  async function refreshFromBackend(): Promise<void> {
    if (!deckCtx) return
    try {
      const chats = await listChats(deckCtx.deckId)
      chatMessages.value = chats
        .filter((c): c is typeof c & { role: 'user' | 'assistant' } => c.role === 'user' || c.role === 'assistant')
        .map((c) => ({ role: c.role, content: c.content }))
      kickOffPendingImageJobs(chats)
    } catch (err) {
      // refresh 失败不阻塞下一轮发送，仅 console（用户 reload 后能恢复）
      console.error('[useAIChat] refreshChats failed:', (err as Error).message)
    }
  }

  /**
   * Phase 12.7-G fix：从 deck_chats 的 tool 行 content 提 jobId，对未见过的
   * jobId 起异步轮询；done 后 useGenerateImageJob 内部已 slideStore.refresh()。
   *
   * 为什么不靠 SSE tool_execution.end 直接传 jobId：canonical event 当前签名
   * 不带 result content（plan 28 §canonical 13 类）；扩展事件 schema 影响
   * agent + shared + 所有消费方，单纯为这一个工具改协议成本高。从 deck_chats
   * 反向解析 JSON 是当前最小改动方案。
   *
   * 仅识别 `generate_slide_image` 风格：content 是 JSON 且含 `jobId` 字段。
   * 其他工具不返 jobId 自然被过滤掉。`trackedImageJobIds` 跨多 turn 累积避免
   * 重启 polling；session 期间持有，clearHistory 时清空。
   */
  function kickOffPendingImageJobs(chats: DeckChat[]): void {
    for (const c of chats) {
      if (c.role !== 'tool') continue
      let parsed: { jobId?: unknown; success?: unknown } | null = null
      try {
        parsed = JSON.parse(c.content) as { jobId?: unknown; success?: unknown }
      } catch {
        continue
      }
      if (parsed?.success !== true) continue
      const jobId = typeof parsed.jobId === 'string' ? parsed.jobId : null
      if (!jobId || trackedImageJobIds.has(jobId)) continue
      trackedImageJobIds.add(jobId)
      const job = useGenerateImageJob()
      // 注意：useGenerateImageJob.start 内部 done / fallback-rewrote 已 slideStore.refresh()，
      // failed / cancelled 仅 throw —— 这里 catch 静默，避免未处理 promise rejection。
      job.start({ jobId }).catch((err) => {
        console.error('[useAIChat] image job tracking failed:', jobId, (err as Error).message)
      })
    }
  }

  function consumeEvent(event: CanonicalEvent): void {
    switch (event.type) {
      case 'turn.start':
        lastTurnId.value = event.turnId
        break
      case 'text.delta':
        if (status.value !== 'streaming') status.value = 'streaming'
        streamingContent.value += event.text
        break
      case 'thinking.delta':
        thinkingContent.value += event.text
        break
      case 'tool_call.start':
      case 'tool_call.delta':
      case 'tool_call.end':
        // tool_call.* 是 LLM 决定调工具时的 SSE 流（args 缓冲），backend 已在
        // pi-agent-core 内部累积；frontend 只在 tool_execution.* 里看真实执行状态。
        break
      case 'tool_execution.start': {
        const map = new Map(currentToolExecutions.value)
        map.set(event.toolCallId, { toolName: event.toolName, state: 'running' })
        currentToolExecutions.value = map
        break
      }
      case 'tool_execution.delta':
        // partial result preview 当前不用；留作未来扩展（pi-agent-core 也暂无 partial 推送）
        break
      case 'tool_execution.end': {
        const map = new Map(currentToolExecutions.value)
        const existing = map.get(event.toolCallId)
        if (existing) {
          map.set(event.toolCallId, { ...existing, state: event.isError ? 'error' : 'done' })
          currentToolExecutions.value = map
        }
        break
      }
      case 'cache.hit':
        // cache 在 turn.end 的 usage.cacheRead 一并到，这里 no-op（向前兼容老 wire）
        break
      case 'turn.end':
        lastUsage.value = event.usage
        break
      case 'finish':
        // 非 agent 单轮调用兼容（agent loop 路径不会到这里，仅留给可能的旧 stream）
        lastUsage.value = event.usage
        break
      case 'error':
        throw new Error(`agent error [${event.code}]: ${event.message}`)
    }
  }

  async function sendMessage(userText: string): Promise<void> {
    if (!deckCtx) {
      console.warn('[useAIChat] sendMessage called without DECK_CHAT_CONTEXT')
      return
    }
    if (status.value === 'sending' || status.value === 'streaming') return

    // 即刻 UI echo：用户消息立刻入气泡，不等 backend round-trip
    chatMessages.value.push({ role: 'user', content: userText })

    status.value = 'sending'
    errorMessage.value = ''
    streamingContent.value = ''
    thinkingContent.value = ''
    currentToolExecutions.value = new Map()
    lastUsage.value = null
    lastTurnId.value = null

    abortController = new AbortController()

    try {
      const res = await chatTurn(
        { deckId: deckCtx.deckId, message: userText },
        { signal: abortController.signal },
      )
      if (!res.body) throw new Error('chat/turn 响应缺少 body')
      for await (const evt of decodeSSEStream(res.body)) {
        consumeEvent(evt)
      }
      status.value = 'idle'
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        // 用户主动 cancel：静默回 idle，下面 finally 仍刷历史让用户看到刚发的 user 气泡
        status.value = 'idle'
      } else {
        errorMessage.value = e.message || '未知错误'
        status.value = 'error'
      }
    } finally {
      abortController = null
      // 不管成功 / cancel / error 都 refresh：backend agent_end subscribe 已经把
      // 整个 turn (user + assistant + tool messages) 落 deck_chats。streaming 缓冲
      // 在 refresh 后清掉避免和 history 气泡重复显示。
      await refreshFromBackend()
      streamingContent.value = ''
      thinkingContent.value = ''
      currentToolExecutions.value = new Map()
      // 工具可能改了 slides.md，session 结束同步一次让 DeckRenderer 拿到新内容
      slideStore.refresh()
    }
  }

  function cancel(): void {
    abortController?.abort()
  }

  function clearHistory(): void {
    chatMessages.value = []
    streamingContent.value = ''
    thinkingContent.value = ''
    currentToolExecutions.value = new Map()
    lastUsage.value = null
    lastTurnId.value = null
    status.value = 'idle'
    errorMessage.value = ''
    trackedImageJobIds.clear()
  }

  function appendLocalMessage(content: string): void {
    chatMessages.value.push({ role: 'assistant', content })
  }

  function retryLastUserMessage(): void {
    if (status.value !== 'idle') return
    const lastUser = [...chatMessages.value].reverse().find((m) => m.role === 'user')
    if (!lastUser) {
      appendLocalMessage('没有可重试的用户消息。')
      return
    }
    void sendMessage(lastUser.content)
  }

  return {
    chatMessages,
    streamingContent,
    thinkingContent,
    lastUsage,
    lastTurnId,
    currentToolExecutions,
    status,
    statusText,
    isGenerating,
    sendMessage,
    cancel,
    clearHistory,
    appendLocalMessage,
    retryLastUserMessage,
  }
}
