import type { LLMTool } from '@big-ppt/shared'

export interface ToolDef {
  name: string
  description?: string
  parameters: LLMTool['function']['parameters']
  exec: (args: Record<string, unknown>) => Promise<string>
}

/**
 * Phase 9-F：tool registry 拆"全局工具" + "per-user 工具"分区。
 *
 * - 全局：本地 12 工具（read_slides / write_slides / edit_slides + 4 件套 create/update/delete/reorder_slide / switch_template / read_template / generate_slide_image / list_uploaded_files / read_uploaded_file。Phase 11.6 删 list_templates;Phase 13 加 list_uploaded_files + read_uploaded_file。）
 *   + slidev 操作四件套，全用户共享同一份代码
 * - per-user：MCP 工具 `mcp__<serverId>__<toolName>`，由 mcp-registry/registry.ts 在该 user 启用 server 后注册
 *
 * 同一 serverId 在不同 user 下注册的"同名"工具不冲突（属于不同 user 的分区）。
 * AI prompt 看到的工具名仍是 `mcp__<serverId>__<toolName>`，不暴露 userId。
 */

const globalRegistry = new Map<string, ToolDef>()
const userRegistries = new Map<number, Map<string, ToolDef>>()

export function register(def: ToolDef): void {
  if (globalRegistry.has(def.name)) {
    throw new Error(`[tool-registry] duplicate global tool name: ${def.name}`)
  }
  globalRegistry.set(def.name, def)
}

export function registerForUser(userId: number, def: ToolDef): void {
  let userMap = userRegistries.get(userId)
  if (!userMap) {
    userMap = new Map()
    userRegistries.set(userId, userMap)
  }
  if (userMap.has(def.name)) {
    throw new Error(`[tool-registry] duplicate user tool name (user=${userId}): ${def.name}`)
  }
  userMap.set(def.name, def)
}

export function unregisterForUser(userId: number, name: string): boolean {
  const userMap = userRegistries.get(userId)
  if (!userMap) return false
  const ok = userMap.delete(name)
  if (userMap.size === 0) userRegistries.delete(userId)
  return ok
}

export function getTool(name: string, userId?: number): ToolDef | undefined {
  const local = globalRegistry.get(name)
  if (local) return local
  if (userId != null) {
    const userMap = userRegistries.get(userId)
    if (userMap) return userMap.get(name)
  }
  return undefined
}

export function listTools(userId?: number): LLMTool[] {
  const all: ToolDef[] = [...globalRegistry.values()]
  if (userId != null) {
    const userMap = userRegistries.get(userId)
    if (userMap) all.push(...userMap.values())
  }
  return all.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }))
}

export function hasTool(name: string, userId?: number): boolean {
  return getTool(name, userId) !== undefined
}

/**
 * Phase 12.7 Task B：返回该 user 视角下全部 `ToolDef`(全局 + per-user)。
 *
 * 跟 `listTools(userId)` 区别:listTools 返回 LLMTool wire shape(OpenAI 工具
 * schema),供 /api/tools 路由透出给前端 / LLM;`listToolDefsForUser` 返回内部
 * ToolDef(含 exec 回调),供 pi-agent-core AgentTool 桥接(`buildToolsForUser`)
 * 直接 wrap exec。前端永远拿不到也不应感知 exec。
 */
export function listToolDefsForUser(userId: number): ToolDef[] {
  const all: ToolDef[] = [...globalRegistry.values()]
  const userMap = userRegistries.get(userId)
  if (userMap) all.push(...userMap.values())
  return all
}

/**
 * Phase 12.7 Task B：按 (userId, toolName, args) 执行工具。
 *
 * 仅是 `getTool(name, userId).exec(args)` 的命名包装;有独立函数让
 * `vi.spyOn(registry, 'executeToolForUser')` 在 tool-bridge 单测里可以直接
 * stub,避免去 mock 内部 Map。`signal` 暂未传入老 `ToolDef.exec` 签名(后者
 * 老链路不接 signal),但保留参数让未来扩 ToolDef shape 不破 API。
 *
 * 找不到工具直接抛错(pi-agent-core 的 `AgentTool.execute` 约定 throw on
 * failure,loop 内部会把 throw 翻译成 isError=true 的 ToolResultMessage)。
 */
export async function executeToolForUser(
  userId: number,
  toolName: string,
  args: Record<string, unknown>,
  _signal?: AbortSignal,
): Promise<string> {
  const tool = getTool(toolName, userId)
  if (!tool) {
    throw new Error(`[tool-registry] tool not found: ${toolName} (user=${userId})`)
  }
  return tool.exec(args)
}

/** 删除一个全局工具（用于本地工具热卸载，目前未用；保留对称 API） */
export function unregister(name: string): boolean {
  return globalRegistry.delete(name)
}

/** 仅测试用：清空全局 + 所有 user 注册分区 */
export function __resetRegistry(): void {
  globalRegistry.clear()
  userRegistries.clear()
}

/** 仅测试用：清空指定 user 的分区（mcp-registry LRU evict 时调） */
export function __resetUserRegistry(userId: number): void {
  userRegistries.delete(userId)
}
