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

/** 仓库找不到对应 id 时抛出的专用错误,路由层据此返回 404 而非 500 */
export class McpRepoNotFoundError extends Error {
  constructor(public readonly serverId: string) {
    super(`MCP server ${serverId} not found`)
    this.name = 'McpRepoNotFoundError'
  }
}
