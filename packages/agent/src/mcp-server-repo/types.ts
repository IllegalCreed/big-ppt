// packages/agent/src/mcp-server-repo/types.ts
import type { McpServerConfig } from '@big-ppt/shared'

export type { McpServerConfig }

/** 允许更新的字段:不含 id / preset(两者在运行时也会被强制保留) */
export type McpServerPatch = Partial<Omit<McpServerConfig, 'id' | 'preset'>>

/**
 * Phase 9-F：所有方法加 `userId` 参数 —— per-user 隔离（A01 修复）。
 * 同一 serverId 在不同 user 视角下是独立的记录。
 */
export interface McpServerRepo {
  list(userId: number): Promise<McpServerConfig[]>
  get(userId: number, serverId: string): Promise<McpServerConfig | undefined>
  create(userId: number, config: McpServerConfig): Promise<void>
  update(userId: number, serverId: string, patch: McpServerPatch): Promise<McpServerConfig>
  delete(userId: number, serverId: string): Promise<void>
}

/** 仓库找不到对应 id 时抛出的专用错误,路由层据此返回 404 而非 500 */
export class McpRepoNotFoundError extends Error {
  constructor(public readonly serverId: string) {
    super(`MCP server ${serverId} not found`)
    this.name = 'McpRepoNotFoundError'
  }
}
