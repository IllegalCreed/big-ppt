/**
 * Phase 12 Task D：canonical event SSE wire format re-export 入口(agent 端)。
 *
 * 真正的实现在 `@big-ppt/shared/llm-sse.ts`(single source of truth)。
 * 本文件存在的意义跟 Task B 的 types.ts 同款:
 *
 * - 同包内 routes / 测试 `import { encodeSSEFrame } from '../llm/canonical-sse.js'`
 *   比 `import from '@big-ppt/shared'` 更短更直观
 * - 未来若 agent 需要 backend-only 的 SSE 工具函数(如带 keep-alive ping),
 *   在本文件追加,**不**回填到 shared
 *
 * Why source 在 shared:frontend(creator)也要直接用 `decodeSSEStream`,
 * 若放 agent 则 creator → agent 跨包源码 import 触发 NodeNext rootDir 限制。
 * 反过来 shared 当 source、agent 当 re-export 零摩擦(Task B 同款退化方案)。
 */

export {
  encodeSSEFrame,
  eventsToSSEStream,
  decodeSSEStream,
  parseSSEFrame,
} from '@big-ppt/shared'
