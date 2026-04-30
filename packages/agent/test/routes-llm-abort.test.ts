// packages/agent/test/routes-llm-abort.test.ts
/**
 * 验证 client abort 透传 + slot 释放(2026-04-30 修真实场景的 bug)。
 *
 * 旧场景:fetch upstream 没传 client.signal,client 断开后 server 仍在 await 智谱,
 * 上游真实 in-flight 名额不释放;本地 semaphore 在 reader.cancel 时 release,
 * 与上游真实并发失同步,新请求叠加上去撞 429。
 *
 * 修法:upstream fetch 接 c.req.raw.signal,client abort → upstream connection 断
 * → 智谱端释放名额。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { getDb, users } from '../src/db/index.js'

const { llm: llmRoute } = await import('../src/routes/llm.js')
const { authOptional } = await import('../src/middleware/auth.js')
const {
  __resetLlmSemaphoreForTesting,
  __getLlmSemaphoreStateForTesting,
} = await import('../src/middleware/llm-semaphore.js')
const { encryptApiKey } = await import('../src/crypto/apikey.js')

useTestDb()

function buildApp() {
  const app = new Hono()
  app.use('*', authOptional)
  app.route('/api', llmRoute)
  return app
}

let cookieA: string
let userIdA: number
const realFetch = globalThis.fetch

beforeEach(async () => {
  __resetLlmSemaphoreForTesting()
  const a = await createLoggedInUser('llm-abort@a.com')
  cookieA = a.cookie
  userIdA = a.user.id
  // 给 user 写入 LLM settings,否则 llm.ts 会 400
  await getDb()
    .update(users)
    .set({
      llmSettings: encryptApiKey(
        JSON.stringify({ provider: 'zhipu', apiKey: 'test-key', model: 'GLM-5.1' }),
      ),
    })
    .where(eq(users.id, userIdA))
})

afterEach(() => {
  __resetLlmSemaphoreForTesting()
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('routes/llm.ts client abort 透传', () => {
  it('upstream fetch 收到 client signal 并在 abort 时被取消,slot 释放', async () => {
    /** 记录 upstream fetch 拿到的 signal,验证透传 */
    let upstreamSignal: AbortSignal | undefined
    let upstreamAbortFired = false
    globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
      upstreamSignal = opts?.signal
      return new Promise<Response>((_, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          upstreamAbortFired = true
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })
    }) as any

    const ac = new AbortController()
    const reqPromise = buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ model: 'GLM-5.1', messages: [], stream: true }),
        signal: ac.signal,
      }),
    )

    // 等到 acquireLlmSlot + fetch upstream 调用发生
    await new Promise((r) => setTimeout(r, 50))
    expect(upstreamSignal).toBeDefined()
    expect(__getLlmSemaphoreStateForTesting(userIdA)).toEqual({ active: 1, queueLen: 0 })

    ac.abort()
    await reqPromise.catch(() => undefined)

    // upstream signal 被透传触发,slot 已释放
    expect(upstreamAbortFired).toBe(true)
    expect(__getLlmSemaphoreStateForTesting(userIdA)).toEqual({ active: 0, queueLen: 0 })
  })

  it('upstream fetch 业务失败(非 abort)也释放 slot', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as any
    const res = await buildApp().fetch(
      new Request('http://x/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ model: 'GLM-5.1', messages: [], stream: true }),
      }),
    )
    expect(res.status).toBe(502)
    expect(__getLlmSemaphoreStateForTesting(userIdA)).toEqual({ active: 0, queueLen: 0 })
  })
})
