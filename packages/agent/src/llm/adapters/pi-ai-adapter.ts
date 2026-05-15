/**
 * Phase 12.5：单一 adapter 文件——把 canonical CanonicalChatRequest 翻译成
 * pi-ai Context + Model，调 pi-ai `stream()`，把 pi-ai 的 12 类
 * AssistantMessageEvent 翻译回 canonical 8 类 event。
 *
 * pi-ai event → canonical event 映射:
 * - start / text_start / text_end / thinking_start / thinking_end → drop
 *   (包络信号 canonical 不需要)
 * - text_delta → canonical text.delta { text }
 * - thinking_delta → canonical thinking.delta { text }
 * - toolcall_start → canonical tool_call.start { id, name }
 *   (从 partial.content[contentIndex] 拿 id+name —— pi-ai 在 start 时已经
 *   提供完整 id / name，arguments 此时通常为空对象，随后通过 delta 推送)
 * - toolcall_delta → canonical tool_call.delta { id, argsChunk }
 *   (id 走 state map 记忆，pi-ai delta 事件只有 contentIndex)
 * - toolcall_end → canonical tool_call.end { id }
 * - done → 拆 2 个 event：先 cache.hit(如 usage.cacheRead > 0) 再 finish
 *   (pi-ai 把 usage.cost 作为对象 {input, output, cacheRead, cacheWrite, total}
 *    返回；canonical TokenUsage 用 cached 单字段；total cost 不进 canonical
 *    用 logServerEvent 单独记)
 * - error → canonical error { code, message }（pi-ai 错误是 stream 内事件，
 *   非 throw；error.errorMessage 是用户可见消息；reason='aborted'|'error'）
 *
 * pi-ai actual API vs spec assumption 偏差（探测后调整）:
 * - Usage.cacheRead（spec 写的 cachedRead）
 * - Usage.cost 是 {input, output, cacheRead, cacheWrite, total} 对象，不是单一 number
 * - done event 携带 evt.message（完整 AssistantMessage），usage 从 message.usage 取
 * - error event 携带 evt.error（AssistantMessage）+ evt.reason ('aborted' | 'error')
 * - StreamOptions 字段：apiKey / signal 与 spec 一致；**没有 baseUrl 字段**
 *   (pi-ai 的 baseUrl 写死在 Model 内，由 getModel 返回；自定义 baseUrl 走
 *    构造 Model 对象的另一条路径，本 Task 暂不接 —— 12.5 落地后 baseUrl
 *    advanced 配置走另一条 PR)
 * - tool 的 `parameters` 接受 JSON Schema 对象（无需 typebox 包装）
 */
import {
  getModel,
  stream,
  type Context as PiContext,
  type Message as PiMessage,
  type Tool as PiTool,
  type TextContent as PiTextContent,
  type ImageContent as PiImageContent,
  type ThinkingContent as PiThinkingContent,
  type ToolCall as PiToolCall,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type KnownProvider,
  type Model as PiModel,
  type Api as PiApi,
} from '@earendil-works/pi-ai'
import type { TSchema } from '@earendil-works/pi-ai'
import type { LLMProvider, ProviderConfig } from '../provider.js'
import type {
  CanonicalChatRequest,
  CanonicalEvent,
  CanonicalMessage,
  Block,
  ToolDef,
  FinishReason,
  TokenUsage,
} from '../types.js'
import { LLMError } from '../errors.js'

type PiAssistantBlock = PiTextContent | PiThinkingContent | PiToolCall
type PiUserContent = PiTextContent | PiImageContent

/**
 * 测试期可注入的 model resolver。生产路径用 pi-ai `getModel(provider, modelId)`
 * 查内置 MODELS 表；faux 单测期 `registerFauxProvider` 注册的 model 不进
 * MODELS 表，必须通过测试 seam 直接塞入 Model 实例。
 *
 * 参考 routes/llm.ts 的 `__setRegistryForTesting` 模式：默认实现 + 测试期注入点。
 */
type ModelResolver = (providerId: string, modelId: string) => PiModel<PiApi>

const defaultResolver: ModelResolver = (providerId, modelId) =>
  getModel(providerId as KnownProvider, modelId as Parameters<typeof getModel>[1])

let _resolver: ModelResolver = defaultResolver

/**
 * @internal 仅测试用：让 faux 单测注入自定义 model（faux 不在 pi-ai 内置
 * MODELS 表）。传 null 恢复默认。
 */
export function __setModelResolverForTesting(r: ModelResolver | null): void {
  _resolver = r ?? defaultResolver
}

/**
 * 12 个 provider 公用 factory。家族区分由 pi-ai 内部处理（不同 provider
 * id 对应不同 api，pi-ai 路由到对应 streamXxx 函数）。
 */
export function createPiAiAdapter(cfg: ProviderConfig): LLMProvider {
  const providerId = cfg.id
  const modelId = cfg.model ?? getDefaultModel(providerId)
  return {
    id: providerId,
    family: detectFamily(providerId),
    async *streamChat(req, signal) {
      let model: PiModel<PiApi>
      try {
        model = _resolver(providerId, modelId)
      } catch (e) {
        throw translatePiAiError(e, providerId)
      }
      const piContext = canonicalToPiContext(req)
      // pi-ai 的 StreamOptions 接受 apiKey / signal（baseUrl 是 Model 自身字段，
      // 不在 StreamOptions 里——12.5 暂不接 baseUrl override，后续 PR 处理）。
      const piOptions: { apiKey?: string; signal?: AbortSignal; maxTokens?: number } = {
        apiKey: cfg.apiKey,
        signal,
      }
      if (req.maxTokens != null) piOptions.maxTokens = req.maxTokens

      let piStream: AssistantMessageEventStream
      try {
        piStream = stream(model, piContext, piOptions)
      } catch (e) {
        throw translatePiAiError(e, providerId)
      }
      // pi-ai 状态机:Map<contentIndex, { id, name }> 跟踪每个 toolCall block
      const blockState = new Map<number, { id: string; name: string }>()
      try {
        for await (const evt of piStream) {
          yield* translatePiEvent(evt, blockState, providerId)
        }
      } catch (e) {
        // pi-ai 极少 throw（错误一般走 error 事件），但传输层异常 / abort
        // 可能直接 throw，走统一翻译。
        throw translatePiAiError(e, providerId)
      }
    },
  }
}

function detectFamily(id: string): 'openai-compatible' | 'anthropic' | 'gemini' {
  if (id === 'anthropic') return 'anthropic'
  if (id === 'gemini') return 'gemini'
  return 'openai-compatible' // 其他 5 个 + 未来扩展全归 openai-compatible 家族
}

function getDefaultModel(id: string): string {
  const defaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
    zhipu: 'glm-4.6',
    deepseek: 'deepseek-chat',
    moonshot: 'kimi-k2',
    qwen: 'qwen3-max',
  }
  return defaults[id] ?? 'gpt-4o'
}

/** canonical CanonicalChatRequest → pi-ai Context */
function canonicalToPiContext(req: CanonicalChatRequest): PiContext {
  const messages: PiMessage[] = []
  let systemPrompt: string | undefined

  for (const m of req.messages) {
    if (m.role === 'system') {
      // 多条 system 拼接成单 systemPrompt（canonical 允许多条 system message，
      // pi-ai 只接受单字段 systemPrompt，用 \n 拼接保留顺序）。
      const text = extractText(m.content)
      systemPrompt = systemPrompt ? `${systemPrompt}\n${text}` : text
      continue
    }
    messages.push(canonicalMessageToPi(m))
  }

  const piTools = req.tools?.map(canonicalToolToPi)
  return {
    systemPrompt,
    messages,
    tools: piTools,
  }
}

function canonicalMessageToPi(m: CanonicalMessage): PiMessage {
  if (m.role === 'tool') {
    const tr = m.content.find((b) => b.type === 'tool_result')
    if (!tr || tr.type !== 'tool_result') {
      throw new Error('canonical tool message 缺 tool_result block')
    }
    const contentBlocks: PiUserContent[] = Array.isArray(tr.content)
      ? (tr.content
          .map(canonicalBlockToPiUserContent)
          .filter((b): b is PiUserContent => b !== null))
      : [{ type: 'text', text: tr.content }]
    return {
      role: 'toolResult',
      toolCallId: tr.toolUseId,
      toolName: 'unknown', // canonical tool_result 没存 name，pi-ai 需要但实际多数 provider 不强校验
      content: contentBlocks,
      isError: tr.isError ?? false,
      timestamp: Date.now(),
    }
  }
  if (m.role === 'user') {
    return {
      role: 'user',
      content: m.content
        .map(canonicalBlockToPiUserContent)
        .filter((b): b is PiUserContent => b !== null),
      timestamp: Date.now(),
    }
  }
  // assistant
  return {
    role: 'assistant',
    content: m.content
      .map(canonicalBlockToPiAssistant)
      .filter((b): b is PiAssistantBlock => b !== null),
    api: 'openai-completions', // 任意 placeholder；下游 stream() 不读 message.api 字段
    provider: 'unknown',
    model: 'unknown',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

/** user / tool_result 上下文里只允许 text + image block（不允许 thinking / tool_use / tool_result 嵌套）。 */
function canonicalBlockToPiUserContent(b: Block): PiUserContent | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'image':
      return { type: 'image', data: b.dataBase64, mimeType: b.mediaType }
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
      return null
  }
}

/** assistant 上下文允许 text + thinking + tool_use（不允许 image / tool_result）。 */
function canonicalBlockToPiAssistant(b: Block): PiAssistantBlock | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'thinking':
      return { type: 'thinking', thinking: b.text }
    case 'tool_use':
      return {
        type: 'toolCall',
        id: b.id,
        name: b.name,
        arguments: (b.input ?? {}) as Record<string, unknown>,
      }
    case 'image':
    case 'tool_result':
      return null
  }
}

function canonicalToolToPi(t: ToolDef): PiTool {
  return {
    name: t.name,
    description: t.description,
    // pi-ai Tool.parameters 形式上要求 TSchema（typebox），但 faux + 多数
    // provider 内部把它 JSON.stringify 当 JSON Schema 用；canonical
    // inputSchema 本就是 JSON Schema，cast 通过即可。
    parameters: t.inputSchema as unknown as TSchema,
  }
}

function extractText(blocks: Block[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * 翻译单个 pi-ai 事件到 0-2 个 canonical 事件。
 *
 * - 包络事件（start / *_start / *_end）drop 掉，canonical 没有对应（前端
 *   不依赖块边界——canonical text.delta 自带语义就是 streaming 字节，
 *   多 delta 自然拼成完整文本）。
 * - done 拆 2 个：cache.hit 在 cacheRead > 0 时 yield，再 yield finish。
 *   两个事件次序固定（先 cache.hit 再 finish）让消费方按顺序更新 UI。
 *
 * **暴露给单测**：faux provider 内部会重置 message.usage，无法注入定制
 * usage，因此 cache.hit + 部分 finish 分支（length / tool_use / content_filter）
 * 通过直接喂构造的 pi-ai 事件给本函数验证。生产路径仍只通过 streamChat 调用。
 */
export async function* translatePiEvent(
  evt: AssistantMessageEvent,
  state: Map<number, { id: string; name: string }>,
  _providerId: string,
): AsyncGenerator<CanonicalEvent> {
  switch (evt.type) {
    case 'start':
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
      return

    case 'text_delta':
      yield { type: 'text.delta', text: evt.delta }
      return

    case 'thinking_delta':
      yield { type: 'thinking.delta', text: evt.delta }
      return

    case 'toolcall_start': {
      const partial = evt.partial?.content?.[evt.contentIndex]
      if (!partial || partial.type !== 'toolCall') return
      const id = partial.id
      const name = partial.name
      if (!id || !name) return
      state.set(evt.contentIndex, { id, name })
      yield { type: 'tool_call.start', id, name }
      return
    }

    case 'toolcall_delta': {
      const s = state.get(evt.contentIndex)
      if (!s) return
      yield { type: 'tool_call.delta', id: s.id, argsChunk: evt.delta }
      return
    }

    case 'toolcall_end': {
      // pi-ai 在 toolcall_end 自带 evt.toolCall，优先用它；fallback 走 state 映射。
      const id = evt.toolCall?.id ?? state.get(evt.contentIndex)?.id
      if (!id) return
      yield { type: 'tool_call.end', id }
      return
    }

    case 'done': {
      const usage = evt.message.usage
      const cacheRead = usage.cacheRead ?? 0
      const inputTokens = usage.input ?? 0
      if (cacheRead > 0) {
        yield {
          type: 'cache.hit',
          cachedTokens: cacheRead,
          costTokens: inputTokens,
        }
      }
      const canonicalUsage: TokenUsage = {
        input: inputTokens,
        output: usage.output ?? 0,
        ...(cacheRead > 0 ? { cached: cacheRead } : {}),
      }
      yield {
        type: 'finish',
        reason: mapStopReason(evt.reason),
        usage: canonicalUsage,
      }
      return
    }

    case 'error': {
      // pi-ai 错误事件：evt.reason 是 'aborted' | 'error'；evt.error 是
      // 一个 AssistantMessage（用户可见消息存在 errorMessage 字段）。
      const errMsg = evt.error?.errorMessage ?? 'pi-ai stream error'
      const code = evt.reason === 'aborted' ? 'aborted' : 'unknown'
      yield {
        type: 'error',
        code,
        message: errMsg,
      }
      return
    }
  }
}

function mapStopReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'toolUse':
      return 'tool_use'
    case 'contentFilter':
    case 'refusal':
      return 'content_filter'
    default:
      return 'stop'
  }
}

/**
 * pi-ai error 实例 → LLMError 翻译。
 *
 * pi-ai 多数错误走 stream 内 error 事件（不 throw）；少数情况会同步 throw
 * （getModel 找不到 / 网络层 abort 没被 SDK 捕获 / SDK 内部 fetch 失败）。
 * 这里按 status / name / message 关键词桶分到 6 个 LLMErrorCode。
 */
export function translatePiAiError(e: unknown, providerId: string): LLMError {
  if (!(e instanceof Error)) {
    return new LLMError(String(e), 'unknown', providerId, false, e)
  }
  const msg = e.message ?? ''
  const status = (e as { status?: number }).status

  if (e.name === 'AbortError' || /aborted|abort signal/i.test(msg)) {
    return new LLMError(msg, 'unknown', providerId, false, e)
  }
  if (status === 401 || status === 403 || /authentication|unauthorized|invalid.*key|forbidden/i.test(msg)) {
    return new LLMError(msg, 'auth', providerId, false, e)
  }
  if (status === 429 || /rate.*limit|quota|too.*many.*request/i.test(msg)) {
    return new LLMError(msg, 'rate_limit', providerId, true, e)
  }
  if (
    (status === 400 || status === 413) &&
    /context.*window|too.*long|token.*limit|maximum.*context|exceeds.*max/i.test(msg)
  ) {
    return new LLMError(msg, 'context_too_long', providerId, false, e)
  }
  if (status != null && status >= 400 && status < 500) {
    return new LLMError(msg, 'invalid_request', providerId, false, e)
  }
  if (status != null && status >= 500) {
    return new LLMError(msg, 'network', providerId, true, e)
  }
  if (/timeout|ECONNREFUSED|ECONNRESET|fetch.*failed|network|socket/i.test(msg)) {
    return new LLMError(msg, 'network', providerId, true, e)
  }
  return new LLMError(msg, 'unknown', providerId, false, e)
}
