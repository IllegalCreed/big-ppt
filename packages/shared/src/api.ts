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

export type { ChatMessage, ToolCall, LLMTool, LogPayload }
