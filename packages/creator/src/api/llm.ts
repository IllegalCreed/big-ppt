/**
 * Phase 12 Task I：canonical LLM 流式调用 helper（frontend → agent）。
 *
 * 替代 useAIChat 内原本手工 fetch + 手工切 SSE 行的逻辑。本文件只负责：
 * - 把 `CanonicalChatRequest` 序列化为 JSON body
 * - POST `/api/llm/chat/completions`，带 session cookie + 可选 `X-Deck-Id` header
 * - 把上游错误转成可阅读的 Error（429 / 速率限制提示走友好文案）
 * - 返回 `ReadableStream<Uint8Array>`（response.body），让 caller 用
 *   `decodeSSEStream` 走 canonical event 状态机
 *
 * **Why 单独抽 helper**：和后端 `routes/llm.ts` 的 canonical 路径强耦合，未来若
 * 路径 / wire 协议小调整（如 `/api/v2/chat`、加 retry 报头）只动这一处。
 */

import type { CanonicalChatRequest } from '@big-ppt/shared'

export interface ChatStreamOptions {
  /** Phase 10.5：编辑器 fetch 必须带 X-Deck-Id 让 agent 中间件覆写 ALS activeDeckId */
  deckId?: number
  signal?: AbortSignal
}

/**
 * 发起一次 canonical 流式聊天请求。返回 raw SSE byte stream，caller 用
 * `decodeSSEStream(response.body)` 走 canonical event。
 *
 * 错误处理：
 * - 网络 / 4xx / 5xx：抛 Error，message 已经包含 user-friendly 文案（含上游 429 提示）
 * - 流式中途的 `error` event 不在本函数处理 —— 由 caller 在 decode 循环里 catch
 */
export async function chatStream(
  request: CanonicalChatRequest,
  options: ChatStreamOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  // Phase 10.5：tool 调用 + chat 主路径都得让 agent 通过 header 知道 activeDeckId
  // （session.activeDeckId 自 Phase 10.5 起恒为 null）
  if (typeof options.deckId === 'number') {
    headers['X-Deck-Id'] = String(options.deckId)
  }

  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(request),
    signal: options.signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    let errMsg = `请求失败：${response.status}`
    try {
      const errJson = JSON.parse(errText) as { error?: { message?: string } | string }
      const inner = errJson.error
      if (typeof inner === 'string') errMsg = inner
      else if (inner && typeof inner === 'object' && typeof inner.message === 'string') errMsg = inner.message
    } catch { /* ignore parse failure, keep default errMsg */ }
    // 上游 429 / 文案命中"速率限制 / 频率 / rate limit / quota" → 加前缀让用户分辨
    // 不是 Lumideck 在限流（agent LLM 代理刻意没挂 rate limit，详见 routes/llm.ts 注释）
    if (response.status === 429 || /速率限制|频率|rate.?limit|quota/i.test(errMsg)) {
      errMsg = `[LLM 服务商上游限制，稍候重试或在设置里更换 provider / 升级套餐] ${errMsg}`
    }
    throw new Error(errMsg)
  }
  if (!response.body) throw new Error('LLM 响应没有 body')

  return response.body
}
