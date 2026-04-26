/**
 * Phase 9-E：rate-limit middleware 单测。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  createRateLimit,
  __resetRateLimitForTesting,
  userOrIpKey,
} from '../src/middleware/rate-limit.js'

const ORIGINAL_ENABLED = process.env.RATE_LIMIT_ENABLED

beforeEach(() => {
  __resetRateLimitForTesting()
  delete process.env.RATE_LIMIT_ENABLED
})

afterEach(() => {
  __resetRateLimitForTesting()
  if (ORIGINAL_ENABLED !== undefined) process.env.RATE_LIMIT_ENABLED = ORIGINAL_ENABLED
  else delete process.env.RATE_LIMIT_ENABLED
})

function buildApp(opts: { windowMs: number; max: number }) {
  const app = new Hono()
  app.use('*', createRateLimit(opts))
  app.get('/', (c) => c.text('ok'))
  return app
}

describe('rate-limit basic', () => {
  it('未达上限正常响应 200', async () => {
    const app = buildApp({ windowMs: 60_000, max: 3 })
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/', { headers: { 'X-Forwarded-For': '1.2.3.4' } })
      expect(res.status).toBe(200)
    }
  })

  it('超过上限返回 429 + Retry-After header', async () => {
    const app = buildApp({ windowMs: 60_000, max: 2 })
    await app.request('/', { headers: { 'X-Forwarded-For': '1.2.3.4' } })
    await app.request('/', { headers: { 'X-Forwarded-For': '1.2.3.4' } })
    const res = await app.request('/', { headers: { 'X-Forwarded-For': '1.2.3.4' } })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('不同 IP 独立计数', async () => {
    const app = buildApp({ windowMs: 60_000, max: 1 })
    const r1 = await app.request('/', { headers: { 'X-Forwarded-For': '1.1.1.1' } })
    const r2 = await app.request('/', { headers: { 'X-Forwarded-For': '2.2.2.2' } })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // 同 IP 第二次会撞上限
    const r3 = await app.request('/', { headers: { 'X-Forwarded-For': '1.1.1.1' } })
    expect(r3.status).toBe(429)
  })

  it('不同 (windowMs, max) 配置 scope 不互相影响', async () => {
    const appA = new Hono()
    appA.use('*', createRateLimit({ windowMs: 60_000, max: 2 }))
    appA.get('/', (c) => c.text('a'))
    const appB = new Hono()
    appB.use('*', createRateLimit({ windowMs: 30_000, max: 5 }))
    appB.get('/', (c) => c.text('b'))

    const ip = { 'X-Forwarded-For': '9.9.9.9' }
    await appA.request('/', { headers: ip })
    await appA.request('/', { headers: ip })
    const aLimit = await appA.request('/', { headers: ip })
    expect(aLimit.status).toBe(429)
    // appB 独立 scope，同 IP 仍可用
    const bOk = await appB.request('/', { headers: ip })
    expect(bOk.status).toBe(200)
  })

  it('RATE_LIMIT_ENABLED=false 全局禁用', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false'
    const app = buildApp({ windowMs: 60_000, max: 1 })
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/', { headers: { 'X-Forwarded-For': '1.1.1.1' } })
      expect(res.status).toBe(200)
    }
  })

  it('window 内计数；windowMs 极小（10ms）触发跨 window 重置', async () => {
    const app = buildApp({ windowMs: 10, max: 1 })
    const ip = { 'X-Forwarded-For': '1.1.1.1' }
    expect((await app.request('/', { headers: ip })).status).toBe(200)
    expect((await app.request('/', { headers: ip })).status).toBe(429)
    await new Promise((r) => setTimeout(r, 20))
    expect((await app.request('/', { headers: ip })).status).toBe(200)
  })
})

describe('userOrIpKey resolver', () => {
  it('已登录 → key=u:<id>', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('user', { id: 42 } as never)
      await next()
    })
    app.use('*', createRateLimit({ windowMs: 60_000, max: 1, keyResolver: userOrIpKey }))
    app.get('/', (c) => c.text('ok'))

    expect((await app.request('/')).status).toBe(200)
    expect((await app.request('/')).status).toBe(429) // 同 user 第 2 次撞上限
  })

  it('未登录 → fallback X-Forwarded-For', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('user', null)
      await next()
    })
    app.use('*', createRateLimit({ windowMs: 60_000, max: 1, keyResolver: userOrIpKey }))
    app.get('/', (c) => c.text('ok'))

    expect((await app.request('/', { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status).toBe(
      200,
    )
    expect((await app.request('/', { headers: { 'X-Forwarded-For': '2.2.2.2' } })).status).toBe(
      200,
    )
    expect((await app.request('/', { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status).toBe(
      429,
    )
  })
})
