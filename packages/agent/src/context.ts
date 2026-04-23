/**
 * 请求级上下文（AsyncLocalStorage）。
 *
 * 在每个 HTTP 请求开始时由 auth middleware 初始化，slides-store 等底层模块
 * 从中读取当前 user/session/activeDeck/turnId，而不用把这些参数层层透传。
 *
 * 同 turn 多次写入（一个 user message 触发多次 tool_call）共享 turnId，
 * 供 deck_versions 按 turn 聚合 / UI 折叠展示。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export type RequestContext = {
  userId: number | null
  sessionId: string | null
  activeDeckId: number | null
  turnId: string | null
}

const store = new AsyncLocalStorage<RequestContext>()

const EMPTY: RequestContext = {
  userId: null,
  sessionId: null,
  activeDeckId: null,
  turnId: null,
}

/** 以给定 context 运行 fn；嵌套调用会覆盖外层（新 context 独立存储） */
export function runInRequest<T>(ctx: RequestContext, fn: () => T | Promise<T>): T | Promise<T> {
  return store.run({ ...ctx }, fn)
}

/** 当前请求上下文；若不在请求中（如测试/启动）返回全空 context */
export function getRequestContext(): RequestContext {
  return store.getStore() ?? EMPTY
}

/**
 * 动态覆写当前上下文的 turnId（由 /api/call-tool 使用）。
 *
 * AsyncLocalStorage 的 store 是引用类型，在当前 async 链里可以就地修改；
 * 并发请求各自持有独立 store，互不影响。
 */
export function setTurnId(turnId: string | null): void {
  const current = store.getStore()
  if (current) current.turnId = turnId
}

/** 动态覆写当前上下文的 activeDeckId（POST /api/activate-deck 调用后同步更新） */
export function setActiveDeckId(deckId: number | null): void {
  const current = store.getStore()
  if (current) current.activeDeckId = deckId
}

/**
 * 兼容 Phase 4 的 runInTurn helper：在新 context 里只设置 turnId，其他字段保持当前值。
 * 主要给单元测试用，生产路径通过 Hono middleware + setTurnId 覆盖。
 */
export function runInTurn<T>(turnId: string, fn: () => T | Promise<T>): T | Promise<T> {
  const parent = store.getStore()
  return store.run({ ...(parent ?? EMPTY), turnId }, fn)
}
