/**
 * Phase 12 Task B：canonical 类型集——跨 agent + creator 共享的单一事实来源。
 *
 * 这里定义跨 provider 共享的中性消息 / 工具 / 事件类型;
 * agent 通过 `import type { ... } from '@big-ppt/shared'` 复用,
 * 并在 `packages/agent/src/llm/types.ts` 内 re-export 给 adapter 用,
 * **不**在 agent 端重复定义任何类型——single source of truth。
 *
 * Why 放 shared 而非 agent:agent tsconfig 用 NodeNext + 严格 rootDir,
 * shared 跨包 import agent 源码会触发 TS6059。反过来让 shared 当 source,
 * agent re-export 没有任何路径限制问题(plan §Task B 第 4 步退化方案)。
 *
 * 设计原则:
 * - **Block-based message shape**:`content: Block[]`,Claude 的
 *   thinking + text + tool_use 顺序敏感需要 block 原生表达,
 *   多模态 / 结构化输出 / 未来 audio 也走 block(plan §关键设计抉择 #4)。
 * - **canonical event SSE wire format**(8 类):`text.delta` /
 *   `tool_call.start|delta|end` / `thinking.delta` / `cache.hit` /
 *   `finish` / `error`。OpenAI delta 装不下 thinking + cache(plan §关键设计抉择 #3)。
 */

export type CanonicalRole = 'system' | 'user' | 'assistant' | 'tool'

export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = { type: 'image'; mediaType: string; dataBase64: string }
export type ThinkingBlock = { type: 'thinking'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ToolResultBlock = {
  type: 'tool_result'
  toolUseId: string
  content: string | Block[]
  isError?: boolean
}
export type Block = TextBlock | ImageBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

export type CanonicalMessage = {
  role: CanonicalRole
  content: Block[]
  cacheControl?: { type: 'ephemeral' }
}

export type ToolDef = {
  /** MCP 工具名沿用 `mcp__<serverId>__<toolName>` 格式,三家 provider 都允许 `[a-zA-Z0-9_-]{1,64}`(plan §关键设计抉择 #7)。 */
  name: string
  description: string
  /** JSON Schema(三家 provider 的 tool input schema 都派生自 JSON Schema)。 */
  inputSchema: Record<string, unknown>
}

export type CanonicalChatRequest = {
  messages: CanonicalMessage[]
  tools?: ToolDef[]
  temperature?: number
  maxTokens?: number
  topP?: number
  stopSequences?: string[]
  thinking?: { enabled: boolean; budgetTokens?: number }
  structuredOutput?: { schema: Record<string, unknown> }
}

export type TokenUsage = {
  input: number
  output: number
  cached?: number
  /**
   * Phase 12.5:pi-ai 返回的成本数据(USD 浮点数)。
   * frontend 渲染时按 USD_TO_RMB = 7.2 换算成 ¥ 显示。
   *
   * 注:pi-ai 0.74.0 实际字段是 cacheRead / cacheWrite(不是 spec 假设的
   * cachedRead / cachedWrite),Task B 已 verified。如未来 pi-ai 升级改字段,
   * 这里同步改。
   */
  cost?: {
    total: number
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
}
export type FinishReason = 'stop' | 'length' | 'tool_use' | 'content_filter'

export type CanonicalEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call.start'; id: string; name: string }
  | { type: 'tool_call.delta'; id: string; argsChunk: string }
  | { type: 'tool_call.end'; id: string }
  | { type: 'thinking.delta'; text: string }
  | { type: 'cache.hit'; cachedTokens: number; costTokens: number }
  | { type: 'finish'; reason: FinishReason; usage: TokenUsage }
  | { type: 'error'; code: string; message: string }
