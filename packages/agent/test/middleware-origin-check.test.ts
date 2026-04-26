/**
 * Phase 9-D：Origin / Referer 校验中间件单测。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { originCheck } from '../src/middleware/origin-check.js'

function buildApp() {
  const app = new Hono()
  app.use('*', originCheck)
  app.get('/api/data', (c) => c.json({ ok: true }))
  app.post('/api/decks', (c) => c.json({ ok: true }))
  app.put('/api/decks/1', (c) => c.json({ ok: true }))
  app.delete('/api/decks/1', (c) => c.json({ ok: true }))
  app.patch('/api/decks/1', (c) => c.json({ ok: true }))
  app.post('/api/auth/login', (c) => c.json({ ok: true }))
  app.post('/api/auth/register', (c) => c.json({ ok: true }))
  app.post('/api/auth/logout', (c) => c.json({ ok: true }))
  return app
}

const ORIGINAL_PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN
const ORIGINAL_PUBLIC_ORIGIN_EXTRA = process.env.PUBLIC_ORIGIN_EXTRA

beforeEach(() => {
  delete process.env.PUBLIC_ORIGIN
  delete process.env.PUBLIC_ORIGIN_EXTRA
})

afterEach(() => {
  if (ORIGINAL_PUBLIC_ORIGIN !== undefined) process.env.PUBLIC_ORIGIN = ORIGINAL_PUBLIC_ORIGIN
  else delete process.env.PUBLIC_ORIGIN
  if (ORIGINAL_PUBLIC_ORIGIN_EXTRA !== undefined) process.env.PUBLIC_ORIGIN_EXTRA = ORIGINAL_PUBLIC_ORIGIN_EXTRA
  else delete process.env.PUBLIC_ORIGIN_EXTRA
})

describe('originCheck — 方法过滤', () => {
  it('GET 请求跳过校验（即便没 Origin）', async () => {
    const res = await buildApp().request('/api/data')
    expect(res.status).toBe(200)
  })
})

describe('originCheck — 缺 Origin/Referer', () => {
  it('POST 无 Origin / Referer → 403', async () => {
    const res = await buildApp().request('/api/decks', { method: 'POST' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/missing/i)
  })

  it('PATCH 无 Origin / Referer → 403', async () => {
    const res = await buildApp().request('/api/decks/1', { method: 'PATCH' })
    expect(res.status).toBe(403)
  })
})

describe('originCheck — PUBLIC_ORIGIN 设置', () => {
  it('Origin 命中 PUBLIC_ORIGIN → 200', async () => {
    process.env.PUBLIC_ORIGIN = 'https://lumideck.example'
    const res = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://lumideck.example' },
    })
    expect(res.status).toBe(200)
  })

  it('Origin 不命中 → 403', async () => {
    process.env.PUBLIC_ORIGIN = 'https://lumideck.example'
    const res = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not allowed/i)
  })

  it('Referer fallback：无 Origin 但 Referer 命中 → 200', async () => {
    process.env.PUBLIC_ORIGIN = 'https://lumideck.example'
    const res = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Referer: 'https://lumideck.example/decks/123' },
    })
    expect(res.status).toBe(200)
  })

  it('Referer 不命中 → 403', async () => {
    process.env.PUBLIC_ORIGIN = 'https://lumideck.example'
    const res = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Referer: 'https://attacker.example/abuse' },
    })
    expect(res.status).toBe(403)
  })

  it('PUBLIC_ORIGIN_EXTRA 多源支持（CSV）', async () => {
    process.env.PUBLIC_ORIGIN = 'https://prod.example'
    process.env.PUBLIC_ORIGIN_EXTRA = 'https://staging.example,https://preview.example'
    const r1 = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://staging.example' },
    })
    expect(r1.status).toBe(200)
    const r2 = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://preview.example' },
    })
    expect(r2.status).toBe(200)
    const r3 = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://other.example' },
    })
    expect(r3.status).toBe(403)
  })
})

describe('originCheck — dev 兜底（PUBLIC_ORIGIN 未设）', () => {
  it('localhost / 127.0.0.1 任意端口允许', async () => {
    const r1 = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3030' },
    })
    expect(r1.status).toBe(200)
    const r2 = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:3130' },
    })
    expect(r2.status).toBe(200)
  })

  it('其他 host 拒绝', async () => {
    const res = await buildApp().request('/api/decks', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    })
    expect(res.status).toBe(403)
  })
})

describe('originCheck — 路径豁免', () => {
  it('POST /api/auth/login 无 Origin → 200（豁免）', async () => {
    const res = await buildApp().request('/api/auth/login', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('POST /api/auth/register 无 Origin → 200（豁免）', async () => {
    const res = await buildApp().request('/api/auth/register', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('POST /api/auth/logout 无 Origin → 200（豁免）', async () => {
    const res = await buildApp().request('/api/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
