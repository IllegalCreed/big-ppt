/**
 * Phase 9-E：日志脱敏 helper 单测。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { redact, truncate, safeForLog } from '../src/utils/redact.js'

const ORIGINAL_ENV = process.env.LOG_REDACT_FIELDS
beforeEach(() => {
  delete process.env.LOG_REDACT_FIELDS
})
afterEach(() => {
  if (ORIGINAL_ENV !== undefined) process.env.LOG_REDACT_FIELDS = ORIGINAL_ENV
  else delete process.env.LOG_REDACT_FIELDS
})

describe('redact', () => {
  it('过滤 password 字段', () => {
    const out = redact({ user: 'a', password: 'secret' }) as Record<string, string>
    expect(out.user).toBe('a')
    expect(out.password).toBe('[REDACTED]')
  })

  it('大小写不敏感（Authorization / authorization / AUTHORIZATION）', () => {
    const out = redact({
      Authorization: 'Bearer x',
      authorization: 'Bearer y',
      AUTHORIZATION: 'Bearer z',
    }) as Record<string, string>
    expect(out.Authorization).toBe('[REDACTED]')
    expect(out.authorization).toBe('[REDACTED]')
    expect(out.AUTHORIZATION).toBe('[REDACTED]')
  })

  it('嵌套对象递归过滤', () => {
    const out = redact({
      headers: { Authorization: 'Bearer x', 'X-Custom': 'visible' },
      payload: { nested: { apiKey: 'sk-xxx', name: 'ok' } },
    }) as { headers: Record<string, string>; payload: { nested: Record<string, string> } }
    expect(out.headers.Authorization).toBe('[REDACTED]')
    expect(out.headers['X-Custom']).toBe('visible')
    expect(out.payload.nested.apiKey).toBe('[REDACTED]')
    expect(out.payload.nested.name).toBe('ok')
  })

  it('数组递归过滤', () => {
    const out = redact([
      { token: 't1', val: 1 },
      { token: 't2', val: 2 },
    ]) as Array<Record<string, unknown>>
    expect(out).toHaveLength(2)
    expect(out[0]!.token).toBe('[REDACTED]')
    expect(out[1]!.token).toBe('[REDACTED]')
    expect(out[0]!.val).toBe(1)
  })

  it('字段名子串匹配（access_token / refresh_token / *Cookie）', () => {
    const out = redact({
      access_token: 'a',
      refresh_token: 'r',
      sessionId: 's', // 故意保留：logger 用 session/sessionId 作日志 ID 不脱敏
      myCookieValue: 'c',
    }) as Record<string, string>
    expect(out.access_token).toBe('[REDACTED]')
    expect(out.refresh_token).toBe('[REDACTED]')
    expect(out.sessionId).toBe('s') // session 不在脱敏列表
    expect(out.myCookieValue).toBe('[REDACTED]') // cookie 子串匹配
  })

  it('循环引用不死循环', () => {
    const a: Record<string, unknown> = { name: 'a' }
    const b: Record<string, unknown> = { name: 'b', ref: a }
    a.ref = b
    const out = redact(a) as Record<string, unknown>
    expect(out.name).toBe('a')
    // 第二层 ref 进 b 后，b.ref → a 是循环 → 标记
    const second = (out.ref as Record<string, unknown>).ref
    expect(second).toBe('[Circular]')
  })

  it('LOG_REDACT_FIELDS env 自定义补充字段', () => {
    process.env.LOG_REDACT_FIELDS = 'creditcard,ssn'
    const out = redact({ creditCard: '4111-1111', ssn: '123-45', name: 'ok' }) as Record<
      string,
      string
    >
    expect(out.creditCard).toBe('[REDACTED]')
    expect(out.ssn).toBe('[REDACTED]')
    expect(out.name).toBe('ok')
  })

  it('原对象不被 mutate', () => {
    const input = { password: 'real' }
    redact(input)
    expect(input.password).toBe('real')
  })

  it('原始类型 / null 直接返回', () => {
    expect(redact(null)).toBe(null)
    expect(redact(123)).toBe(123)
    expect(redact('hello')).toBe('hello')
  })
})

describe('truncate', () => {
  it('小于 maxBytes 原样返回', () => {
    const v = { a: 1, b: 'short' }
    expect(truncate(v, 1024)).toBe(v)
  })

  it('超过 maxBytes 截断 + 标记', () => {
    const big = { data: 'x'.repeat(100) }
    const out = truncate(big, 50) as {
      __truncated: true
      __originalBytes: number
      preview: string
    }
    expect(out.__truncated).toBe(true)
    expect(out.__originalBytes).toBeGreaterThan(50)
    expect(out.preview.length).toBe(50)
  })
})

describe('safeForLog (redact + truncate)', () => {
  it('先脱敏再截断', () => {
    const out = safeForLog(
      { password: 'real', data: 'x'.repeat(50) },
      512,
    ) as Record<string, unknown>
    expect(out.password).toBe('[REDACTED]')
    expect(out.data).toBe('x'.repeat(50)) // 未超 512
  })
})
