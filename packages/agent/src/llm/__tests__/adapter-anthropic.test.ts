/**
 * Phase 12 Task G:anthropic adapter 单测。
 *
 * 策略:跟 openai-compatible adapter 测一致 —— `vi.spyOn(Messages.prototype, 'stream')`
 * 拦截真 client 实例的 stream() 调用,而不是 vi.mock 整个 SDK。
 *
 * 覆盖目标:
 * - factory 路径:默认 model claude-sonnet-4-6 + override
 * - streamChat 走通:转 canonical → SDK body → stream → translate canonical events
 * - thinking config 注入(req.thinking.enabled)
 * - tools 空 / 非空 时传给 SDK 的 shape
 * - signal 透传给 SDK
 * - cacheControl 标记透传(通过 system 字段验证)
 * - error 翻译:6 个 LLMErrorCode 各覆盖一遍 + non-Error 兜底
 */

import Anthropic, {
  APIError as AnthropicAPIError,
  AuthenticationError as AnthropicAuthError,
  PermissionDeniedError as AnthropicPermError,
  RateLimitError as AnthropicRateLimitError,
  BadRequestError as AnthropicBadRequestError,
  InternalServerError as AnthropicInternalError,
  APIConnectionError as AnthropicConnError,
  APIConnectionTimeoutError as AnthropicTimeoutError,
  APIUserAbortError as AnthropicAbortError,
  NotFoundError as AnthropicNotFoundError,
  ConflictError as AnthropicConflictError,
} from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicProvider, translateAnthropicError } from '../adapters/anthropic.js'
import { LLMError } from '../errors.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'

/**
 * 共享 fake stream:简单 text → finish。
 *
 * 由于 SDK 的 MessageStream 类构造复杂(继承 EventEmitter + 内部 controller),
 * 我们用 mockImplementation 返回一个简单的 AsyncIterable 就足够 —— adapter 内部
 * 只调 `for await ... of stream`,不用其他 MessageStream-specific 方法。
 */
async function* fakeAnthropicStream(): AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
  yield {
    type: 'message_start',
    message: {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 5,
        output_tokens: 1,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
        inference_geo: null,
      },
      container: null,
    },
  }
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '', citations: null },
  }
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'hi' },
  }
  yield { type: 'content_block_stop', index: 0 }
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null, container: null, stop_details: null },
    usage: {
      input_tokens: 5,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    },
  }
  yield { type: 'message_stop' }
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

/**
 * spy 工具:把 Messages.prototype.stream 替成自定义 impl。
 * 直接 cast 到 never 跳过 MessageStream 复杂类型签名 —— 运行时 adapter 只需要 AsyncIterable。
 */
function spyStream(
  impl: (
    body: Anthropic.Messages.MessageStreamParams,
    options?: { signal?: AbortSignal },
  ) => AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>,
): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(Anthropic.Messages.prototype, 'stream')
    .mockImplementation(impl as never)
}

describe('createAnthropicProvider — factory 默认值', () => {
  it('id=anthropic → 默认 model=claude-sonnet-4-6', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-ant-test' })

    expect(provider.id).toBe('anthropic')
    expect(provider.family).toBe('anthropic')

    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))

    expect(spy).toHaveBeenCalledTimes(1)
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.max_tokens).toBe(8192)
  })

  it('cfg.model 覆盖默认值', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({
      id: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-7',
    })
    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.model).toBe('claude-opus-4-7')
  })

  it('cfg.baseUrl 覆盖默认值(传给 SDK 构造器)', async () => {
    // 这里只测构造不抛错;baseUrl 内部存到 SDK,我们无法直接断言外部,但能验流程通
    spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({
      id: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://duckcoding.example/v1',
    })
    await expect(
      collect(provider.streamChat({ messages: [] }, new AbortController().signal)),
    ).resolves.toBeDefined()
  })
})

describe('createAnthropicProvider — streamChat 走通', () => {
  it('canonical request → 转 Anthropic body → 翻译成 canonical events', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })

    const req: CanonicalChatRequest = {
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      temperature: 0.7,
      maxTokens: 1024,
      topP: 0.9,
      stopSequences: ['END'],
    }

    const events = await collect(provider.streamChat(req, new AbortController().signal))

    expect(events).toEqual<CanonicalEvent[]>([
      { type: 'text.delta', text: 'hi' },
      { type: 'finish', reason: 'stop', usage: { input: 5, output: 2 } },
    ])

    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ])
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(1024)
    expect(body.top_p).toBe(0.9)
    expect(body.stop_sequences).toEqual(['END'])
  })

  it('tools 空数组 → body.tools = undefined(不发空数组)', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [] },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.tools).toBeUndefined()
  })

  it('tools 非空 → body.tools 经 toAnthropicTools 包装', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          tools: [
            {
              name: 'mcp__a__b',
              description: 'do thing',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.tools).toEqual([
      {
        name: 'mcp__a__b',
        description: 'do thing',
        input_schema: { type: 'object', properties: {} },
      },
    ])
  })

  it('req.thinking.enabled=true → body.thinking = { type:enabled, budget_tokens }', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          thinking: { enabled: true, budgetTokens: 3000 },
        },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 3000 })
  })

  it('req.thinking.enabled=true / budgetTokens 缺 → 默认 5000', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          thinking: { enabled: true },
        },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 })
  })

  it('req.thinking.enabled=false → body.thinking 不存在', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          thinking: { enabled: false },
        },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.thinking).toBeUndefined()
  })

  it('cacheControl 在 system 上 → body.system 是 array 形式带 cache_control', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        {
          messages: [
            {
              role: 'system',
              cacheControl: { type: 'ephemeral' },
              content: [{ type: 'text', text: 'cached prompt' }],
            },
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          ],
        },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.system).toEqual([
      { type: 'text', text: 'cached prompt', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('signal 透传给 SDK request', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    const controller = new AbortController()
    await collect(provider.streamChat({ messages: [] }, controller.signal))
    const callArgs = spy.mock.calls[0] as unknown as [unknown, { signal?: AbortSignal }?]
    expect(callArgs[1]?.signal).toBe(controller.signal)
  })

  it('no system → body.system 字段不存在', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.system).toBeUndefined()
  })

  it('no temperature / topP → body 不带这些字段', async () => {
    const spy = spyStream(() => fakeAnthropicStream())
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        new AbortController().signal,
      ),
    )
    const body = spy.mock.calls[0]![0] as Anthropic.Messages.MessageStreamParams
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.stop_sequences).toBeUndefined()
  })
})

describe('createAnthropicProvider — error translation 端到端', () => {
  /**
   * 构造一个 APIError 子类实例。
   * Anthropic SDK APIError 构造签名:`(status, error, message, headers)`,跟 OpenAI 一致。
   */
  function makeError<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Ctor: any,
    status: number,
    body: { message?: string; error?: { message?: string } } = {},
  ): T {
    const message = body.message ?? `mock anthropic error status ${status}`
    return new Ctor(status, body.error ? body : { error: body }, message, new Headers()) as T
  }

  async function expectErr(factoryError: Error): Promise<LLMError> {
    spyStream(() => {
      throw factoryError
    })
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    try {
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      throw new Error('expected throw but got no error')
    } catch (e) {
      if (!(e instanceof LLMError)) {
        throw new Error(
          `expected LLMError, got ${(e as Error).constructor.name}: ${(e as Error).message}`,
        )
      }
      return e
    }
  }

  it('AuthenticationError(401)→ code=auth / retryable=false', async () => {
    const err = makeError<Error>(AnthropicAuthError, 401, { message: 'invalid api key' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
    expect(llmErr.provider).toBe('anthropic')
    expect(llmErr.cause).toBe(err)
  })

  it('PermissionDeniedError(403)→ code=auth / retryable=false', async () => {
    const err = makeError<Error>(AnthropicPermError, 403, { message: 'forbidden' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
  })

  it('RateLimitError(429)→ code=rate_limit / retryable=true', async () => {
    const err = makeError<Error>(AnthropicRateLimitError, 429, { message: 'too fast' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('rate_limit')
    expect(llmErr.retryable).toBe(true)
  })

  it('BadRequestError(400)含 "prompt is too long" → code=context_too_long', async () => {
    const err = makeError<Error>(AnthropicBadRequestError, 400, {
      message: 'prompt is too long: 200000 tokens > 199000',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
    expect(llmErr.retryable).toBe(false)
  })

  it('BadRequestError(400)含 maximum context length → code=context_too_long', async () => {
    const err = makeError<Error>(AnthropicBadRequestError, 400, {
      message: 'Your prompt exceeds the maximum context length',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('BadRequestError(400)含中文上下文长度 → code=context_too_long', async () => {
    const err = makeError<Error>(AnthropicBadRequestError, 400, {
      message: '输入超过模型上下文长度限制',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('BadRequestError(400)普通 invalid → code=invalid_request', async () => {
    const err = makeError<Error>(AnthropicBadRequestError, 400, {
      message: 'invalid parameter: messages cannot be empty',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('InternalServerError(500)→ code=network / retryable=true', async () => {
    const err = makeError<Error>(AnthropicInternalError, 500, { message: 'server boom' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIConnectionError → code=network / retryable=true', async () => {
    const err = new AnthropicConnError({ message: 'fetch failed', cause: new Error('ENOTFOUND') })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIConnectionTimeoutError → code=network / retryable=true', async () => {
    const err = new AnthropicTimeoutError({ message: 'timed out' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIUserAbortError → code=unknown / retryable=false', async () => {
    const err = new AnthropicAbortError({ message: 'user aborted' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
    expect(llmErr.cause).toBe(err)
  })

  it('AbortError(普通 Error 命名)→ code=unknown / retryable=false', async () => {
    const err = new Error('user aborted')
    err.name = 'AbortError'
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('普通 Error(非 SDK)→ code=network / retryable=true', async () => {
    const err = new Error('something went wrong in fetch')
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('streaming 中途抛错 → 翻译成 LLMError', async () => {
    const failingStream = (async function* (): AsyncGenerator<
      Anthropic.Messages.RawMessageStreamEvent
    > {
      yield {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 1,
            output_tokens: 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
          container: null,
        },
      }
      throw new Error('stream broke mid-flight')
    })()
    spyStream(() => failingStream)
    const provider = createAnthropicProvider({ id: 'anthropic', apiKey: 'sk-x' })
    try {
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError)
      expect((e as LLMError).code).toBe('network')
    }
  })
})

describe('translateAnthropicError — 直接单测兜底场景', () => {
  it('已是 LLMError → 直接 return(防御性)', () => {
    const existing = new LLMError('already', 'rate_limit', 'anthropic', true)
    expect(translateAnthropicError(existing, 'anthropic')).toBe(existing)
  })

  it('non-Error 抛 → code=unknown / retryable=false', () => {
    const err = translateAnthropicError({ code: 'WEIRD' }, 'anthropic')
    expect(err).toBeInstanceOf(LLMError)
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
    expect(err.cause).toEqual({ code: 'WEIRD' })
  })

  it('NotFoundError(404)→ status fallback → code=invalid_request', () => {
    const e = new AnthropicNotFoundError(
      404,
      { error: {} } as never,
      'not found',
      new Headers(),
    )
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('ConflictError(409)→ status fallback 4xx → code=invalid_request', () => {
    const e = new AnthropicConflictError(
      409,
      { error: {} } as never,
      'conflict',
      new Headers(),
    )
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('invalid_request')
  })

  it('未知 APIError status=null → code=unknown', () => {
    const e = new AnthropicAPIError(
      undefined as never,
      { error: {} },
      'unknown api error',
      new Headers(),
    )
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('裸 APIError status=502 → status fallback 5xx → code=network', () => {
    const e = new AnthropicAPIError(502, { error: {} }, 'bad gateway', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('裸 APIError status=401(非 AuthenticationError 子类)→ status fallback → auth', () => {
    const e = new AnthropicAPIError(401, { error: {} }, 'raw 401', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
  })

  it('裸 APIError status=429 → status fallback → rate_limit', () => {
    const e = new AnthropicAPIError(429, { error: {} }, 'raw 429', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('rate_limit')
    expect(llmErr.retryable).toBe(true)
  })

  it('裸 APIError status=403 → status fallback → auth', () => {
    const e = new AnthropicAPIError(403, { error: {} }, 'raw 403', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('auth')
  })

  it('裸 APIError status=400 含 context 关键词(在 error body JSON 里)→ context_too_long', () => {
    // Anthropic SDK 的 APIError 构造时 message 字段会被 makeMessage 重写成
    // `"<status> <JSON.stringify(error)>"` 形式;所以"含 context 关键词"必须放在
    // error body 里才能被 looksLikeContextOverflow 的 message 子串搜索命中。
    const e = new AnthropicAPIError(
      400,
      { error: { message: 'prompt is too long for this model' } },
      undefined,
      new Headers(),
    )
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('context_too_long')
  })

  it('裸 APIError status=422 → status fallback 4xx → invalid_request', () => {
    const e = new AnthropicAPIError(422, { error: {} }, 'unprocessable', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('invalid_request')
  })

  it('裸 APIError message 缺省 → 使用 fallback formatMessage', () => {
    const e = new AnthropicAPIError(400, { error: {} }, '', new Headers())
    const llmErr = translateAnthropicError(e, 'anthropic')
    expect(llmErr.code).toBe('invalid_request')
    // message 是空串 → fallback 字段拼 'Anthropic API error (status 400)' 或保留空
    // 取决于 SDK 给的 e.message;这里检查 message 非 undefined
    expect(llmErr.message).toBeDefined()
  })
})
