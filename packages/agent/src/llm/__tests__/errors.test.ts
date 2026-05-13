import { describe, expect, it } from 'vitest'
import { LLMError, type LLMErrorCode } from '../errors.js'

describe('LLMError', () => {
  it('instanceof Error 与 LLMError 双向通过', () => {
    const err = new LLMError('boom', 'unknown', 'openai', false)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.name).toBe('LLMError')
    expect(err.message).toBe('boom')
  })

  it('所有 6 个 code 都可构造,字段全部 readonly 命中', () => {
    const codes: LLMErrorCode[] = [
      'rate_limit',
      'auth',
      'network',
      'invalid_request',
      'context_too_long',
      'unknown',
    ]
    for (const code of codes) {
      const err = new LLMError(`msg-${code}`, code, 'anthropic', code === 'rate_limit')
      expect(err.code).toBe(code)
      expect(err.provider).toBe('anthropic')
      expect(err.retryable).toBe(code === 'rate_limit')
      expect(err.message).toBe(`msg-${code}`)
    }
  })

  it('cause 透传原始 SDK error,supplemented 字段对象引用相等', () => {
    const original = new Error('underlying fetch failed')
    ;(original as Error & { status?: number }).status = 503
    const err = new LLMError('upstream 503', 'network', 'gemini', true, original)
    expect(err.cause).toBe(original)
    expect(err.cause).toBeInstanceOf(Error)
    expect((err.cause as Error & { status?: number }).status).toBe(503)
  })

  it('cause 缺省时为 undefined,不影响堆栈', () => {
    const err = new LLMError('no cause', 'auth', 'openai', false)
    expect(err.cause).toBeUndefined()
    expect(err.stack).toMatch(/LLMError: no cause/)
  })

  it('retryable 在 rate_limit / network 时一般 true,auth / invalid_request 时一般 false(adapter 自行判断)', () => {
    const retryable = new LLMError('429', 'rate_limit', 'openai', true)
    const notRetryable = new LLMError('401', 'auth', 'openai', false)
    expect(retryable.retryable).toBe(true)
    expect(notRetryable.retryable).toBe(false)
  })

  it('cause 可携带非 Error 值(SDK 偶尔抛 plain object)', () => {
    const plain = { code: 'ENOTFOUND', hostname: 'api.openai.com' }
    const err = new LLMError('dns lookup failed', 'network', 'openai', true, plain)
    expect(err.cause).toBe(plain)
  })
})
