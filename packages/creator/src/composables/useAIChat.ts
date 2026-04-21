import { ref, computed } from 'vue'
import type {
  AgentStatus,
  ChatBubble,
  ChatMessage,
  LLMSettings,
  ToolCall,
  ToolStep,
} from '@big-ppt/shared'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt'
import { tools } from '../prompts/tools'
import { logEvent, setCurrentSession, truncate } from './logger'

export type { ToolStep, LLMSettings }

const TOOL_STATUS_MAP: Record<string, string> = {
  read_slides: '正在读取当前幻灯片...',
  write_slides: '正在生成幻灯片...',
  edit_slides: '正在修改幻灯片...',
  read_template: '正在读取模板...',
  list_templates: '正在查询可用模板...',
}

const MAX_ITERATIONS = 20
const MAX_CONTEXT_MESSAGES = 20

// --- Settings (localStorage) ---

function getSettings(): LLMSettings {
  const raw = localStorage.getItem('llm-settings')
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {}
  }
  return { provider: 'zhipu', apiKey: '', model: 'GLM-5.1' }
}

function getHeaders(): Record<string, string> {
  const settings = getSettings()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  }
}

function getModel(): string {
  return getSettings().model || 'GLM-5.1'
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

async function executeTool(call: ToolCall): Promise<string> {
  const args = JSON.parse(call.function.arguments || '{}')

  switch (call.function.name) {
    case 'read_slides':
      return await fetchToolResult('/api/read-slides')
    case 'write_slides':
      return await fetchToolResult('/api/write-slides', args)
    case 'edit_slides':
      return await fetchToolResult('/api/edit-slides', args)
    case 'read_template':
      return await fetchToolResult('/api/read-template', args)
    case 'list_templates':
      return await fetchToolResult('/api/list-templates')
    default:
      return JSON.stringify({ success: false, error: `未知工具: ${call.function.name}` })
  }
}

async function fetchToolResult(endpoint: string, body?: Record<string, string>): Promise<string> {
  const options: RequestInit = {
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) {
    options.method = 'POST'
    options.body = JSON.stringify(body)
  }
  const res = await fetch(endpoint, options)
  const text = await res.text()

  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

// --- SSE 流式解析 ---

async function callLLMStream(
  messages: ChatMessage[],
  signal: AbortSignal,
  onTextChunk: (chunk: string) => void,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: getModel(),
      messages,
      tools,
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
  onTextChunk: (chunk: string) => void,
  retries = 2,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  try {
    return await callLLMStream(messages, signal, onTextChunk)
  } catch (err: any) {
    if (err.name === 'AbortError') throw err
    if (err.message?.includes('API Key')) throw err

    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return callLLMWithRetry(messages, signal, onTextChunk, retries - 1)
    }
    throw err
  }
}

// --- Composable ---

export function useAIChat() {
  // 发送给 LLM 的完整消息（含 system、tool、tool_result）
  const messages = ref<ChatMessage[]>([{ role: 'system', content: buildSystemPrompt() }])

  // 展示在聊天 UI 的消息（只含 user + assistant 文字）
  const chatMessages = ref<ChatBubble[]>([])

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

    const session =
      globalThis.crypto?.randomUUID?.() ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setCurrentSession(session)
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
          tools_count: tools.length,
          model: getModel(),
          payload: { messages: trimmed, tools, model: getModel() },
        })

        const { toolCalls, content } = await callLLMWithRetry(
          trimmed,
          abortController.signal,
          (chunk) => {
            // 流式文本回调
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
              result = await executeTool(tc)
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'success' }
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
            } catch (err: any) {
              result = JSON.stringify({ success: false, error: err.message })
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'error', error: err.message }
              logEvent({
                session,
                turn: i + 1,
                kind: 'tool_result',
                tool: tc.function.name,
                success: false,
                error: err.message,
                duration_ms: Date.now() - toolT0,
                payload: { error: err.message, stack: err.stack },
              })
            }

            messages.value.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            })
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
    } catch (err: any) {
      // 归档进行中步骤为 error，避免丢失可视化上下文
      if (toolSteps.value.length > 0) {
        const finalized = toolSteps.value.map((s) =>
          s.status === 'loading'
            ? {
                ...s,
                status: 'error' as const,
                error: err.name === 'AbortError' ? '已取消' : err.message || '中断',
              }
            : s,
        )
        if (err.name === 'AbortError') {
          chatMessages.value.push({ role: 'assistant', content: '', toolSteps: finalized })
        } else {
          chatMessages.value.push({
            role: 'assistant',
            content: `出错了：${err.message}`,
            toolSteps: finalized,
          })
        }
        toolSteps.value = []
      } else if (err.name !== 'AbortError') {
        chatMessages.value.push({ role: 'assistant', content: `出错了：${err.message}` })
      }

      if (err.name === 'AbortError') {
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
        statusText.value = err.message || '未知错误'
        logEvent({
          session,
          kind: 'session_end',
          reason: 'error',
          error: err.message,
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
    messages.value = [{ role: 'system', content: buildSystemPrompt() }]
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
