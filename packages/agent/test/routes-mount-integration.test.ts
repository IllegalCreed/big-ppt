/**
 * Phase 9-B/9-C 防再犯：Hono sub-router 通过 `app.route('/api', sub)` 挂载后，
 * `sub.use('*', mw)` 会拦截 /api/* 所有路径（不只 sub 自己的 routes）。
 *
 * 9-B 一开始把 slides.ts 的持锁守卫写成 `slides.use('*', mw)`，结果 list-templates
 * 等公开端点也被卡 401，e2e happy-path 直接挂。改成显式三条 path 才修。
 *
 * 这个测试用真 `app` 实例（不是 unit 测的 buildApp）跑 fetch，确保：
 *   - 公开端点（list-templates / system-prompt）维持公开
 *   - 鉴权端点（log-event / tools / call-tool / lock-status）未登录返 401
 *   - slides 持锁端点未登录返 401
 *
 * 跨 sub-router 的相互影响只能在真 app 里 catch，不能在 sub-router 单测里复现。
 */
import { describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { useTestDb } from './_setup/test-db.js'

useTestDb()

describe('Hono sub-router 挂载完整性（A01 防 wildcard 泄漏）', () => {
  it('GET /api/list-templates 维持公开（不被任何 sub-router 的 wildcard 中间件意外卡）', async () => {
    const res = await app.fetch(new Request('http://test/api/list-templates'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; manifests?: unknown[] }
    expect(body.success).toBe(true)
    expect(Array.isArray(body.manifests)).toBe(true)
  })

  it('GET /api/system-prompt?templateId=beitou-standard 维持公开', async () => {
    const res = await app.fetch(new Request('http://test/api/system-prompt?templateId=beitou-standard'))
    expect(res.status).toBe(200)
  })

  it('GET /api/healthz 维持公开', async () => {
    const res = await app.fetch(new Request('http://test/healthz'))
    expect(res.status).toBe(200)
  })

  it('POST /api/log-event 未登录 → 401', async () => {
    const res = await app.fetch(
      new Request('http://test/api/log-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: 's', kind: 'k', payload: {} }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/tools 未登录 → 401', async () => {
    const res = await app.fetch(new Request('http://test/api/tools'))
    expect(res.status).toBe(401)
  })

  it('POST /api/call-tool 未登录 → 401', async () => {
    const res = await app.fetch(
      new Request('http://test/api/call-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'read_slides', args: {} }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('GET /api/lock-status 未登录 → 401', async () => {
    const res = await app.fetch(new Request('http://test/api/lock-status'))
    expect(res.status).toBe(401)
  })

  it('POST /api/read-slides 未登录 → 401（slides 持锁守卫）', async () => {
    const res = await app.fetch(new Request('http://test/api/read-slides', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me 未登录 → 401', async () => {
    const res = await app.fetch(new Request('http://test/api/auth/me'))
    expect(res.status).toBe(401)
  })

  it('GET /api/decks 未登录 → 401', async () => {
    const res = await app.fetch(new Request('http://test/api/decks'))
    expect(res.status).toBe(401)
  })
})
