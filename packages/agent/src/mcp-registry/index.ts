// packages/agent/src/mcp-registry/index.ts
import { getRepo } from '../mcp-server-repo/index.js'
import { McpRegistry } from './registry.js'

let instance: McpRegistry | null = null

export function getRegistry(): McpRegistry {
  if (!instance) {
    instance = new McpRegistry(getRepo())
  }
  return instance
}

export function __resetRegistryForTesting(): void {
  instance = null
}

export { McpRegistry }
