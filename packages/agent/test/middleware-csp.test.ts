/**
 * Phase 9-D：CSP Report-Only header 单测。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { cspReportOnly } from '../src/middleware/csp.js'

function buildApp() {
  const app = new Hono()
  app.use('*', cspReportOnly)
  app.get('/', (c) => c.text('ok'))
  return app
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

beforeEach(() => {
  delete process.env.NODE_ENV
})

afterEach(() => {
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV
  else delete process.env.NODE_ENV
})

describe('cspReportOnly', () => {
  it('生产模式注入 Content-Security-Policy-Report-Only header', async () => {
    process.env.NODE_ENV = 'production'
    const res = await buildApp().request('/')
    const header = res.headers.get('content-security-policy-report-only')
    expect(header).toBeTruthy()
    expect(header).toMatch(/default-src 'self'/)
    expect(header).toMatch(/frame-ancestors 'self'/) // 防点击劫持
  })

  it('非生产模式不注入 CSP header（dev/test）', async () => {
    process.env.NODE_ENV = 'development'
    const res = await buildApp().request('/')
    expect(res.headers.get('content-security-policy-report-only')).toBeNull()
  })

  it('CSP 仅 Report-Only，绝不写 Content-Security-Policy（enforce 模式）', async () => {
    process.env.NODE_ENV = 'production'
    const res = await buildApp().request('/')
    expect(res.headers.get('content-security-policy')).toBeNull()
  })
})
