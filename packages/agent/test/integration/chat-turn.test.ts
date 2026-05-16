/**
 * Phase 12.7 Task F：POST /api/chat/turn 集成测(9 case,真 lumideck_test DB)。
 *
 * 不走真 LLM SDK,通过 `__setCreateAgentForTesting` 注入 fake createAgent;
 * fake agent 实现 subscribe / prompt / abort 三件套(签名跟真 Agent 一致),
 * 按脚本推 AgentEvent 走完 translateAgentStream 全链路。
 *
 * 覆盖契约:
 * - HTTP 状态码:401 / 400(无 llmSettings / deckId / message)/ 404(deck 跨用户)/
 *   503(并发排队超时)/ 200(SSE)
 * - SSE wire format 正确(用 Task D 的 decodeSSEStream parse)+ canonical event 序列保真
 * - clientSignal.abort() 反向传播到 agent.abort() + slot 释放
 * - agent_end subscribe 触发 persistTurnToDeckChats 写真 deck_chats 行(test 9)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { useTestDb } from '../_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from '../_setup/factories.js'
import { getDb, deckChats, users } from '../../src/db/index.js'
import { chat, __setCreateAgentForTesting } from '../../src/routes/chat.js'
import { authOptional, type AuthVars } from '../../src/middleware/auth.js'
import {
  __resetLlmSemaphoreForTesting,
  __getLlmSemaphoreStateForTesting,
  acquireLlmSlot,
} from '../../src/middleware/llm-semaphore.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../../src/crypto/apikey.js'
import { decodeSSEStream } from '../../src/llm/canonical-sse.js'
import { persistTurnToDeckChats } from '../../src/llm/agent/persistence.js'
import { agentMessageToCanonical } from '../../src/llm/agent/agent-message.js'
import type { CanonicalEvent } from '../../src/llm/types.js'
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'

const FIXED_KEY = Buffer.alloc(32, 0xab)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  // 必须复位:_keyGetter 是模块级 mutable state,本文件 beforeAll 注入 FIXED_KEY,
  // 不在 afterAll 还原会污染后续 test 文件(后续测试用 env APIKEY_MASTER_KEY
  // 加密但用本文件 FIXED_KEY 解密 → 解密失败 / 行为漂移)。Phase 12.7 Task H 发现。
  __setMasterKeyGetterForTesting(null)
})

afterEach(() => {
  __resetLlmSemaphoreForTesting()
  __setCreateAgentForTesting(null)
  vi.restoreAllMocks()
})

beforeEach(() => {
  __resetLlmSemaphoreForTesting()
})

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  // mount path 与 prod 一致(`app.route('/api/chat', chat)`)
  app.route('/api/chat', chat)
  return app
}

/** 给 user 写一份合法 llmSettings(加密 JSON) */
async function setLlmSettings(userId: number) {
  await getDb()
    .update(users)
    .set({
      llmSettings: encryptApiKey(
        JSON.stringify({
          activeProvider: 'zhipu',
          providers: { zhipu: { apiKey: 'sk-test', model: 'GLM-5.1' } },
        }),
      ),
    })
    .where(eq(users.id, userId))
}

/** 构造 minimal AssistantMessage(translate 层只读 usage / stopReason / content) */
function assistantMsg(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'zhipu',
    model: 'GLM-5.1',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  }
}

/**
 * Fake Agent 工厂:实现 subscribe / prompt / abort,按脚本推 AgentEvent。
 *
 * `extraSubscribe`:用于 test 9 —— 让 fake 也注册一份真 persistTurnToDeckChats
 * 监听器,验 agent_end 后能写 DB。route 内 translate 层 + 测试代码同时 subscribe,
 * 都会被 prompt() 内的 for-loop 推送。
 *
 * 暴露 `captured.promptDone` Promise:外部可 `await` 它替代 wall-clock sleep,
 * deterministic 收尾(等所有 subscribe handler 跑完 + DB insert flush)。
 */
function makeFakeAgent(opts: {
  events: AgentEvent[]
  /** 注入额外 subscribe handler(test 9 用,模拟真 createAgent 内部 persist 监听) */
  extraSubscribe?: (event: AgentEvent) => Promise<void> | void
  /** infinite=true 时 prompt 持续推 text.delta 直到 abort(测 abort 释槽) */
  infinite?: boolean
}) {
  type Listener = (event: AgentEvent, signal: AbortSignal) => void | Promise<void>
  const handlers: Listener[] = []
  const abortController = new AbortController()
  let resolvePromptDone!: () => void
  const promptDone = new Promise<void>((r) => {
    resolvePromptDone = r
  })
  const captured = {
    aborted: false,
    promptCalled: false,
    promptArg: '' as string,
    promptDone,
  }

  const agent = {
    subscribe(handler: Listener) {
      handlers.push(handler)
      return () => {
        const i = handlers.indexOf(handler)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    async prompt(p: string) {
      captured.promptCalled = true
      captured.promptArg = p
      try {
        if (opts.infinite) {
          let i = 0
          while (!abortController.signal.aborted) {
            const e: AgentEvent = {
              type: 'message_update',
              message: assistantMsg(),
              assistantMessageEvent: {
                type: 'text_delta',
                contentIndex: 0,
                delta: `chunk ${++i}`,
                partial: assistantMsg(),
              },
            }
            for (const h of handlers) await h(e, abortController.signal)
            await new Promise((r) => setTimeout(r, 5))
          }
          return
        }
        for (const e of opts.events) {
          // await 每个 handler 完成 —— 包括 extraSubscribe 里的 persistTurnToDeckChats
          // (Test 9 依赖这条保证 DB insert 在 promptDone resolve 之前已 flush)
          for (const h of handlers) await h(e, abortController.signal)
          await Promise.resolve()
        }
      } finally {
        resolvePromptDone()
      }
    },
    abort() {
      captured.aborted = true
      abortController.abort()
    },
    sessionId: 'lumideck:user-x:deck-x',
    toolExecution: 'parallel' as const,
  } as unknown as Agent

  if (opts.extraSubscribe) {
    agent.subscribe(opts.extraSubscribe)
  }

  return { agent, captured }
}

async function collectSSE(res: Response): Promise<CanonicalEvent[]> {
  if (!res.body) return []
  const out: CanonicalEvent[] = []
  for await (const evt of decodeSSEStream(res.body)) out.push(evt)
  return out
}

// --- tests --------------------------------------------------------------

describe('POST /api/chat/turn(pi-agent-core driven)', () => {
  it('未登录 → 401', async () => {
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId: 1, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('unauthorized')
  })

  it('已登录但未配 llmSettings → 400 + 中文 message', async () => {
    const { cookie } = await createLoggedInUser('no-llm@a.com')
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: 1, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('请先在设置中配置 LLM API Key')
  })

  it('body 缺 deckId → 400', async () => {
    const { user, cookie } = await createLoggedInUser('no-deck@a.com')
    await setLlmSettings(user.id)
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('deckId 必填')
  })

  it('body 缺 message(或空字符串) → 400', async () => {
    const { user, cookie } = await createLoggedInUser('no-msg@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: deck.id, message: '   ' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('message 必填')
  })

  it('deckId 属于其他用户 → 404', async () => {
    const { user: a, cookie: cookieA } = await createLoggedInUser('a@a.com')
    const { user: b } = await createLoggedInUser('b@a.com')
    await setLlmSettings(a.id)
    // deck 归属 b,但 a 用 a 的 cookie 请求
    const { deck } = await createDeckDirect(b.id)
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('deck not found')
  })

  it('LLM concurrency timeout(slot 拿不到) → 503', async () => {
    const { user, cookie } = await createLoggedInUser('timeout@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)

    process.env.LLM_QUEUE_TIMEOUT_MS = '50'
    try {
      // 占满 2 slot(默认 limit=2),让本次 acquireLlmSlot 排队 + 50ms 超时
      await acquireLlmSlot(user.id)
      await acquireLlmSlot(user.id)
      expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 2, queueLen: 0 })

      // fake createAgent 不应被调到（slot 拿不到先 503 短路）
      const createSpy = vi.fn()
      __setCreateAgentForTesting(createSpy)

      const res = await buildApp().fetch(
        new Request('http://x/api/chat/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
        }),
      )
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toMatch(/LLM 并发排队超时/)
      expect(createSpy).not.toHaveBeenCalled()
    } finally {
      delete process.env.LLM_QUEUE_TIMEOUT_MS
    }
  })

  it('happy path:fake agent yield agent_start + text_delta + agent_end → SSE 流含 turn.start / text.delta / turn.end', async () => {
    const { user, cookie } = await createLoggedInUser('happy@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)

    const scripted: AgentEvent[] = [
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: assistantMsg(),
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Hello',
          partial: assistantMsg(),
        },
      },
      { type: 'agent_end', messages: [assistantMsg()] },
    ]
    const { agent, captured } = makeFakeAgent({ events: scripted })
    __setCreateAgentForTesting(async () => agent)

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')

    const decoded = await collectSSE(res)
    expect(decoded.map((e) => e.type)).toEqual(['turn.start', 'text.delta', 'turn.end'])
    expect((decoded[1] as { text: string }).text).toBe('Hello')

    // route 内确实把用户原始 message 透传给 agent.prompt
    expect(captured.promptCalled).toBe(true)
    expect(captured.promptArg).toBe('hi')

    // SSE 流跑完,slot 已 release
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 0, queueLen: 0 })
  })

  it('client AbortSignal abort → agent.abort() 触发(端到端 wire c.req.raw.signal → agent)', async () => {
    const { user, cookie } = await createLoggedInUser('abort@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)

    // fake agent infinite=true:生产里 LLM stream 持续推 text 直到 client 断开;
    // 这里 fake 也跑 while 循环,abort 后 prompt 才 return,模拟 SDK abort 行为。
    const { agent, captured } = makeFakeAgent({ events: [], infinite: true })
    __setCreateAgentForTesting(async () => agent)

    // 用 AbortController.signal 进 Request,route 内 `c.req.raw.signal` 就是这个 signal。
    // 调 ctrl.abort() 直接走 route 内 `clientSignal.addEventListener('abort', () => agent.abort())`,
    // 端到端验「客户端断开信号 → agent loop 取消」契约。
    const ctrl = new AbortController()
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
        signal: ctrl.signal,
      }),
    )
    expect(res.status).toBe(200)

    // 消费一个 chunk 让 SSE stream + agent.prompt() 跑起来(SSE stream lazy,
    // start 在 first read 才触发,这时 slot 也已 active=1)。
    const reader = res.body!.getReader()
    await reader.read()
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 1, queueLen: 0 })

    // abort → addEventListener fire → agent.abort() 同步触发(本测试核心契约)。
    // Note: slot 释放路径(eventsToSSEStream cancel → iterator.return → finally
    // → release)在 happy path 已隐式覆盖;in-process app.fetch 下 reader.cancel
    // 跟 ctrl.abort 的时序与生产 fetch 不同,此处只验 signal 反向传播 → abort 契约,
    // 避免跟 Hono/undici 单测路径的 stream teardown 顺序耦合。
    ctrl.abort()
    expect(captured.aborted).toBe(true)
    // 释 reader 让 vitest 跑完不留 dangling stream;不 await(可能卡 teardown)。
    void reader.cancel('test').catch(() => {})
  })

  it('agent_end subscribe 触发 persistTurnToDeckChats → deck_chats 行落库', async () => {
    const { user, cookie } = await createLoggedInUser('persist@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)

    // 真 createAgent 内部 subscribe 写 DB,但本测不走真 LLM —— 用 fake agent
    // 同时让 fake 也注册一份等价的 subscribe handler(把 agent_end.messages 喂给
    // 真 persistTurnToDeckChats),end-to-end 验 SSE 流跑完后 deck_chats 真有行。
    //
    // pi-agent-core 的 AgentMessage 跟 canonical 不同 shape,要走 agentMessageToCanonical
    // 转一道(与真 createAgent 内 subscribe 的 mapping 一致)。
    const finalAssistant: AssistantMessage = assistantMsg({
      content: [{ type: 'text', text: 'hello from agent' }],
      stopReason: 'stop',
    })
    const scripted: AgentEvent[] = [
      { type: 'agent_start' },
      {
        type: 'message_update',
        message: finalAssistant,
        assistantMessageEvent: {
          type: 'text_delta',
          contentIndex: 0,
          delta: 'hello from agent',
          partial: finalAssistant,
        },
      },
      {
        type: 'agent_end',
        messages: [
          // pi-agent-core agent_end.messages 已是本轮 delta(agent-loop.js 内 newMessages),
          // 直接全量 insert,不需要 slice。
          {
            role: 'user',
            content: [{ type: 'text', text: 'hi' }],
            timestamp: 1,
          },
          finalAssistant,
        ],
      },
    ]
    const { agent, captured } = makeFakeAgent({
      events: scripted,
      extraSubscribe: async (event) => {
        if (event.type !== 'agent_end') return
        const newCanonical = event.messages.map(agentMessageToCanonical)
        await persistTurnToDeckChats(deck.id, newCanonical)
      },
    })
    __setCreateAgentForTesting(async () => agent)

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(200)
    // 消费完 SSE 流让 translate generator 跑完
    await collectSSE(res)
    // deterministic 等 prompt() 返(fake 内 for-loop 已 await 每个 handler,
    // 包括 extraSubscribe 里的 DB insert) —— 取代 setTimeout(50) wall-clock sleep
    await captured.promptDone

    const rows = await getDb()
      .select()
      .from(deckChats)
      .where(eq(deckChats.deckId, deck.id))
      .orderBy(deckChats.createdAt)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.role).toBe('user')
    expect(rows[0]?.content).toContain('hi')
    expect(rows[1]?.role).toBe('assistant')
    expect(rows[1]?.content).toContain('hello from agent')
  })

  it('createAgent throw → 400 + 中文通用 message;原英文错落 server-log 不外泄', async () => {
    const { user, cookie } = await createLoggedInUser('create-fail@a.com')
    await setLlmSettings(user.id)
    const { deck } = await createDeckDirect(user.id)

    // 模拟 createAgent 内部 throw(crypto decipher 失败 / zod parse 等);
    // 错文是英文实现细节,不应直接回吐给用户。
    __setCreateAgentForTesting(async () => {
      throw new Error('Unsupported state or unable to authenticate data')
    })

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ deckId: deck.id, message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    // 用户友好中文 message,不含 raw 英文细节
    expect(body.error.message).toBe('创建 AI 会话失败，请检查 LLM 配置')
    expect(body.error.message).not.toContain('Unsupported')
    expect(body.error.message).not.toContain('authenticate')

    // slot 已 release(失败路径里手动 release(),否则后续请求会被 hang)
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 0, queueLen: 0 })
  })
})
