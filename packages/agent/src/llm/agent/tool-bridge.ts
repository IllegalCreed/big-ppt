/**
 * Phase 12.7 Task B：tool-bridge —— 把 agent 既有 `ToolDef` 适配成
 * `pi-agent-core` 的 `AgentTool<TSchema>`。
 *
 * 设计要点：
 * - **不复制工具定义**：`buildToolsForUser(userId)` 直接读现有 user-scoped
 *   registry（全局工具 + per-user MCP），每个 ToolDef wrap 一层成 AgentTool。
 *   工具的真实业务逻辑 (`ToolDef.exec`) 不变，只在 AgentTool.execute 桥接层
 *   把 args / signal 透传过去。
 * - **schema 直接 cast**：pi-agent-core `AgentTool.parameters` 声明 `TSchema`
 *   (typebox)，但内部 `validateToolArguments` 在 `!hasTypeBoxMetadata(schema)`
 *   分支下接受 raw JSON Schema 并做 coerce。我们的 `ToolDef.parameters` 本就
 *   是 JSON Schema，`as unknown as TSchema` 通过类型门即可（与
 *   `packages/agent/src/llm/adapters/pi-ai-adapter.ts` 同套路）。
 * - **execute 返回 `AgentToolResult<unknown>`**：
 *   - `content: (TextContent | ImageContent)[]` —— 把 `ToolDef.exec` 的
 *     `string` 返回包成单个 TextContent；未来扩多模态返回可以走
 *     `normalizeToolResultBlocks` 升级（plan 中预留）。
 *   - `details`: 透传 raw string 给 UI 渲染层（pi-agent-core 不强制 shape）。
 *   - `terminate`: 当前 ToolDef 协议不支持，留作未来扩展（image-gen 终态
 *     工具的 prompt 强制让 LLM 看到失败信息后停止）。
 * - **错误传播**：pi-agent-core 约定 `AgentTool.execute` throw on failure；
 *   loop 内部会把 throw 翻成 isError=true 的 ToolResultMessage，UI 路径
 *   仍能渲染失败状态。我们这里直接 propagate `ToolDef.exec` 的抛错。
 */

import type {
  AgentTool,
  AgentToolResult,
} from '@earendil-works/pi-agent-core'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import type { TSchema } from 'typebox'
import { getRegistry } from '../../mcp-registry/index.js'
import {
  executeToolForUser,
  listToolDefsForUser,
  type ToolDef,
} from '../../tools/registry.js'

/**
 * 把单个 `ToolDef` wrap 成 pi-agent-core 的 `AgentTool`。
 *
 * 关键：`execute` 回调闭包 `userId`、`toolName` 给 `executeToolForUser`，
 * args / signal 由 pi-agent-core 在 loop 内部传入。
 */
function wrapToolDef(userId: number, def: ToolDef): AgentTool<TSchema, unknown> {
  return {
    name: def.name,
    description: def.description ?? '',
    // 详见上面 design note。pi-ai validateToolArguments 内部对 raw JSON Schema
    // 走 coerce + Compile 分支，typebox marker 不存在也能 validate。
    parameters: def.parameters as unknown as TSchema,
    label: def.name,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      // params 是 pi-agent-core 走 validateToolArguments 后的 coerced 值。
      // 这里再 cast 一次保留 ToolDef.exec 的 (args: Record) 签名兼容老链路。
      const args = (params ?? {}) as Record<string, unknown>
      const raw = await executeToolForUser(userId, def.name, args, signal)
      return {
        content: normalizeToolResultBlocks(raw),
        details: raw,
      }
    },
  }
}

/**
 * 统一把 `ToolDef.exec` 的返回值压成 `(TextContent | ImageContent)[]`。
 *
 * 当前 `ToolDef.exec` 协议固定返回 `string`，所以走 string → 单 TextContent。
 * 留 array / object fallback 让未来扩 ToolDef 时（比如要返回 image / 结构化
 * 数据）有 single source 改一处。**注意**：plan 假设的"3 shape"在当前
 * registry 下只 1 种活跃，array / fallback 分支属于防御性 future-proof，
 * 单测会覆盖 string + 边界异常 shape。
 */
export function normalizeToolResultBlocks(
  raw: unknown,
): (TextContent | ImageContent)[] {
  if (typeof raw === 'string') {
    return [{ type: 'text', text: raw }]
  }
  if (Array.isArray(raw)) {
    // 已经是 Block-shape array 直接透传（未来扩展）；
    // 校验最低限度 type 字段存在让 Tool 想自己拼 ImageContent 也兼容。
    const blocks = raw.filter(
      (b): b is TextContent | ImageContent =>
        typeof b === 'object' &&
        b !== null &&
        'type' in b &&
        (b.type === 'text' || b.type === 'image'),
    )
    if (blocks.length > 0) return blocks
    // 退化到 JSON.stringify
    return [{ type: 'text', text: JSON.stringify(raw) }]
  }
  // 任何其他对象 / 数字 / null —— 转字符串
  return [{ type: 'text', text: JSON.stringify(raw) }]
}

/**
 * 入口：列出该 user 全部可用 ToolDef（全局 + per-user MCP），每个 wrap 成
 * `AgentTool`。供 `createAgent` 在 Task C 注入 `initialState.tools`。
 *
 * **async**：与 `/api/tools` 路由保持一致——先确保 MCP server 工具已注册到
 * 该 user 分区（首次访问 connect + listTools），再 enumerate registry。
 */
export async function buildToolsForUser(
  userId: number,
): Promise<AgentTool<TSchema, unknown>[]> {
  await getRegistry(userId).ensureInitialized()
  return listToolDefsForUser(userId).map((def) => wrapToolDef(userId, def))
}
