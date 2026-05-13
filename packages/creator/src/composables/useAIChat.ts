import { inject, ref, computed, watch, type InjectionKey, type Ref } from 'vue'
import {
  decodeSSEStream,
  type AgentStatus,
  type Block,
  type CallToolRequest,
  type CallToolResponse,
  type CanonicalChatRequest,
  type CanonicalMessage,
  type ChatBubble,
  type FinishReason,
  type GetToolsResponse,
  type LLMSettings,
  type ToolDef,
  type ToolStep,
  type TokenUsage,
} from '@big-ppt/shared'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt'
import { chatStream } from '../api/llm'
import { logEvent, setCurrentSession, truncate } from './logger'
import { useSlideStore } from './useSlideStore'
import { useGenerateImageJob } from './useGenerateImageJob'

/**
 * 由 DeckEditorCanvas 通过 provide() 注入。useAIChat 在 setup 时 inject 拿到：
 * - `templateId`: deck 绑定的模板 id，用于按需从 agent 拉 system prompt（Phase 6C 起）
 * - `initialHistory`: deck_chats 里 user/assistant 消息，页面打开时 prefill 到气泡
 * - `persistChat`: 每次用户发言 / assistant 最终回复 / 工具结果，都写回 deck_chats
 */
export type DeckChatContext = {
  /** Phase 10.5：deckId 必须传给 agent，每个 fetch 加 X-Deck-Id header → 中间件
   *  覆写 ALS activeDeckId 让 tools / persist 知道改哪个 deck。 */
  deckId: number
  templateId: string
  initialHistory: ChatBubble[]
  /**
   * Phase 12 Task I：写 deck_chats 的同时把 canonical Block[] 一并发给后端
   * （`/api/decks/:id/chats` POST 已支持 canonical 字段，见 routes/decks.ts）。
   * `content` 兼容用作 plain text fallback；tool result 走 toolCallId 旁路。
   */
  persistChat: (
    role: 'user' | 'assistant' | 'tool',
    content: string,
    extras?: { toolCallId?: string; canonical?: Block[] },
  ) => Promise<void>
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
    case 'generate_slide_image': {
      // Phase 11.5：图片 job 异步,工具同步返 jobId 时已经定位到目标页便于用户看到 "正在生成"
      const raw = args.slideIndex
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
  generate_slide_image: '正在生成 AI 图片...',
}

/**
 * dogfood 后从 20 → 200。原 20 在 Phase 11.6 图片优先模式下不够:
 * - LLM 走单页路径(create_slide → 下一 turn generate_slide_image)每页吃 2 turn
 * - 22 页 deck 需要 ~44 turn,加上 cover / toc / 杂事容易撞 50-60
 * - 50+ 页极长 deck(如年度全面汇报)更需要冗余
 * 200 是宽松硬上限,正常用户场景下 LLM 会主动结束(最终 assistant message 无 tool_call),
 * cap 仅防 LLM 进入死循环或调用环。极端 200 turn × 5-10s/turn ≈ 30 min,实际从未达到。
 */
const MAX_ITERATIONS = 200
const MAX_CONTEXT_MESSAGES = 20

let cachedTools: ToolDef[] | null = null
let toolsLoadPromise: Promise<ToolDef[]> | null = null

/**
 * `/api/tools` 仍返 OpenAI shape（`{type:'function', function:{name, description, parameters}}`），
 * 直接转成 canonical `ToolDef[]`：`name` / `description` 透传，`parameters` → `inputSchema`。
 */
async function ensureTools(): Promise<ToolDef[]> {
  if (cachedTools) return cachedTools
  if (!toolsLoadPromise) {
    toolsLoadPromise = (async () => {
      const res = await fetch('/api/tools')
      const json = (await res.json()) as GetToolsResponse
      if (!res.ok || !json.success || !json.tools) {
        toolsLoadPromise = null
        throw new Error(json.error || `GET /api/tools failed: ${res.status}`)
      }
      cachedTools = json.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        inputSchema: (t.function.parameters ?? {}) as unknown as Record<string, unknown>,
      }))
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

function getModel(): string {
  return cachedSettings.model || 'GLM-5.1'
}

function getSettings(): LLMSettings {
  // 兼容外部 getSettings 导出（SettingsModal 早期代码还在引用）；apiKey 不从前端暴露
  return { provider: cachedSettings.provider as LLMSettings['provider'], apiKey: '', model: cachedSettings.model }
}

// --- canonical message 历史管理 ---

/**
 * canonical 形态下的历史裁剪。保留 Phase 11.6 学到的"孤儿 tool 守护"语义：
 * - canonical 协议下 `role:'tool'` message **必须**紧跟在含匹配 `tool_use` block
 *   的 `assistant` message 之后；若裁剪切口落在配对中间，向前丢掉 orphan tool。
 * - 系统提示词永远保留在 messages[0]（由 ensureSystemPrompt 保证）；裁剪触发时
 *   插入一条 summary system 占位告诉 LLM"早期历史已截断"。
 */
function trimMessages(messages: CanonicalMessage[]): CanonicalMessage[] {
  const system = messages[0]
  if (!system || system.role !== 'system') return messages

  if (messages.length <= MAX_CONTEXT_MESSAGES + 1) return messages

  const summary: CanonicalMessage = {
    role: 'system',
    content: [
      {
        type: 'text',
        text: '[ Earlier conversation history has been trimmed. The current slides.md is available via read_slides tool. ]',
      },
    ],
  }
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES)
  // 守护：role:'tool' message 必须紧跟带匹配 tool_use block 的 assistant；
  // slice 切口落在 assistant.tool_use ↔ tool 配对中间 → orphan tool，丢弃。
  let start = 0
  while (start < recent.length && recent[start]!.role === 'tool') start++
  return [system, summary, ...recent.slice(start)]
}

export const __trimMessagesForTesting = trimMessages

// --- 工具执行 ---

type FinalizedToolCall = {
  id: string
  name: string
  /** raw args string，缓冲完成后 JSON.parse */
  argsRaw: string
}

async function executeTool(
  call: FinalizedToolCall,
  turnId: string,
  deckId: number,
): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.argsRaw || '{}')
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: `invalid tool arguments JSON: ${(err as Error).message}`,
    } satisfies CallToolResponse)
  }
  const res = await fetch('/api/call-tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Phase 10.5：编辑器去抢锁后,session.activeDeckId 不再设；让 agent
      // 通过 header 知道这次工具调用作用在哪个 deck（write_slides /
      // generate_slide_image 等都依赖 ctx.activeDeckId）
      'X-Deck-Id': String(deckId),
    },
    body: JSON.stringify({ name: call.name, args, turnId } satisfies CallToolRequest),
  })
  const json = (await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }))) as CallToolResponse
  if (!res.ok || !json.success) {
    return JSON.stringify({ success: false, error: json.error || `HTTP ${res.status}` })
  }
  return json.result ?? ''
}

// --- canonical event consumer ---

interface ToolCallAccumulator {
  id: string
  name: string
  argsBuffer: string
}

export interface LLMStreamResult {
  finalizedToolCalls: FinalizedToolCall[]
  content: string
  thinking: string
  usage: TokenUsage | null
  finishReason: FinishReason | null
  cacheStats: { cached: number; cost: number } | null
}

/**
 * canonical event consumer 状态机。
 *
 * 接收 `decodeSSEStream` 产出的事件流，累积:
 * - `text.delta` → fullContent 缓冲 + 立即 onChunk 推 UI
 * - `tool_call.start | delta | end` → 拼装最终 `FinalizedToolCall[]`
 * - `thinking.delta` → thinking 缓冲 + onThinking 推 UI
 * - `cache.hit` → 保留最近一次 cache 数据
 * - `finish` → 记录 reason + usage
 * - `error` → 抛出（中断状态机，上层 try/catch 处理）
 */
export async function consumeCanonicalEventStream(
  stream: ReadableStream<Uint8Array>,
  onTextChunk: (chunk: string) => void,
  onThinkingChunk: (chunk: string) => void,
): Promise<LLMStreamResult> {
  const tools: Record<string, ToolCallAccumulator> = {}
  const order: string[] = [] // 保留 LLM 输出顺序
  let content = ''
  let thinking = ''
  let usage: TokenUsage | null = null
  let finishReason: FinishReason | null = null
  let cacheStats: { cached: number; cost: number } | null = null

  for await (const evt of decodeSSEStream(stream)) {
    switch (evt.type) {
      case 'text.delta':
        content += evt.text
        onTextChunk(evt.text)
        break
      case 'tool_call.start':
        tools[evt.id] = { id: evt.id, name: evt.name, argsBuffer: '' }
        order.push(evt.id)
        break
      case 'tool_call.delta': {
        const acc = tools[evt.id]
        if (acc) acc.argsBuffer += evt.argsChunk
        break
      }
      case 'tool_call.end':
        // tool_call.end 仅作分隔信号，最终汇总在循环结束后做（保证 args 完整缓冲）
        break
      case 'thinking.delta':
        thinking += evt.text
        onThinkingChunk(evt.text)
        break
      case 'cache.hit':
        cacheStats = { cached: evt.cachedTokens, cost: evt.costTokens }
        break
      case 'finish':
        finishReason = evt.reason
        usage = evt.usage
        break
      case 'error':
        throw new Error(`LLM error [${evt.code}]: ${evt.message}`)
      default: {
        // exhaustiveness：未知 event 类型时静默跳过（向前兼容 backend 加新事件）
        const _exhaustive: never = evt
        void _exhaustive
        break
      }
    }
  }

  const finalizedToolCalls: FinalizedToolCall[] = order.map((id) => {
    const acc = tools[id]!
    return { id: acc.id, name: acc.name, argsRaw: acc.argsBuffer }
  })

  return { finalizedToolCalls, content, thinking, usage, finishReason, cacheStats }
}

// --- 带重试的调用 ---

async function callLLMStream(
  messages: CanonicalMessage[],
  signal: AbortSignal,
  toolsList: ToolDef[],
  deckId: number,
  onTextChunk: (chunk: string) => void,
  onThinkingChunk: (chunk: string) => void,
): Promise<LLMStreamResult> {
  const request: CanonicalChatRequest = {
    messages,
    tools: toolsList,
  }
  const stream = await chatStream(request, { deckId, signal })
  return consumeCanonicalEventStream(stream, onTextChunk, onThinkingChunk)
}

async function callLLMWithRetry(
  messages: CanonicalMessage[],
  signal: AbortSignal,
  toolsList: ToolDef[],
  deckId: number,
  onTextChunk: (chunk: string) => void,
  onThinkingChunk: (chunk: string) => void,
  retries = 2,
): Promise<LLMStreamResult> {
  try {
    return await callLLMStream(messages, signal, toolsList, deckId, onTextChunk, onThinkingChunk)
  } catch (err) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'AbortError') throw err
    if (e.message?.includes('API Key')) throw err
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return callLLMWithRetry(messages, signal, toolsList, deckId, onTextChunk, onThinkingChunk, retries - 1)
    }
    throw err
  }
}

// --- helpers：把消息塞回 canonical history ---

function buildUserMessage(text: string): CanonicalMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function buildAssistantMessage(content: string, toolCalls: FinalizedToolCall[]): CanonicalMessage {
  const blocks: Block[] = []
  if (content.length > 0) blocks.push({ type: 'text', text: content })
  for (const tc of toolCalls) {
    let input: unknown
    try {
      input = JSON.parse(tc.argsRaw || '{}')
    } catch {
      input = tc.argsRaw
    }
    blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
  }
  return { role: 'assistant', content: blocks }
}

function buildToolResultMessage(toolUseId: string, result: string, isError = false): CanonicalMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool_result', toolUseId, content: result, ...(isError ? { isError: true } : {}) }],
  }
}

// --- Composable ---

export function useAIChat() {
  const slideStore = useSlideStore()
  const deckCtx = inject(DECK_CHAT_CONTEXT, null)

  // 发送给 LLM 的完整 canonical 消息（含 system + tool_result block）
  // 注意：恢复 deck 时只 prefill UI 气泡不注入 LLM 上下文 —— 旧 tool_use / tool_result
  // 可能不配对，LLM 容易幻觉。新对话从空上下文开始，AI 遇到不确定通过 read_slides
  // 等工具重新探测当前状态。
  //
  // Phase 6C：system prompt 构造迁到 agent（manifest 驱动）。这里先留空，
  // 首次 sendMessage / 恢复后的下一次 sendMessage 都会 lazy 拉一次填入 index 0。
  const messages = ref<CanonicalMessage[]>([])
  const templateId = deckCtx?.templateId ?? 'beitou-standard'

  async function ensureSystemPrompt(): Promise<void> {
    const first = messages.value[0]
    if (first && first.role === 'system' && first.content.length > 0) return
    const prompt = await buildSystemPrompt(templateId)
    const sysMsg: CanonicalMessage = { role: 'system', content: [{ type: 'text', text: prompt }] }
    if (messages.value[0]?.role === 'system') {
      messages.value[0] = sysMsg
    } else {
      messages.value.unshift(sysMsg)
    }
  }

  // 展示在聊天 UI 的消息（只含 user + assistant 文字）
  const chatMessages = ref<ChatBubble[]>(deckCtx ? [...deckCtx.initialHistory] : [])

  const status = ref<AgentStatus>('idle')
  const statusText = ref('')

  // LLM 工作时同步 slideStore.aiBusy。Phase 10.5 前 SlidePreview「重启 Slidev」
  // 按钮联动它在 streaming / tool 期间警示用户；当前没有直接消费方但留作 UI
  // 状态信号（其他 composable / 组件未来若要 disabled 按钮也方便用）。
  watch(
    status,
    (s) => {
      const busy = s === 'thinking' || s === 'streaming' || s === 'calling_tool'
      slideStore.setAIBusy(busy)
    },
    { immediate: true },
  )

  /**
   * 只在"AI 真在干活"的三种状态下转圈。
   * Why：error / cancelled 是终态（session 已结束、abortController 已被 finally 清掉），
   * 此时 loading 不应再转。历史上写成 `!== 'idle'` 把 error/cancelled 也算 generating，
   * 导致 LLM 上游 429 抛错后 ChatUI 假转圈，用户以为还在跑。
   */
  const isGenerating = computed(() =>
    ['thinking', 'calling_tool', 'streaming'].includes(status.value),
  )

  let abortController: AbortController | null = null

  // 当前流式输出的缓冲（用于实时显示 LLM 回复）
  const streamingContent = ref('')

  // Phase 12 Task I：thinking block 实时缓冲（Anthropic extended thinking / 其他 provider
  // 通过 canonical thinking.delta event 推过来）。ChatPanel 渲染折叠区，默认折叠。
  const thinkingContent = ref('')

  // Phase 12 Task I：最近一轮的 cache 命中（Anthropic prompt caching 触发 cache.hit event）。
  // 非 null 时在 assistant bubble 下方渲染小字提示。每轮覆盖。
  const lastCacheStats: Ref<{ cached: number; cost: number } | null> = ref(null)

  // Phase 12 Task I：最近一轮 LLM finish 时的 token usage（input / output / cached）。
  // 暂留作 debug 字段（未来 Settings 可展示），不绑定具体 UI。
  const lastUsage: Ref<TokenUsage | null> = ref(null)

  // Phase 12 Task I：最近一轮 finish reason（stop / length / tool_use / content_filter）。
  // 调试时可看；UI 暂不直接展示。
  const finishReason: Ref<FinishReason | null> = ref(null)

  // 当前轮的工具调用步骤（思维链可视化数据源）
  const toolSteps = ref<ToolStep[]>([])

  /**
   * Phase 11.5：generate_slide_image 同步只返 jobId,工具 step 立即变 success 是错的 ——
   * 用户期待"图出来"才算完成。本方法启 useGenerateImageJob 轮询,
   * - running:把 step 改回 loading + 实时进度 label
   * - done:step → success + setPage 定位
   * - failed/cancelled:step → error
   *
   * **关键**:接 stepsArray 引用而不是访问 toolSteps.value —— LLM 回复完成时
   * `toolSteps.value = []` 替换 ref.value,但旧 array 已被 chatMessages 历史 bubble
   * 持有,直接 patch 旧 array 才能让历史消息里的 ToolStep 实时更新。
   */
  async function trackImageJob(
    jobId: string,
    stepKey: string,
    stepsArray: ToolStep[],
  ): Promise<void> {
    console.log('[trackImageJob] entered', { jobId, stepKey })
    const job = useGenerateImageJob()
    function patchStep(patch: Partial<ToolStep>): void {
      const idx = stepsArray.findIndex((s) => s.key === stepKey)
      if (idx < 0) {
        console.warn('[trackImageJob] step not found in array', { stepKey, arraySize: stepsArray.length })
        return
      }
      const cur = stepsArray[idx]
      if (!cur) return
      stepsArray[idx] = { ...cur, ...patch }
    }
    // dogfood 后:监听 job.stage 变化实时更新 ToolStep label,准确反映后端 state。
    // 早先「从头到尾"正在生成 AI 图片…"」会让用户误以为所有图都在跑,实际后端 pLimit=3 排队
    // 大量 job 还在 pending。pending → running → done 三阶段分别给不同文案。
    patchStep({ status: 'loading', label: '排队中…' })
    const stopWatch = watch(job.stage, (newStage) => {
      if (newStage === 'pending') {
        patchStep({ status: 'loading', label: '排队中…' })
      } else if (newStage === 'running') {
        patchStep({ status: 'loading', label: '生成中…' })
      }
      // terminal 状态(done / fallback-rewrote / failed / fallback-failed / cancelled)
      // 由下面 try/catch 处理 final label,这里不重复 patch
    })
    try {
      console.log('[trackImageJob] calling job.start', { jobId })
      const final = await job.start({ jobId })
      console.log('[trackImageJob] job done', { jobId, assetId: final.assetId, state: final.state })
      // Phase 11.6:done = 出图成功;fallback-rewrote = 出图失败但兜底重写成功(slides.md 已变成组件版)。
      // 两种 success 都让 SlidePreview 自动刷新,只是用户看到的是"图"还是"组件版"不同,文案分两种。
      if (final.state === 'fallback-rewrote') {
        patchStep({
          status: 'success',
          label: '生图失败,已自动降级为组件版',
        })
      } else {
        patchStep({ status: 'success', label: '已生成 AI 图片' })
      }
      if (typeof final.slideIndex === 'number') {
        slideStore.setPage(final.slideIndex)
      }
    } catch (err) {
      console.error('[trackImageJob] job failed', { jobId, error: (err as Error).message })
      patchStep({ status: 'error', error: (err as Error).message })
    } finally {
      stopWatch()
    }
  }

  async function sendMessage(userText: string) {
    // 阻止重入只看"真在跑"的三种状态；error / cancelled 终态允许直接重发
    if (['thinking', 'calling_tool', 'streaming'].includes(status.value)) return
    // 上一轮 error / cancelled 留下的 statusText 在新一轮开始前清掉，避免误导
    if (status.value !== 'idle') {
      status.value = 'idle'
      statusText.value = ''
    }

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

    let liveTools: ToolDef[]
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

    // 添加用户消息（canonical 形态）+ UI 气泡
    const userMsg = buildUserMessage(userText)
    messages.value.push(userMsg)
    chatMessages.value.push({ role: 'user', content: userText })
    // 异步持久化到 deck_chats；失败只打日志不阻塞对话
    if (deckCtx) {
      void deckCtx
        .persistChat('user', userText, { canonical: userMsg.content })
        .catch((err) => {
          console.error('[useAIChat] persist user chat failed:', (err as Error).message)
        })
    }

    abortController = new AbortController()
    streamingContent.value = ''
    thinkingContent.value = ''

    const deckId = deckCtx?.deckId ?? 0

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const trimmed = trimMessages(messages.value)

        // 每轮新建流式缓冲
        let fullContent = ''
        let fullThinking = ''
        streamingContent.value = ''
        thinkingContent.value = ''

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

        const streamResult = await callLLMWithRetry(
          trimmed,
          abortController.signal,
          liveTools,
          deckId,
          (chunk) => {
            if (status.value !== 'streaming') {
              status.value = 'streaming'
              statusText.value = ''
            }
            fullContent += chunk
            streamingContent.value = fullContent
          },
          (chunk) => {
            fullThinking += chunk
            thinkingContent.value = fullThinking
          },
        )

        // 把 canonical event 末态展开给后续逻辑用
        lastUsage.value = streamResult.usage
        finishReason.value = streamResult.finishReason
        // 仅当本轮有 cache.hit 才覆盖；否则保留上一轮值（每个 deck session 不归零，
        // 让用户切换不同消息时仍能看到最近一次 hit 数据；但 clearHistory 会重置）
        if (streamResult.cacheStats) {
          lastCacheStats.value = streamResult.cacheStats
        }

        const toolCalls = streamResult.finalizedToolCalls
        const content = streamResult.content

        logEvent({
          session,
          turn: i + 1,
          kind: 'llm_response',
          content_length: (content || '').length,
          content_preview: truncate(content, 300),
          tool_calls_count: toolCalls.length,
          tool_call_names: toolCalls.map((t) => t.name),
          duration_ms: Date.now() - turnT0,
          payload: { content, tool_calls: toolCalls },
        })

        if (toolCalls.length > 0) {
          // 把 assistant 的 tool_use + 可选 text 消息加入 canonical 历史
          const assistantMsg = buildAssistantMessage(content, toolCalls)
          messages.value.push(assistantMsg)
          // assistant 含 tool_use 的轮次也走 persist（让后端 deck_chats 能完整重组历史）
          if (deckCtx) {
            void deckCtx
              .persistChat('assistant', content, { canonical: assistantMsg.content })
              .catch((err) => {
                console.error('[useAIChat] persist assistant tool turn failed:', (err as Error).message)
              })
          }

          // 逐个执行工具
          for (const tc of toolCalls) {
            const step: ToolStep = {
              key: tc.id || `${tc.name}-${Date.now()}-${Math.random()}`,
              name: tc.name,
              label: TOOL_STATUS_MAP[tc.name] || `调用工具：${tc.name}`,
              status: 'loading',
              argsPreview: (tc.argsRaw || '').slice(0, 80),
            }
            toolSteps.value.push(step)

            status.value = 'calling_tool'
            statusText.value = step.label

            const toolT0 = Date.now()
            logEvent({
              session,
              turn: i + 1,
              kind: 'tool_call',
              tool: tc.name,
              args: truncate(tc.argsRaw, 500),
              payload: {
                tool_call_id: tc.id,
                name: tc.name,
                arguments: tc.argsRaw,
              },
            })

            let result: string
            let toolErrored = false
            try {
              result = await executeTool(tc, turnId, deckId)
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'success' }
              // 工具执行成功后，尝试定位被改/新增的页到预览
              try {
                const parsedArgs = JSON.parse(tc.argsRaw || '{}') as Record<string, unknown>
                const focus = extractFocusPage(tc.name, parsedArgs, result)
                if (focus !== null) slideStore.setPage(focus)
              } catch { /* args 不是合法 JSON 就跳过 */ }

              // Phase 11.5：generate_slide_image 同步只返 jobId,真正出图是异步 60s。
              // 把 ToolStep 改回 loading,启 useGenerateImageJob 轮询;done 才标 success。
              // (LLM 已经拿到 queued ack 进入下一轮,UI 仍展示进度直到图真的就绪)
              //
              // **关键**:capture toolSteps.value 当前数组引用传给 trackImageJob ——
              // LLM 回复完成时 toolSteps.value = [] 会替换 ref.value,但 chatMessages
              // 历史 bubble 仍持有这个旧 array,trackImageJob 直接 mutate 旧 array
              // 才能让历史消息里的 ToolStep 实时更新到 done/error 状态。
              if (tc.name === 'generate_slide_image') {
                try {
                  const parsed = JSON.parse(result) as { success?: boolean; jobId?: string }
                  console.log('[generate_slide_image] tool result:', parsed)
                  if (parsed.success && parsed.jobId) {
                    const liveSteps = toolSteps.value
                    console.log('[generate_slide_image] starting trackImageJob', { jobId: parsed.jobId, stepKey: step.key })
                    void trackImageJob(parsed.jobId, step.key, liveSteps)
                  } else {
                    console.warn('[generate_slide_image] tool result missing success/jobId, skip tracking')
                  }
                } catch (e) {
                  console.error('[generate_slide_image] failed to parse tool result:', (e as Error).message, result)
                }
              }
              logEvent({
                session,
                turn: i + 1,
                kind: 'tool_result',
                tool: tc.name,
                success: true,
                bytes: result.length,
                preview: truncate(result, 300),
                duration_ms: Date.now() - toolT0,
                payload: { result },
              })
            } catch (err) {
              const e = err as Error
              result = JSON.stringify({ success: false, error: e.message })
              toolErrored = true
              const idx = toolSteps.value.findIndex((s) => s.key === step.key)
              if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'error', error: e.message }
              logEvent({
                session,
                turn: i + 1,
                kind: 'tool_result',
                tool: tc.name,
                success: false,
                error: e.message,
                duration_ms: Date.now() - toolT0,
                payload: { error: e.message, stack: e.stack },
              })
            }

            const toolMsg = buildToolResultMessage(tc.id, result, toolErrored)
            messages.value.push(toolMsg)
            if (deckCtx) {
              void deckCtx
                .persistChat('tool', result, { toolCallId: tc.id, canonical: toolMsg.content })
                .catch((err) => {
                  console.error('[useAIChat] persist tool chat failed:', (err as Error).message)
                })
            }
          }
          continue
        }

        // LLM 最终自然语言回复
        if (content) {
          messages.value.push({
            role: 'assistant',
            content: [{ type: 'text', text: content }],
          })
        }
        if (content || toolSteps.value.length > 0) {
          chatMessages.value.push({
            role: 'assistant',
            content: content,
            toolSteps: toolSteps.value.length > 0 ? toolSteps.value : undefined,
            thinking: fullThinking || undefined,
            cacheStats: streamResult.cacheStats ?? undefined,
          })
        }
        if (deckCtx && content) {
          void deckCtx
            .persistChat('assistant', content, {
              canonical: [{ type: 'text', text: content }],
            })
            .catch((err) => {
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
        thinkingContent.value = ''
        status.value = 'idle'
        statusText.value = ''
        // session 结束时主动 refresh slides.md：LLM 通过 tool 调用 server 端
        // 写了 N 次 slides.md，client 端 slideStore.content 需要同步一次拿最终态
        // 喂给 DeckRenderer。Phase 10.5 前还兼有「兜底 Slidev HMR 缓存错位」职能；
        // DeckRenderer 时代仅剩 content 同步这一个目的。
        slideStore.refresh()
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
      // max_iterations 中断时同步 server slides.md 到 client content，避免
      // DeckRenderer 卡在中间态
      slideStore.refresh()
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
      thinkingContent.value = ''
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
    thinkingContent.value = ''
    toolSteps.value = []
    lastCacheStats.value = null
    lastUsage.value = null
    finishReason.value = null
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
    thinkingContent,
    lastCacheStats,
    lastUsage,
    finishReason,
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
