/** Phase 12.7 Task G：POST /api/chat/turn 的瘦 helper —— agent loop 路径专用。 */

export interface ChatTurnRequest {
  deckId: number
  message: string
}

export interface ChatTurnOptions {
  signal?: AbortSignal
}

/**
 * 发起 agent loop SSE 请求（pi-agent-core 在后端跑工具循环，frontend 仅消费 canonical event）。
 *
 * - 走 cookie 会话；body 带 deckId 让后端做 ownership 校验。
 * - 同步带 `X-Deck-Id` header：后端 request-context middleware 据此写 ALS
 *   activeDeckId，下游 write_slides / generate_slide_image 等工具通过
 *   `ctx.activeDeckId` 读到（Phase 10.5 后 session.activeDeckId 恒 null，必经此路径）。
 * - 错误（4xx / 5xx）抛 Error，message 已经是用户友好文案。
 * - 流式中途的 `error` event 不在此处处理，由 caller 在 decode 循环内 catch。
 */
export async function chatTurn(
  req: ChatTurnRequest,
  options: ChatTurnOptions = {},
): Promise<Response> {
  const res = await fetch('/api/chat/turn', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Deck-Id': String(req.deckId),
    },
    body: JSON.stringify({ deckId: req.deckId, message: req.message }),
    signal: options.signal,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string }
    let msg = `chat/turn failed: ${res.status}`
    const inner = body.error
    if (typeof inner === 'string') msg = inner
    else if (inner && typeof inner === 'object' && typeof inner.message === 'string') msg = inner.message
    throw new Error(msg)
  }
  return res
}
