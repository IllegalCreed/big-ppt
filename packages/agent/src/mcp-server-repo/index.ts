// packages/agent/src/mcp-server-repo/index.ts
/**
 * Phase 9-F：默认返 DrizzleRepo（per-user 入库）。
 * 旧 JsonFileRepo 保留代码作为回退参考（@deprecated 注释），运行时不再使用。
 */
import { DrizzleRepo } from './drizzle-repo.js'
import type { McpServerRepo } from './types.js'

let instance: McpServerRepo | null = null

export function getRepo(): McpServerRepo {
  if (!instance) {
    instance = new DrizzleRepo()
  }
  return instance
}

/** 仅测试用 */
export function __resetRepoForTesting(): void {
  instance = null
}

export type { McpServerRepo, McpServerConfig, McpServerPatch } from './types.js'
export { McpRepoNotFoundError } from './types.js'
