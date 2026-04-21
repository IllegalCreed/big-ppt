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

export interface LLMSettings {
  provider: string
  apiKey: string
  model: string
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
}
