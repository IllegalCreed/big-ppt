// packages/agent/src/mcp-registry/index.ts
/**
 * Phase 9-F：MCP registry per-user 化（A01 修复）。
 *
 * 之前是单 singleton：所有用户共用同一份 connection pool + 共用全局工具命名空间。
 * 改为 Map<userId, McpRegistry>，每用户独立 connection pool；
 * LRU 上限 100 防内存泄漏（dev/MVP 场景够；P11 多用户压测时再调）。
 *
 * 工具命名 `mcp__<serverId>__<toolName>` 保持不变；tools/registry.ts 用 user-scoped 注册分区，
 * 所以同一 serverId 在不同 user 下注册的"同名"工具不冲突（属于不同 user 的分区）。
 */
import { getRepo } from '../mcp-server-repo/index.js'
import { McpRegistry } from './registry.js'

const MAX_USERS = 100

const registries = new Map<number, McpRegistry>()
const lruOrder: number[] = []

function touch(userId: number): void {
  const idx = lruOrder.indexOf(userId)
  if (idx >= 0) lruOrder.splice(idx, 1)
  lruOrder.push(userId)
}

async function evictLeastRecent(): Promise<void> {
  const oldest = lruOrder.shift()
  if (oldest == null) return
  const reg = registries.get(oldest)
  registries.delete(oldest)
  if (reg) {
    try {
      await reg.shutdown()
    } catch (err) {
      console.warn('[mcp-registry] LRU evict shutdown error:', (err as Error).message)
    }
  }
}

export function getRegistry(userId: number): McpRegistry {
  let reg = registries.get(userId)
  if (!reg) {
    if (registries.size >= MAX_USERS) {
      // fire-and-forget：evict 不阻塞当前请求
      void evictLeastRecent()
    }
    reg = new McpRegistry(getRepo(), userId)
    registries.set(userId, reg)
  }
  touch(userId)
  return reg
}

/** 仅测试用：清空所有 user registry（无 await，调用方按需 await reg.shutdown） */
export function __resetRegistryForTesting(): void {
  for (const reg of registries.values()) {
    void reg.shutdown().catch(() => undefined)
  }
  registries.clear()
  lruOrder.length = 0
}

/** 仅测试用：直接看当前内存里有哪些 user 的 registry */
export function __getRegistryUserIdsForTesting(): number[] {
  return [...lruOrder]
}

export { McpRegistry }
