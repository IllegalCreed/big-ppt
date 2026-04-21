export interface LogPayload {
  /** 事件种类：user_message / llm_request / llm_response / tool_call / tool_result / session_end / browser_error / browser_warn */
  kind: string
  /** 显式 session 会覆盖调用方设置的 currentSession */
  session?: string
  /** 若存在，后端将另存到 logs/payloads/<session>/，索引只保留文件引用 */
  payload?: unknown
  [k: string]: unknown
}
