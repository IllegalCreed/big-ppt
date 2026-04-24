import { inject, ref, computed, type InjectionKey } from 'vue'
import type {
  AgentStatus,
  CallToolRequest,
  CallToolResponse,
  ChatBubble,
  ChatMessage,
  GetToolsResponse,
  LLMSettings,
  LLMTool,
  ToolCall,
  ToolStep,
} from '@big-ppt/shared'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt'
import { logEvent, setCurrentSession, truncate } from './logger'
import { useSlideStore } from './useSlideStore'

/**
 * 由 DeckEditorCanvas 通过 provide() 注入。useAIChat 在 setup 时 inject 拿到：
 * - `templateId`: deck 绑定的模板 id，用于按需从 agent 拉 system prompt（Phase 6C 起）
 * - `initialHistory`: deck_chats 里 user/assistant 消息，页面打开时 prefill 到气泡
 * - `persistChat`: 每次用户发言 / assistant 最终回复 / 工具结果，都写回 deck_chats
 */
export type DeckChatContext = {
  templateId: string
  initialHistory: ChatBubble[]
  persistChat: (role: 'user' | 'assistant' | 'tool', content: string, toolCallId?: string) => Promise<void>
}

export const DECK_CHAT_CONTEXT: InjectionKey<DeckChatContext> = Symbol('DECK_CHAT_CONTEXT')

/**
 * 工具调用成功后，从 args / result 中提取"被改/新增"页的 index，返回给 caller 去 setPage。
 * 所有返回的 index 都是 1-based，与 slideStore.currentPage 对齐。
 */
function extractFocusPage(toolName: string, args: Record<string, unknown>, resultText: string): number | null {
  switch (toolName) {
    case 'create_slide': {
      // result: { success, index }
      try {
        const parsed = JSON.parse(resultText) as { index?: unknown }
        if (typeof parsed.index === 'number') return parsed.index
      } catch { /* ignore */ }
      return null
    }
    case 'update_slide':
    case 'delete_slide': {
      const raw = args.index
      if (typeof raw === 'number') return raw
      if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number(raw.trim())
      return null
    }
    default:
      return null
  }
}

export type { ToolStep, LLMSettings }

const TOOL_STATUS_MAP: Record<string, string> = {
  read_slides: '正在读取当前幻灯片...',
  write_slides: '正在生成幻灯片...',
  edit_slides: '正在替换文本...',
  create_slide: '正在新增页面...',
  update_slide: '正在修改当前页...',
  delete_slide: '正在删除页面...',
  reorder_slides: '正在重新排序...',
  read_template: '正在读取模板...',
  list_templates: '正在查询可用模板...',
}

const MAX_ITERATIONS = 20
const MAX_CONTEXT_MESSAGES = 20

let cachedTools: LLMTool[] | null = null
let toolsLoadPromise: Promise<LLMTool[]> | null = null

async function ensureTools(): Promise<LLMTool[]> {
  if (cachedTools) return cachedTools
  if (!toolsLoadPromise) {
    toolsLoadPromise = (async () => {
      const res = await fetch('/api/tools')
      const json = (await res.json()) as GetToolsResponse
      if (!res.ok || !json.success || !json.tools) {
        toolsLoadPromise = null
        throw new Error(json.error || `GET /api/tools failed: ${res.status}`)
      }
      cachedTools = json.tools
      return cachedTools
    })()
  }
  return toolsLoadPromise
}

export function __clearToolsCacheForTesting() {
  cachedTools = null
  toolsLoadPromise = null
}

// --- Settings (backend source of truth; 缓存 model / provider 用于发 body 和日志) ---

type CachedSettings = {
  provider: string
  model: string
  baseUrl?: string | undefined
  hasApiKey: boolean
}

const DEFAULT_CACHED: CachedSettings = { provider: 'zhipu', model: 'GLM-5.1', hasApiKey: false }
let cachedSettings: CachedSettings = DEFAULT_CACHED
let settingsLoaded = false
let settingsLoadPromise: Promise<void> | null = null

async function loadSettingsOnce(): Promise<void> {
  if (settingsLoaded) return
  if (!settingsLoadPromise) {
    settingsLoadPromise = (async () => {
      try {
        const res = await fetch('/api/auth/llm-settings', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        if (res.ok) {
          const data = (await res.json()) as Partial<CachedSettings> & { provider: string | null; model: string | null }
          cachedSettings = {
            provider: data.provider ?? DEFAULT_CACHED.provider,
            model: data.model ?? DEFAULT_CACHED.model,
            baseUrl: data.baseUrl ?? undefined,
            hasApiKey: !!data.hasApiKey,
          }
        }
      } catch {
        // 未登录 / 网络错误：留默认值
      } finally {
        settingsLoaded = true
      }
    })()
  }
  await settingsLoadPromise
}

/** 设置面板保存后调用，强制下次请求前重新拉取 */
export function invalidateLlmSettingsCache() {
  settingsLoaded = false
  settingsLoadPromise = null
}

function getHeaders(): Record<string, string> {
  // API Key 在服务端，前端不再带 Authorization；session cookie 通过 credentials:'include' 自动带
  return { 'Content-Type': 'application/json' }
}

function getModel(): string {
  return cachedSettings.model || 'GLM-5.1'
}

function getSettings(): LLMSettings {
  // 兼容外部 getSettings 导出（SettingsModal 早期代码还在引用）；apiKey 不从前端暴露
  return { provider: cachedSettings.provider as LLMSettings['provider'], apiKey: '', model: cachedSettings.model }
}

// --- Messages 管理 ---

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  const system = messages[0]
  if (!system || system.role !== 'system') return messages

  if (messages.length <= MAX_CONTEXT_MESSAGES + 1) return messages

  const summary: ChatMessage = {
    role: 'system',
    content:
      '[ Earlier conversation history has been trimmed. The current slides.md is available via read_slides tool. ]',
  }
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES)
  return [system, summary, ...recent]
}

// --- 工具执行 ---

async function executeTool(call: ToolCall, turnId: string): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `invalid tool arguments JSON: ${(err as Error).message}`,
    } satisfies CallToolResponse)
  }
  const res = await fetch('/api/call-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: call.function.name, args, turnId } satisfies CallToolRequest),
  })
  const json = (await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }))) as CallToolResponse
  if (!res.ok || !json.success) {
    return JSON.stringify({ success: false, error: json.error || `HTTP ${res.status}` })
  }
  return json.result ?? ''
}

// --- SSE 流式解析 ---

async function callLLMStream(
  messages: ChatMessage[],
  signal: AbortSignal,
  toolsList: LLMTool[],
  onTextChunk: (chunk: string) => void,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: getHeaders(),
    body: JSON.stringify({
      model: getModel(),
      messages,
      tools: toolsList,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text()
    let errMsg = `请求失败：${response.status}`
    try {
      const errJson = JSON.parse(errText)
      errMsg = errJson.error?.message || errMsg
    } catch {}
    throw new Error(errMsg)
  }

  // 累积 tool_calls（按 index 分组）
  const toolCallMap = new Map<number, { id: string; name: string; args: string }>()
  let content = ''

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue

        // 流式文本
        if (delta.content) {
          content += delta.content
          onTextChunk(delta.content)
        }

        // 累积 tool_calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, { id: tc.id || '', name: '', args: '' })
            }
            const entry = toolCallMap.get(idx)!
            if (tc.id) entry.id = tc.id
            if (tc.function?.name) entry.name = tc.function.name
            if (tc.function?.arguments) entry.args += tc.function.arguments
          }
        }
      } catch {}
    }
  }

  // 组装 tool_calls 结果
  const toolCalls: ToolCall[] = []
  for (const [_, entry] of toolCallMap) {
    toolCalls.push({
      id: entry.id,
      type: 'function',
      function: { name: entry.name, arguments: entry.args },
    })
  }

  return { toolCalls, content }
}

// --- 带重试的调用 ---

async function callLLMWithRetry(
  messages: ChatMessage[],
  signal: AbortSignal,
  toolsList: LLMTool[],
  onTextChunk: (chunk: string) => void,
  retries = 2,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  try {
    return await callLLMStream(messages, signal, toolsList, onTextChunk)
  } catch (err) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'AbortError') throw err
    if (e.message?.includes('API Key')) throw err
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return callLLMWithRetry(messages, signal, toolsList, onTextChunk, retries - 1)
    }
    throw err
  }
}

// --- Composable ---

export function useAIChat() {
  const slideStore = useSlideStore()
  const deckCtx = inject(DECK_CHAT_CONTEXT, null)

  // 发送给 LLM 的完整消息（含 system、tool、tool_result）
  // 注意：恢复 deck 时只 prefill UI 气泡不注入 LLM 上下文 —— 旧 tool_call 会跟
  // tool_call_id 不匹配，LLM 可能幻觉。新对话从空上下文开始，AI 遇到不确定的
  // 通过 read_slides 等工具重新探测当前状态。
  //
  // Phase 6C：system prompt 构造迁到 agent（manifest 驱动）。这里先留空，
  // 首次 sendMessage / 恢复后的下一次 sendMessage 都会 lazy 拉一次填入 index 0。
  const messages = ref<ChatMessage[]>([])
  const templateId = deckCtx?.templateId ?? 'company-standard'

  async function ensureSystemPrompt(): Promise<void> {
    const first = messages.value[0]
    if (first && first.role === 'system' && first.content) return
    const prompt = await buildSystemPrompt(templateId)
    if (messages.value[0]?.role === 'system') {
      messages.value[0] = { role: 'system', content: prompt }
    } else {
      messages.value.unshift({ role: 'system', content: prompt })
    }
  }

  // 展示在聊天 UI 的消息（只含 user + assistant 文字）
  const chatMessages = ref<ChatBubble[]>(deckCtx ? [...deckCtx.initialHistory] : [])

  const status = ref<AgentStatus>('idle')
  const statusText = ref('')

  const isGenerating = computed(() => status.value !== 'idle')

  let abortController: AbortController | null = null

  // 当前流式输出的缓冲（用于实时显示 LLM 回复）
  const streamingContent = ref('')

  // 当前轮的工具调用步骤（思维链可视化数据源）
  const toolSteps = ref<ToolStep[]>([])

  async function sendMessage(userText: string) {
    if (status.value !== 'idle') return

    // 首次发送前拉一次 llm-settings（包含当前 model / provider）；后续用缓存
    await loadSettingsOnce()
    if (!cachedSettings.hasApiKey) {
      chatMessages.value.push({
        role: 'assistant',
        content: '尚未配置 LLM API Key，请点击右上角 ⚙️ 设置中填写。',
      })
      return
    }

    // Phase 6C：保证 messages[0] 是 manifest 驱动的最新 system prompt
    try {
      await ensureSystemPrompt()
    } catch (err) {
      chatMessages.value.push({
        role: 'assistant',
        content: `加载 system prompt 失败：${(err as Error).message}`,
      })
      return
    }

    let liveTools: LLMTool[]
    try {
      liveTools = await ensureTools()
    } catch (err) {
      chatMessages.value.push({
        role: 'assistant',
        content: `无法加载工具列表:${(err as Error).message}`,
      })
      return
    }

    const session =
      globalThis.crypto?.randomUUID?.() ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setCurrentSession(session)
    // 每次 user message 一个 turnId。整个 for 循环内所有 tool_call 共用，
    // agent 侧据此把同轮多次写合并为一条 history（/undo /redo 按轮次粒度）。
    const turnId =
      globalThis.crypto?.randomUUID?.() ||
      `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const t0 = Date.now()
    logEvent({
      session,
      kind: 'user_message',
      text: truncate(userText, 500),
      length: userText.length,
      model: getModel(),
      payload: { text: userText },
    })

    // 添加用户消息
    messages.value.push({ role: 'user', content: userText })
    chatMessages.value.push({ role: 'user', content: userText })
    // 异步持久化到 deck_chats；失败只打日志不阻塞对话
    if (deckCtx) {
      void deckCtx.persistChat('user', userText).catch((err) => {
        console.error('[useAIChat] persist user chat failed:', (err as Error).message)
      })
    }

    abortController = new AbortController()
    streamingContent.value = ''

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const trimmed = trimMessages(messages.value)

        // 每轮新建流式缓冲
        let fullContent = ''
        streamingContent.value = ''

        status.value = 'thinking'
        statusText.value = '正在思考...'

        const turnT0 = Date.now()
        logEvent({
          session,
          turn: i + 1,
          kind: 'llm_request',
          messages_count: trimmed.length,
          tools_count: liveTools.length,
          model: getModel(),
          payload: { messages: trimmed, tools: liveTools, model: getModel() },
        })

        const { toolCalls, content } = await callLLMWithRetry(
          trimmed,
          abortController.signal,
          liveTools,
          (chunk) => {
            if (status.value !== 'streaming') {
              status.value = 'streaming'
              statusText.value = ''
            }
            fullContent += chunk
            streamingContent.value = fullContent
          },
        )

        logEvent({
          session,
          turn: i + 1,
          kind: 'llm_response',
          content_length: (content || '').length,
          content_preview: truncate(content, 300),
          tool_calls_count: toolCalls.length,
          tool_call_names: toolCalls.map((t) => t.function.name),
          duration_ms: Date.now() - turnT0,
          payload: { content, tool_calls: toolCalls },
        })

        if (toolCalls.length > 0) {
          // 把 assistant 的 tool_calls 消息加入历史
          messages.value.push({
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
          })

          // 逐个执行工具
          for (const tc of toolCalls) {
            const step: ToolStep = {
              key: tc.id || `${tc.function.name}-${Date.now()}-${Math.random()}`,
              name: tc.function.name,
              label: TOOL_STATUS_MAP[tc.function.name] || `调用工具：${tc.function.name}`,
              status: 'loading',
              argsPreview: (tc.function.arguments || '').slice(0, 80),
            }
            toolSteps.value.push(step)

            status.value = 'calling_tool'
            statusText.value = step.label

            const toolT0 = Date.now()
            logEvent({
              session,
              turn: i + 1,
              kind: 'tool_call',
              tool: tc.function.name,
              args: truncate(tc.function.arguments, 500),
              payload: {
                tool_call_id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            })

            let result: string
            try {
              result = await executeTool(tc, turnId)
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'success' }
              // 工具执行成功后，尝试定位被改/新增的页到预览
              try {
                const parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
                const focus = extractFocusPage(tc.function.name, parsedArgs, result)
                if (focus !== null) slideStore.setPage(focus)
              } catch { /* args 不是合法 JSON 就跳过 */ }
              logEvent({
                session,
                turn: i + 1,
                kind: 'tool_result',
                tool: tc.function.name,
                success: true,
                bytes: result.length,
                preview: truncate(result, 300),
                duration_ms: Date.now() - toolT0,
                payload: { result },
              })
            } catch (err) {
              const e = err as Error
              result = JSON.stringify({ success: false, error: e.message })
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'error', error: e.message }
              logEvent({
                session,
                turn: i + 1,
                kind: 'tool_result',
                tool: tc.function.name,
                success: false,
                error: e.message,
                duration_ms: Date.now() - toolT0,
                payload: { error: e.message, stack: e.stack },
              })
            }

            messages.value.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            })
            if (deckCtx) {
              void deckCtx.persistChat('tool', result, tc.id).catch((err) => {
                console.error('[useAIChat] persist tool chat failed:', (err as Error).message)
              })
            }
          }
          continue
        }

        // LLM 最终自然语言回复
        if (fullContent) {
          messages.value.push({ role: 'assistant', content: fullContent })
        }
        if (fullContent || toolSteps.value.length > 0) {
          chatMessages.value.push({
            role: 'assistant',
            content: fullContent,
            toolSteps: toolSteps.value.length > 0 ? toolSteps.value : undefined,
          })
        }
        if (deckCtx && fullContent) {
          void deckCtx.persistChat('assistant', fullContent).catch((err) => {
            console.error('[useAIChat] persist assistant chat failed:', (err as Error).message)
          })
        }
        logEvent({
          session,
          kind: 'session_end',
          reason: 'completed',
          turns: i + 1,
          duration_ms: Date.now() - t0,
        })
        toolSteps.value = []
        streamingContent.value = ''
        status.value = 'idle'
        statusText.value = ''
        return
      }

      logEvent({
        session,
        kind: 'session_end',
        reason: 'max_iterations',
        turns: MAX_ITERATIONS,
        duration_ms: Date.now() - t0,
      })

      // 超过最大轮次
      const timeoutMsg = '生成超时（工具调用轮次过多），请尝试简化需求或重新开始。'
      chatMessages.value.push({ role: 'assistant', content: timeoutMsg })
      status.value = 'idle'
    } catch (err) {
      const e = err as Error
      const isAbort = e.name === 'AbortError'
      // 归档进行中步骤为 error，避免丢失可视化上下文
      if (toolSteps.value.length > 0) {
        const finalized = toolSteps.value.map((s) =>
          s.status === 'loading'
            ? {
                ...s,
                status: 'error' as const,
                error: isAbort ? '已取消' : e.message || '中断',
              }
            : s,
        )
        if (isAbort) {
          chatMessages.value.push({ role: 'assistant', content: '', toolSteps: finalized })
        } else {
          chatMessages.value.push({
            role: 'assistant',
            content: `出错了：${e.message}`,
            toolSteps: finalized,
          })
        }
        toolSteps.value = []
      } else if (!isAbort) {
        chatMessages.value.push({ role: 'assistant', content: `出错了：${e.message}` })
      }

      if (isAbort) {
        status.value = 'cancelled'
        statusText.value = '已取消'
        logEvent({
          session,
          kind: 'session_end',
          reason: 'cancelled',
          duration_ms: Date.now() - t0,
        })
      } else {
        status.value = 'error'
        statusText.value = e.message || '未知错误'
        logEvent({
          session,
          kind: 'session_end',
          reason: 'error',
          error: e.message,
          duration_ms: Date.now() - t0,
        })
      }
      streamingContent.value = ''
    } finally {
      abortController = null
      setCurrentSession(null)
    }
  }

  function cancel() {
    abortController?.abort()
  }

  function clearHistory() {
    // 留空，下次 sendMessage 时 ensureSystemPrompt 会按当前 templateId 重新拉
    messages.value = []
    chatMessages.value = []
    status.value = 'idle'
    statusText.value = ''
    streamingContent.value = ''
    toolSteps.value = []
  }

  /** 在 chat 面板插入一条本地系统提示（不发给 LLM） */
  function appendLocalMessage(content: string) {
    chatMessages.value.push({ role: 'assistant', content })
  }

  /** 重试上一条用户消息：在 chatMessages 里找最后一条 user 消息，再次 sendMessage */
  function retryLastUserMessage() {
    if (status.value !== 'idle') return
    const lastUser = [...chatMessages.value].reverse().find((m) => m.role === 'user')
    if (!lastUser) {
      appendLocalMessage('没有可重试的用户消息。')
      return
    }
    sendMessage(lastUser.content)
  }

  return {
    chatMessages,
    streamingContent,
    toolSteps,
    status,
    statusText,
    isGenerating,
    sendMessage,
    cancel,
    clearHistory,
    appendLocalMessage,
    retryLastUserMessage,
    getSettings,
  }
}
