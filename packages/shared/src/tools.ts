export interface ToolParametersSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

/**
 * OpenAI-compatible function tool definition.
 * Used both as the LLM-facing tool list and as the transport shape between creator and agent.
 */
export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: ToolParametersSchema
  }
}
