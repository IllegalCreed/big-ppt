/** Phase 12.7 Task F：POST /api/chat/turn —— pi-agent-core 驱动的 agent loop SSE 端点。 */
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import type { AuthVars } from '../middleware/auth.js'
import { acquireLlmSlot, LlmConcurrencyTimeoutError } from '../middleware/llm-semaphore.js'
import { createAgent } from '../llm/agent/index.js'
import { translateAgentStream } from '../llm/agent/translate-events.js'
import { eventsToSSEStream } from '../llm/canonical-sse.js'
import { LLMError } from '../llm/errors.js'
import { getDb, decks } from '../db/index.js'
import { logServerEvent } from '../logger/server-log.js'

/**
 * Testing seam:让集成测注入 fake createAgent 而不打真上游 LLM SDK。
 * 跟 routes/llm.ts 的 `__setRegistryForTesting` 同套路。
 */
let _createAgent: typeof createAgent = createAgent
export function __setCreateAgentForTesting(fn: typeof createAgent | null): void {
  _createAgent = fn ?? createAgent
}

export const chat = new Hono<{ Variables: AuthVars }>()

chat.post('/turn', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)
  if (!user.llmSettings) {
    return c.json({ error: { message: '请先在设置中配置 LLM API Key' } }, 400)
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    deckId?: unknown
    message?: unknown
  }
  const deckId = Number(body.deckId)
  if (!body.deckId || !Number.isFinite(deckId) || deckId <= 0) {
    return c.json({ error: { message: 'deckId 必填' } }, 400)
  }
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    return c.json({ error: { message: 'message 必填' } }, 400)
  }

  // 验权:用户拥有该 deck(防止跨用户读改他人 deck)
  const [deck] = await getDb()
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, user.id)))
    .limit(1)
  if (!deck) return c.json({ error: { message: 'deck not found' } }, 404)

  // 拿 LLM slot:超过 per-user 并发上限会 await 排队;超过队列超时才 reject。
  let release: () => void
  try {
    release = await acquireLlmSlot(user.id)
  } catch (e) {
    if (e instanceof LlmConcurrencyTimeoutError) {
      return c.json({ error: { message: e.message } }, 503)
    }
    throw e
  }

  // createAgent 失败(LLM settings 损坏 / parse 失败) → release slot + 400。
  // 注意 Task E 已从 CreateAgentOpts 移除 signal 字段,signal 通过下面
  // addEventListener('abort') 接到返回的 agent.abort() 上。
  let agent
  try {
    agent = await _createAgent({
      userId: user.id,
      deckId,
      encryptedSettings: user.llmSettings,
    })
  } catch (e) {
    release()
    logServerEvent({
      category: 'agent',
      event: 'create-failed',
      userId: user.id,
      deckId,
      errorMsg: (e as Error).message,
    })
    // 不外泄 createAgent 内部错(crypto decipher / SDK init / zod issues 可能含
    // 实现细节英文);用户友好 message 中文化,详细错文落 server-log 给运营查。
    return c.json({ error: { message: '创建 AI 会话失败，请检查 LLM 配置' } }, 400)
  }

  // 客户端断开(刷新 / 取消 / 关 tab) → c.req.raw.signal abort → agent.abort()。
  // agent.abort() 内部会取消正在跑的 LLM stream + 终结当前 run。
  const clientSignal = c.req.raw.signal
  clientSignal.addEventListener('abort', () => agent.abort())

  // translateAgentStream 把 push-based AgentEvent 翻成 canonical pull-based stream;
  // try/catch 落 logServerEvent 给运营事后排查,finally 必释 slot 不依赖 caller。
  const events = (async function* () {
    try {
      yield* translateAgentStream(agent, message)
    } catch (e) {
      logServerEvent({
        category: 'agent',
        event: 'turn-failed',
        userId: user.id,
        deckId,
        code: e instanceof LLMError ? e.code : 'unknown',
        errorMsg: (e as Error).message,
      })
      throw e
    } finally {
      release()
    }
  })()

  const stream = eventsToSSEStream(events)
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})
