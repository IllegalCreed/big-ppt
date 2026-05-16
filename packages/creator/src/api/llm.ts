/** Phase 12.7 Task G：renamed chatStream → chatStreamLegacy —— agent loop 走 api/chat.ts。 */

import type { CanonicalChatRequest } from '@big-ppt/shared'

export interface ChatStreamOptions {
  /** Phase 10.5：编辑器 fetch 必须带 X-Deck-Id 让 agent 中间件覆写 ALS activeDeckId */
  deckId?: number
  signal?: AbortSignal
}

/**
 * Phase 12.7 起改名 `chatStreamLegacy`：仍走 POST `/api/llm/chat/completions`
 * 的非 agent 单轮路径，留给 Settings 健康检查等不需要 agent loop 的调用方。
 *
 * agent loop 路径请用 `api/chat.ts` 的 `chatTurn(...)`。
 */
export async function chatStreamLegacy(
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
