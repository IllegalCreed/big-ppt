import type { LLMTool } from '@big-ppt/shared'

export interface ToolDef {
  name: string
  description?: string
  parameters: LLMTool['function']['parameters']
  exec: (args: Record<string, unknown>) => Promise<string>
}

const registry = new Map<string, ToolDef>()

export function register(def: ToolDef): void {
  if (registry.has(def.name)) {
    throw new Error(`[tool-registry] duplicate tool name: ${def.name}`)
  }
  registry.set(def.name, def)
}

export function getTool(name: string): ToolDef | undefined {
  return registry.get(name)
}

export function listTools(): LLMTool[] {
  return Array.from(registry.values()).map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }))
}

export function hasTool(name: string): boolean {
  return registry.has(name)
}

/** 仅测试用：清空注册表 */
export function __resetRegistry(): void {
  registry.clear()
}
