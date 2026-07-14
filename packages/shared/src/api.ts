import type { ChatMessage, ToolCall } from './chat.js'
import type { LLMTool } from './tools.js'
import type { LogPayload } from './log.js'
import type { ImageStylePalettePolicy } from './image-style-manifest.js'

/**
 * API 契约：creator ↔ agent（HTTP + SSE）。
 * 所有路径以 `/api` 前缀挂在 agent Hono 服务上（默认 :4000）。
 * dev 时由 creator 的 Vite proxy 转发。
 */

// === /api/llm/chat/completions ===
export interface LLMChatRequest {
  model: string
  messages: ChatMessage[]
  tools: LLMTool[]
  stream: true
}

/** Raw SSE response from upstream LLM (OpenAI-compatible). Body is a stream of `data: {...}\n\n`. */
export interface LLMStreamDelta {
  choices: Array<{
    delta: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

/**
 * write_slides 工具的响应类型（HTTP 路由已在 Phase 4 Step 11 删除，现仅用于 tool exec 返回值）。
 */
export interface WriteSlidesResponse {
  success: boolean
  bytes?: number
  error?: string
}

/**
 * edit_slides 工具的响应类型（HTTP 路由已在 Phase 4 Step 11 删除，现仅用于 tool exec 返回值）。
 */
export interface EditSlidesResponse {
  success: boolean
  replaced?: number
  error?: string
}

// === /api/restore-slides ===
/** 当前 slides.md 在历史栈中的位置（1-based），用于前端展示 "第 N / M 版" */
export interface HistoryPosition {
  /** 1-based index */
  index: number
  total: number
}
export interface RestoreSlidesResponse {
  success: boolean
  message?: string
  position?: HistoryPosition
  error?: string
}

// === /api/redo-slides ===
export interface RedoSlidesResponse {
  success: boolean
  message?: string
  position?: HistoryPosition
  error?: string
}

// === 四件套工具（走 POST /api/call-tool，下列类型供参考 / 前端可选 import） ===

export interface CreateSlideArgs {
  /** 1-based 插入位置；"end" 或省略则追加到末尾 */
  index?: number | 'end'
  /** layout 名（如 cover / toc / content / two-col / data / image-content / back-cover） */
  layout: string
  /** layout 所需的额外 frontmatter 键值对（与 layout 合并） */
  frontmatter?: Record<string, unknown>
  /** markdown 正文 */
  body?: string
}
export interface CreateSlideResult {
  success: boolean
  /** 新页的 1-based 位置 */
  index?: number
  error?: string
}

export interface UpdateSlideArgs {
  /** 1-based 目标页位置 */
  index: number
  frontmatter?: Record<string, unknown>
  body?: string
  /** true 时完全替换 frontmatter，false/缺省合并 */
  replaceFrontmatter?: boolean
}
export interface UpdateSlideResult {
  success: boolean
  error?: string
}

export interface DeleteSlideArgs {
  index: number
}
export interface DeleteSlideResult {
  success: boolean
  error?: string
}

export interface ReorderSlidesArgs {
  /** 长度等于当前页数，每个元素是 1..N 的排列 */
  order: number[]
}
export interface ReorderSlidesResult {
  success: boolean
  error?: string
}

// === /api/list-templates ===
export interface ListTemplatesResponse {
  success: boolean
  templates?: Array<{ name: string; path: string }>
  error?: string
}

// === /api/read-template ===
export interface ReadTemplateRequest {
  name: string
}
export interface ReadTemplateResponse {
  success: boolean
  content?: string
  error?: string
}

// === /api/log-event ===
export type LogEventRequest = LogPayload
export interface LogEventResponse {
  success: boolean
  session?: string
  error?: string
}

// === /api/log/latest ===
export interface LogLatestResponse {
  success: boolean
  session?: string | null
  path?: string | null
  events?: LogPayload[]
  error?: string
}

// === 便捷：工具调用结果（由 agent 的 tool registry 返回，通常序列化成字符串放进 `tool` role 的 content） ===
export interface ToolExecResult {
  success: boolean
  result?: unknown
  error?: string
}

// === MCP server 配置(后端持久化) ===

export interface McpServerConfig {
  /** 稳定 id,同时作为 `mcp__<id>__<tool>` 的前缀,必须符合 [a-zA-Z0-9_-]+ */
  id: string
  displayName: string
  description: string
  /** StreamableHTTP endpoint,如 https://open.bigmodel.cn/api/mcp/web_search_prime/mcp */
  url: string
  /** 连接时透传的 HTTP headers(含 Authorization) */
  headers: Record<string, string>
  enabled: boolean
  /** 预置(代码里 seed)/ 用户新增。预置不可删,只可禁用 */
  preset: boolean
  badge?: string
}

export type McpServerState = 'disabled' | 'connecting' | 'ok' | 'error'

export interface McpServerStatus {
  state: McpServerState
  toolCount?: number
  error?: string
  /** ISO string */
  connectedAt?: string
}

export interface McpServerWithStatus extends McpServerConfig {
  status: McpServerStatus
  /**
   * 后端在 GET 时计算:headers 任一 value 含 `$LLM_KEY` sentinel 即为 true。
   * 前端据此显示"复用 LLM Key"复选框为已勾选状态、隐藏 API Key 输入框。
   * 持久化"复用语义":sentinel 直接落库(不在 PATCH 时替换),
   * registry.activate 连接 MCP 时才把 sentinel 解析成真 LLM apiKey 注入 HTTP header。
   */
  reuseLlmKey: boolean
}

// === /api/mcp/servers ===

export interface GetMcpServersResponse {
  success: boolean
  servers?: McpServerWithStatus[]
  error?: string
}

export interface CreateMcpServerRequest {
  id: string
  displayName: string
  description?: string
  url: string
  headers?: Record<string, string>
  badge?: string
}

export interface UpdateMcpServerRequest {
  enabled?: boolean
  headers?: Record<string, string>
  displayName?: string
  description?: string
  badge?: string
}

export interface MutateMcpServerResponse {
  success: boolean
  error?: string
}

// === /api/tools ===

export interface GetToolsResponse {
  success: boolean
  tools?: LLMTool[]
  error?: string
}

// === /api/call-tool ===

export interface CallToolRequest {
  name: string
  args: Record<string, unknown>
  /**
   * 客户端轮次 id（可选）。同一个 user message 触发的所有 tool_call 共用同一个 turnId，
   * agent 会把同一 turnId 的多次写入合并为 **一条** history 条目（/undo /redo 按轮次粒度）。
   * 不传则每次 tool_call 都算独立条目。
   */
  turnId?: string
}

export interface CallToolResponse {
  success: boolean
  /** 统一序列化成字符串,前端原样喂回 `tool` role 的 content */
  result?: string
  error?: string
}

// === Phase 11.8 /api/decks/:id/mood-board/generate + /api/decks/:id/anchor ===

/** 单张样张候选(轻量元数据,实际图片字节走 /api/assets/<assetId>) */
export interface MoodBoardCandidate {
  /** deck_assets.id, purpose='mood-board-candidate' */
  assetId: string
  style: string
  prompt: string
}

export interface GenerateMoodBoardResponse {
  candidates: MoodBoardCandidate[]
  /** 主 LLM 是否触发过 diversity retry */
  retried: boolean
  /** retry 后仍雷同(降级接受)? */
  diversityDegraded: boolean
  /** 本 deck 剩余可用生成次数(MAX - 已用) */
  remaining: number
}

export interface SetAnchorRequest {
  assetId: string
}

export interface SetAnchorResponse {
  ok: true
  anchorAssetId: string
}

// === Phase 17 image style library ===

export type ImageStyleSource = 'system' | 'user' | 'explore'

/**
 * Unified card shape returned by the deck-scoped style library.
 * `stylePrompt` and filesystem paths are intentionally never exposed.
 */
export interface ImageStyleLibraryPreset {
  id: string
  source: 'system' | 'user'
  name: string
  description: string
  category: string
  tags: string[]
  order: number
  palettePolicy: ImageStylePalettePolicy
  previewUrl: string
  compatible: boolean
  createdAt?: string
  lastUsedAt?: string | null
}

export interface GeneratedImageStyleCandidate extends MoodBoardCandidate {
  source: 'explore'
  palettePolicy: ImageStylePalettePolicy
  previewUrl: string
  compatible: boolean
  /** Present when this exact candidate has already been saved to the user's library. */
  savedPresetId?: string
}

export type ActiveImageStyle =
  | {
      mode: 'preset'
      styleSource: 'system' | 'user'
      styleSourceId: string
      anchorAssetId: string
      stylePalettePolicy: ImageStylePalettePolicy
    }
  | {
      mode: 'generated'
      styleSource: 'explore'
      styleSourceId: string
      anchorAssetId: string
      stylePalettePolicy: ImageStylePalettePolicy
    }
  | { mode: 'free' }
  | { mode: 'undecided' }

export type ImageStyleDrawStateName = 'idle' | 'running' | 'failed' | 'done'

export interface ImageStyleDrawState {
  state: ImageStyleDrawStateName
  jobId: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface ImageStyleLibraryResponse {
  presets: {
    system: ImageStyleLibraryPreset[]
    user: ImageStyleLibraryPreset[]
  }
  generatedCandidates: GeneratedImageStyleCandidate[]
  active: ActiveImageStyle
  draw: ImageStyleDrawState
  remainingExplorations: number
}

export interface ApplyImageStyleRequest {
  source: ImageStyleSource
  id: string
}

export interface ApplyImageStyleResponse {
  active: Extract<ActiveImageStyle, { mode: 'preset' | 'generated' }>
}

export interface SaveImageStylePresetRequest {
  assetId: string
  name?: string
}

export interface SaveImageStylePresetResponse {
  preset: ImageStyleLibraryPreset
}

export interface ExploreImageStylesResponse {
  jobId: string
  state: 'running'
}

export type { ChatMessage, ToolCall, LLMTool, LogPayload }
