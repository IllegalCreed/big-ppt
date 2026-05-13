export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/**
 * 接口协议类型。目前仅支持 OpenAI 兼容(走 /chat/completions)。
 * 预留为字面量联合,未来加 Anthropic / Gemini 原生协议时在此扩展并在 agent 路由层做协议适配分支。
 */
export type LLMApiType = 'openai-compatible'

export interface LLMSettings {
  provider: string
  apiKey: string
  model: string
  /** 自定义中转 / 兼容端点的 base URL。非自定义 provider 留空,后端按 provider 预设解析。 */
  baseUrl?: string
  /** 接口协议;留空时后端默认 'openai-compatible'。 */
  apiType?: LLMApiType
}

export type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'streaming' | 'error' | 'cancelled'

export interface ToolStep {
  key: string
  name: string
  label: string
  status: 'loading' | 'success' | 'error'
  argsPreview?: string
  error?: string
}

export interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  toolSteps?: ToolStep[]
  /**
   * Phase 12 Task I：本轮 LLM thinking 缓冲（Anthropic extended thinking 等）。
   * 仅在 assistant bubble 上有值，UI 默认折叠展示。空字符串视为无 thinking。
   */
  thinking?: string
  /**
   * Phase 12 Task I：本轮 prompt cache 命中数据（Anthropic prompt caching 触发）。
   * 仅在 assistant bubble 上有值；UI 在 bubble 下方一行小字提示节省 token。
   */
  cacheStats?: { cached: number; cost: number }
}
