// packages/agent/src/mcp-server-repo/types.ts
import type { McpServerConfig } from '@big-ppt/shared'

export type { McpServerConfig }

/** 允许更新的字段:不含 id / preset(两者在运行时也会被强制保留) */
export type McpServerPatch = Partial<Omit<McpServerConfig, 'id' | 'preset'>>

export interface McpServerRepo {
  list(): Promise<McpServerConfig[]>
  get(id: string): Promise<McpServerConfig | undefined>
  create(config: McpServerConfig): Promise<void>
  update(id: string, patch: McpServerPatch): Promise<McpServerConfig>
  delete(id: string): Promise<void>
}
