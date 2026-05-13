/**
 * Phase 12 Task B：canonical 类型 re-export 入口(agent 端)。
 *
 * 真正的类型定义在 `@big-ppt/shared/llm-canonical.ts`(single source of truth)。
 * 本文件存在的意义:
 *
 * - 同包内 adapter / translate 层 `import './types.js'` 风格保持一致
 *   (不必处处写 `@big-ppt/shared`)。
 * - 未来若 agent 需要扩展 backend-only 的子类型(如内部 streaming 状态机
 *   tag),在本文件追加,**不**回填到 shared。
 *
 * Why source-of-truth 放 shared 不放 agent:agent tsconfig 用严格 rootDir,
 * shared 跨包 import agent 源码触发 TS6059;反过来 agent re-export shared
 * 零摩擦(plan §Task B 第 4 步退化方案)。
 */

export type {
  Block,
  TextBlock,
  ImageBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  CanonicalMessage,
  CanonicalRole,
  CanonicalChatRequest,
  CanonicalEvent,
  TokenUsage,
  FinishReason,
  ToolDef,
} from '@big-ppt/shared'

/**
 * Exhaustiveness helper:translate 层在 `switch(block.type)` / `switch(event.type)`
 * 末尾调 `assertNever(x)` —— 加新 Block / Event 类型而未覆盖分支时 TS 立刻报错
 * (x 必须是 never,否则编译期红测)。运行时永远不应跑到这里;一旦跑到说明
 * union 类型扩展了但 switch 没补 case,抛错而非 silent drop 让 bug 立刻浮现。
 *
 * 在 types.ts hoist 让 Task C/G/H 三个 translate 模块共享同一份 helper。
 */
export function assertNever(x: never): never {
  throw new Error(`unexpected union member: ${JSON.stringify(x)}`)
}
