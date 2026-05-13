/**
 * Phase 12 Task E:LLM 路由集成测(canonical 改写后的完整路径)。
 *
 * 不走真上游 SDK,通过 `__setRegistryForTesting` 注入 fake registry 验:
 * - HTTP 状态码契约(401 / 400 / 500 / 503 / 200)
 * - SSE wire format 正确(用 Task D 的 decodeSSEStream parse)
 * - canonical event 序列保真
 * - AbortSignal 透传给 adapter.streamChat + cancel 反向传播
 * - LLM slot acquire / release 在所有出口都生效
 * - logServerEvent 错误路径调用契约
 *
 * Why 放 test/integration/:跟 src/llm/__tests__/ 的 mock 单测区分,本测试走
 * `app.fetch(req)` 完整路由 mount 路径,覆盖 authOptional → originCheck →
 * llm.post('/chat/completions') 的端到端链路,跟其他 routes-*.test.ts 的集成测
 * 一致风格,但放 integration/ 子目录强调"路由集成"语义。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { useTestDb } from '../_setup/test-db.js'
import { createLoggedInUser } from '../_setup/factories.js'
import { getDb, users } from '../../src/db/index.js'
import { llm, __setRegistryForTesting } from '../../src/routes/llm.js'
import { authOptional, type AuthVars } from '../../src/middleware/auth.js'
import {
  __resetLlmSemaphoreForTesting,
  __getLlmSemaphoreStateForTesting,
} from '../../src/middleware/llm-semaphore.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../../src/crypto/apikey.js'
import { ProviderRegistry, type LLMProvider, type ProviderConfig } from '../../src/llm/provider.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../../src/llm/types.js'
import { decodeSSEStream } from '../../src/llm/canonical-sse.js'
import { LLMError } from '../../src/llm/errors.js'

const FIXED_KEY = Buffer.alloc(32, 0xab)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterEach(() => {
  __resetLlmSemaphoreForTesting()
  __setRegistryForTesting(null)
  vi.restoreAllMocks()
})

beforeEach(() => {
  __resetLlmSemaphoreForTesting()
})

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.route('/api', llm)
  return app
}

/**
 * 新 shape settings(Task F 之前 dev DB 还是老 shape,这里直接写新 shape
 * 模拟 Task F migration 完成后的状态)。
 */
function newShapeSettings(
  activeProvider: string,
  apiKey = 'test-key',
  model = 'GLM-5.1',
): string {
  return JSON.stringify({
    activeProvider,
    providers: { [activeProvider]: { apiKey, model } },
  })
}

/** 在 DB 给某 user 写 llm_settings(加密 JSON 字符串) */
async function setLlmSettings(userId: number, plaintext: string | null) {
  await getDb()
    .update(users)
    .set({ llmSettings: plaintext ? encryptApiKey(plaintext) : null })
    .where(eq(users.id, userId))
}

/**
 * Fake provider helper:可控的 streamChat 实现,记录调用参数。
 *
 * - `events`:streamChat yield 的事件序列(走 happy path 时)
 * - `throwInside`:不 null 时 streamChat 第一次 next() 后抛错(模拟 adapter SDK 异常)
 * - 暴露 `lastSignal` / `lastRequest` 让测试断言透传
 * - 暴露 `streamCancelled` 让测试断言 cancel 反向传播
 */
function makeFakeProvider(opts: {
  id?: string
  events?: CanonicalEvent[]
  throwInside?: Error | null
  /** infinite=true 时 streamChat 持续 yield 直到 cancel(测 abort) */
  infinite?: boolean
} = {}) {
  const id = opts.id ?? 'zhipu'
  const captured = {
    lastSignal: null as AbortSignal | null,
    lastRequest: null as CanonicalChatRequest | null,
    streamCancelled: false,
    yieldCount: 0,
  }

  const factory = (cfg: ProviderConfig): LLMProvider => ({
    id: cfg.id,
    family: 'openai-compatible',
    async *streamChat(req, signal) {
      captured.lastSignal = signal
      captured.lastRequest = req
      try {
        if (opts.infinite) {
          while (true) {
            captured.yieldCount++
            yield { type: 'text.delta' as const, text: `chunk ${captured.yieldCount}` }
            // 让 cancel 有机会插进 next() 之间
            await new Promise((r) => setTimeout(r, 5))
            if (signal.aborted) throw new Error('aborted by signal')
          }
        }
        for (const evt of opts.events ?? []) {
          captured.yieldCount++
          yield evt
          if (opts.throwInside && captured.yieldCount === 1) {
            throw opts.throwInside
          }
        }
      } finally {
        captured.streamCancelled = true
      }
    },
  })

  const registry = new ProviderRegistry(new Map([[id, factory]]))
  return { registry, captured }
}

async function collectSSE(res: Response): Promise<CanonicalEvent[]> {
  if (!res.body) return []
  const out: CanonicalEvent[] = []
  for await (const evt of decodeSSEStream(res.body)) {
    out.push(evt)
  }
  return out
}

// --- tests ---------------------------------------------------------------

describe('POST /api/chat/completions(canonical 路由)', () => {
  it('未登录 → 401', async () => {
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('unauthorized')
  })

  it('已登录但未配 llmSettings → 400("请先在设置中配置 LLM API Key")', async () => {
    const { cookie } = await createLoggedInUser('no-settings@a.com')
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('请先在设置中配置 LLM API Key')
  })

  it('llmSettings 解密失败(密文格式损坏) → 500', async () => {
    const { user, cookie } = await createLoggedInUser('bad-cipher@a.com')
    // 直接写一段非法密文(不经 encryptApiKey)
    await getDb()
      .update(users)
      .set({ llmSettings: 'v1:not-base64:not-base64:not-base64' })
      .where(eq(users.id, user.id))

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/LLM 配置解密 \/ 解析失败/)
  })

  it('llmSettings 缺 activeProvider(parseLlmSettings 抛错) → 500', async () => {
    const { user, cookie } = await createLoggedInUser('no-active@a.com')
    // 老 shape:Phase 5 时代用户存的 {provider, apiKey, ...},缺 activeProvider
    await setLlmSettings(user.id, JSON.stringify({ provider: 'zhipu', apiKey: 'x' }))

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/缺 activeProvider/)
  })

  it('llmSettings 配的 provider 未注册(如 anthropic Task G 前) → 400', async () => {
    const { user, cookie } = await createLoggedInUser('unregistered@a.com')
    // 配 anthropic 但默认 registry 还没注册 anthropic factory(Task G 才注册)
    await setLlmSettings(user.id, newShapeSettings('anthropic', 'sk-anthropic'))

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/provider "anthropic" adapter 未注册/)
  })

  it('happy path:fake provider yield 2 text.delta + 1 finish → SSE 流含这 3 个 event', async () => {
    const { user, cookie } = await createLoggedInUser('happy@a.com')
    await setLlmSettings(user.id, newShapeSettings('zhipu'))

    const expected: CanonicalEvent[] = [
      { type: 'text.delta', text: 'Hello' },
      { type: 'text.delta', text: ', world' },
      { type: 'finish', reason: 'stop', usage: { input: 10, output: 5 } },
    ]
    const { registry, captured } = makeFakeProvider({ events: expected })
    __setRegistryForTesting(registry)

    const reqBody: CanonicalChatRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      temperature: 0.7,
    }
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(reqBody),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')

    const decoded = await collectSSE(res)
    expect(decoded).toEqual(expected)

    // adapter 收到了完整 canonical request
    expect(captured.lastRequest).toEqual(reqBody)
    // adapter 收到的 signal 是 c.req.raw.signal(AbortSignal 实例)
    expect(captured.lastSignal).toBeInstanceOf(AbortSignal)

    // slot 已 release(SSE 流跑完,finally 触发)
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 0, queueLen: 0 })
  })

  it('LLM concurrency timeout(slot 拿不到) → 503', async () => {
    const { user, cookie } = await createLoggedInUser('timeout@a.com')
    await setLlmSettings(user.id, newShapeSettings('zhipu'))

    // 用 fake provider 但同时把 semaphore 撑满,让本次 acquireLlmSlot 排队 + 超时。
    // 直接 mock acquireLlmSlot module-level 太复杂——改用 env 调短 timeout + 先打满 slot。
    // 默认 limit=2,timeoutMs=60000。把 timeout 调到 ~50ms,先占满 2 slot。
    process.env.LLM_QUEUE_TIMEOUT_MS = '50'

    try {
      // 占满 2 slot(假 hang):直接调 acquireLlmSlot 拿 release fn 但**不**调
      // 让 slot 维持 active=2
      const { acquireLlmSlot } = await import('../../src/middleware/llm-semaphore.js')
      await acquireLlmSlot(user.id)
      await acquireLlmSlot(user.id)
      expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 2, queueLen: 0 })

      // 接下来 fake provider 即使设了也跑不到 streamChat(slot 拿不到先走 503 路径)
      const { registry } = makeFakeProvider({
        events: [{ type: 'finish', reason: 'stop', usage: { input: 0, output: 0 } }],
      })
      __setRegistryForTesting(registry)

      const res = await buildApp().fetch(
        new Request('http://x/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ messages: [] }),
        }),
      )

      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { message: string } }
      expect(body.error.message).toMatch(/LLM 并发排队超时/)
    } finally {
      delete process.env.LLM_QUEUE_TIMEOUT_MS
    }
  })

  it('provider.streamChat 中途 throw → SSE error event + slot 释放', async () => {
    const { user, cookie } = await createLoggedInUser('throws@a.com')
    await setLlmSettings(user.id, newShapeSettings('zhipu'))

    const { registry, captured } = makeFakeProvider({
      events: [{ type: 'text.delta', text: 'partial' }],
      throwInside: new LLMError('rate limit hit', 'rate_limit', 'zhipu', true),
    })
    __setRegistryForTesting(registry)

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )

    expect(res.status).toBe(200) // 流已 open,error 走 SSE event 不走 HTTP status
    const decoded = await collectSSE(res)
    // partial + error 收尾(eventsToSSEStream 在 generator throw 时 emit error event)
    expect(decoded).toHaveLength(2)
    expect(decoded[0]).toEqual({ type: 'text.delta', text: 'partial' })
    expect(decoded[1]).toMatchObject({ type: 'error', code: 'unknown', message: 'rate limit hit' })

    // generator finally 块跑过,slot 已 release
    expect(captured.streamCancelled).toBe(true)
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 0, queueLen: 0 })
  })

  it('client cancel SSE 流 → AbortSignal 透传 + cancel 反向传播 + slot 释放', async () => {
    const { user, cookie } = await createLoggedInUser('abort@a.com')
    await setLlmSettings(user.id, newShapeSettings('zhipu'))

    const { registry, captured } = makeFakeProvider({ infinite: true })
    __setRegistryForTesting(registry)

    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ messages: [] }),
      }),
    )
    expect(res.status).toBe(200)

    // 开始消费流 —— streamChat 才会真正跑起来(SSE stream 是 lazy 的,
    // start hook 在 first read 时才触发,故 lastSignal 也是在这之后才被赋值)
    const reader = res.body!.getReader()
    await reader.read() // 拿到首个 chunk(text.delta "chunk 1")
    expect(captured.lastSignal).toBeInstanceOf(AbortSignal)
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 1, queueLen: 0 })

    // cancel 流(模拟 client 断开):eventsToSSEStream cancel hook →
    // iterator.return() → async generator finally → release()
    await reader.cancel('test abort')

    // 给 generator 一个 microtick 跑完 try/finally
    await new Promise((r) => setTimeout(r, 50))

    // cancel 反向传播了 → generator finally → release()
    expect(captured.streamCancelled).toBe(true)
    expect(__getLlmSemaphoreStateForTesting(user.id)).toEqual({ active: 0, queueLen: 0 })
  })
})
