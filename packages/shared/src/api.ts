import type { ChatMessage, ToolCall } from './chat.js'
import type { LLMTool } from './tools.js'
import type { LogPayload } from './log.js'

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

// === /api/read-slides ===
export interface ReadSlidesResponse {
  success: boolean
  content?: string
  error?: string
}

// === /api/write-slides ===
export interface WriteSlidesRequest {
  content: string
}
export interface WriteSlidesResponse {
  success: boolean
  bytes?: number
  error?: string
}

// === /api/edit-slides ===
export interface EditSlidesRequest {
  old_string: string
  new_string: string
}
export interface EditSlidesResponse {
  success: boolean
  replaced?: number
  error?: string
}

// === /api/restore-slides ===
export interface RestoreSlidesResponse {
  success: boolean
  restored_from?: string
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
}

export interface CallToolResponse {
  success: boolean
  /** 统一序列化成字符串,前端原样喂回 `tool` role 的 content */
  result?: string
  error?: string
}

export type { ChatMessage, ToolCall, LLMTool, LogPayload }
