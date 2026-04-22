// packages/agent/src/mcp-server-repo/index.ts
import { JsonFileRepo } from './json-file-repo.js'
import type { McpServerRepo } from './types.js'
import { getPaths } from '../workspace.js'

let instance: McpServerRepo | null = null

export function getRepo(): McpServerRepo {
  if (!instance) {
    instance = new JsonFileRepo(getPaths().mcpConfigPath)
  }
  return instance
}

/** 仅测试用 */
export function __resetRepoForTesting(): void {
  instance = null
}

export type { McpServerRepo, McpServerConfig, McpServerPatch } from './types.js'
export { McpRepoNotFoundError } from './types.js'
