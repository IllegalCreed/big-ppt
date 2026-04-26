/**
 * Phase 9-E：error-response helper 单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { errorResponse } from '../src/utils/error-response.js'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
let consoleErrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  delete process.env.NODE_ENV
  consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV
  else delete process.env.NODE_ENV
  consoleErrSpy.mockRestore()
})

function buildApp() {
  const app = new Hono()
  app.get('/throw', (c) => errorResponse(c, new Error('内部细节：DB 解密失败 stack here')))
  app.get('/throw-400', (c) =>
    errorResponse(c, new Error('参数错误'), { status: 400, publicMessage: '参数无效' }),
  )
  app.get('/throw-silent', (c) => errorResponse(c, new Error('boom'), { silent: true }))
  return app
}

describe('errorResponse — 生产模式', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  it('仅返 generic message + errorId（不吐 stack 不吐内部 message）', async () => {
    const res = await buildApp().request('/throw')
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; errorId: string; stack?: string }
    expect(json.error).toBe('内部错误，请稍后重试')
    expect(json.errorId).toMatch(/^[0-9a-f]{16}$/) // 16 hex
    expect(json).not.toHaveProperty('stack')
    // 不吐内部细节
    expect(JSON.stringify(json)).not.toContain('DB 解密失败')
    // 但 logger.error 应记录原信息（含 errorId 关联）
    expect(consoleErrSpy).toHaveBeenCalled()
    const logArgs = consoleErrSpy.mock.calls[0]!.join(' ')
    expect(logArgs).toContain('DB 解密失败')
    expect(logArgs).toContain(json.errorId)
  })

  it('publicMessage 覆盖默认文案 + 自定义 status', async () => {
    const res = await buildApp().request('/throw-400')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('参数无效')
  })

  it('silent: true 不写 console.error', async () => {
    await buildApp().request('/throw-silent')
    expect(consoleErrSpy).not.toHaveBeenCalled()
  })
})

describe('errorResponse — 非生产模式', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development'
  })

  it('返完整 message + stack + errorId', async () => {
    const res = await buildApp().request('/throw')
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string; errorId: string; stack?: string }
    expect(json.error).toContain('DB 解密失败')
    expect(json.stack).toBeTruthy()
    expect(json.errorId).toMatch(/^[0-9a-f]{16}$/)
  })
})
