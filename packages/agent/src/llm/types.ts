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
