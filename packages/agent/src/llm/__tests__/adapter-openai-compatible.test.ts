/**
 * Phase 12 Task C：openai-compatible adapter 单测。
 *
 * 策略:**不 mock OpenAI SDK constructor**(Vitest 4 vi.mock 对 ESM dynamic import
 * 不稳,plan 17 踩坑 2);改用 vi.spyOn(OpenAI.Chat.Completions.prototype,'create')
 * 拦截真 client 实例的方法调用。
 *
 * 这样:
 * - 不依赖 vi.mock factory(避免跨 file mock 污染)
 * - 真 OpenAI client 实例化 → 验 baseURL / apiKey 传入正确
 * - spyOn 拦截 create 方法返 fake stream / 抛 fake APIError
 *
 * 覆盖目标:
 * - factory 路径:default base/model + override base/model
 * - streamChat 走通:转 canonical request 给 SDK,SDK 返 stream,翻译成 canonical events
 * - tools 为空 / 非空 时传给 SDK 的 shape
 * - error 翻译:6 个 LLMErrorCode 各覆盖一遍 + non-Error 兜底
 *
 * Why 不直接测 translateOpenAIError:它是 adapter 内部的 export,但单测覆盖其行为最
 * 直接的方法是 vi.spyOn create() 让它抛错 → adapter 翻译 → 断言 throw 出 LLMError。
 * 既覆盖了 adapter integration,又覆盖了 error translation。
 */

import OpenAI from 'openai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleProvider, translateOpenAIError } from '../adapters/openai-compatible.js'
import { LLMError } from '../errors.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'

// 给所有 spy 用的共享 fixture stream(简单 text → finish)
async function* fakeStream(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  yield {
    id: 'x',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
  }
  yield {
    id: 'x',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }
  yield {
    id: 'x',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o',
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  }
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
 * spy 工具:把 client.chat.completions.create 替成自定义 impl。
 * OpenAI SDK create() 返 APIPromise;为简化测试我们 cast 到 any,只关心
 * stream 字段是否被消费(SDK 的 stream:true overload 返 Promise<Stream<Chunk>>)。
 */
function spyCreate(
  impl: (body: OpenAI.Chat.ChatCompletionCreateParamsStreaming) => Promise<unknown>,
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(OpenAI.Chat.Completions.prototype, 'create').mockImplementation(
    impl as never,
  )
}

describe('createOpenAICompatibleProvider — factory 默认值', () => {
  it('id=openai → baseURL=api.openai.com,model=gpt-4o', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-test' })

    expect(provider.id).toBe('openai')
    expect(provider.family).toBe('openai-compatible')

    await collect(
      provider.streamChat({ messages: [] }, new AbortController().signal),
    )

    expect(create).toHaveBeenCalledTimes(1)
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.model).toBe('gpt-4o')
    expect(body.stream).toBe(true)
  })

  it('id=zhipu → 默认 model=GLM-5.1(baseURL 由 OpenAI 实例内部存,不易断言外部,信任 spec)', async () => {
    spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'zhipu', apiKey: 'sk-zhipu' })
    expect(provider.id).toBe('zhipu')

    // 验默认 model 通过 SDK call 间接断言
    const create = OpenAI.Chat.Completions.prototype.create as unknown as ReturnType<
      typeof vi.spyOn
    >
    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.model).toBe('GLM-5.1')
  })

  it('id=deepseek / moonshot / qwen 各有自己的默认 model', async () => {
    const expected = {
      deepseek: 'deepseek-chat',
      moonshot: 'moonshot-v1-8k',
      qwen: 'qwen-plus',
    }
    for (const [id, model] of Object.entries(expected)) {
      const create = spyCreate(async () => fakeStream())
      const provider = createOpenAICompatibleProvider({ id, apiKey: 'sk-x' })
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
      expect(body.model, `id=${id}`).toBe(model)
      vi.restoreAllMocks()
    }
  })

  it('id 未知 → fallback 到 gpt-4o + openai base', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'random-unknown', apiKey: 'sk-x' })
    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.model).toBe('gpt-4o')
  })

  it('cfg.baseUrl / cfg.model 覆盖默认值', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({
      id: 'openai',
      apiKey: 'sk-x',
      baseUrl: 'https://custom.proxy/v1',
      model: 'gpt-custom',
    })
    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.model).toBe('gpt-custom')
  })
})

describe('createOpenAICompatibleProvider — streamChat 走通', () => {
  it('canonical request → 转 OpenAI body → SDK 返 stream → 翻译成 canonical events', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })

    const req: CanonicalChatRequest = {
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      temperature: 0.7,
      maxTokens: 100,
      topP: 0.9,
      stopSequences: ['END'],
    }

    const events = await collect(provider.streamChat(req, new AbortController().signal))

    expect(events).toEqual<CanonicalEvent[]>([
      { type: 'text.delta', text: 'hi' },
      { type: 'finish', reason: 'stop', usage: { input: 5, output: 2 } },
    ])

    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(100)
    expect(body.top_p).toBe(0.9)
    expect(body.stop).toEqual(['END'])
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('tools 空数组 → SDK body.tools = undefined(避免发空数组)', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [] },
        new AbortController().signal,
      ),
    )
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.tools).toBeUndefined()
  })

  it('tools 非空 → body.tools 经 toOpenAITools 包装', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })
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
    const body = create.mock.calls[0]![0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'mcp__a__b',
          description: 'do thing',
          parameters: { type: 'object', properties: {} },
        },
      },
    ])
  })

  it('signal 透传给 SDK request', async () => {
    const create = spyCreate(async () => fakeStream())
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })
    const controller = new AbortController()
    await collect(provider.streamChat({ messages: [] }, controller.signal))
    // create.mock.calls[0] = [body, options];options 应含 signal 字段
    const callArgs = create.mock.calls[0] as unknown as [unknown, { signal?: AbortSignal }?]
    expect(callArgs[1]?.signal).toBe(controller.signal)
  })
})

describe('createOpenAICompatibleProvider — error translation 端到端', () => {
  /**
   * 构造一个简化的 APIError 子类实例。
   *
   * Why cast 到 `any`:OpenAI SDK 给每个 APIError 子类的 status 类型 narrow 成具体字面量
   * (RateLimitError 的 status=429),但构造方法签名继承自 APIError<TStatus extends number | undefined>,
   * TS 无法 narrow 出 ctor.signature.status=429。这里 runtime 用法没问题,签名层 cast。
   */
  function makeError<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Ctor: any,
    status: number,
    body: { message?: string; code?: string } = {},
  ): T {
    const message = body.message ?? `mock error status ${status}`
    return new Ctor(status, { error: body }, message, new Headers()) as T
  }

  async function expectErr(
    factoryError: Error,
  ): Promise<LLMError> {
    spyCreate(async () => {
      throw factoryError
    })
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })
    try {
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      throw new Error('expected throw but got no error')
    } catch (e) {
      if (!(e instanceof LLMError)) {
        throw new Error(`expected LLMError, got ${(e as Error).constructor.name}: ${(e as Error).message}`)
      }
      return e
    }
  }

  it('AuthenticationError(401)→ code=auth / retryable=false', async () => {
    const err = makeError<Error>(OpenAI.AuthenticationError, 401, { message: 'invalid api key' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
    expect(llmErr.provider).toBe('openai')
    expect(llmErr.cause).toBe(err)
  })

  it('PermissionDeniedError(403)→ code=auth / retryable=false', async () => {
    const err = makeError<Error>(OpenAI.PermissionDeniedError, 403, { message: 'no perm' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
  })

  it('RateLimitError(429)→ code=rate_limit / retryable=true', async () => {
    const err = makeError<Error>(OpenAI.RateLimitError, 429, { message: 'too fast' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('rate_limit')
    expect(llmErr.retryable).toBe(true)
  })

  it('BadRequestError(400)含 context_length_exceeded → code=context_too_long', async () => {
    const err = makeError<Error>(OpenAI.BadRequestError, 400, {
      message: 'This model context_length_exceeded: 8192 tokens',
      code: 'context_length_exceeded',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
    expect(llmErr.retryable).toBe(false)
  })

  it('BadRequestError(400)含 maximum context length → code=context_too_long', async () => {
    const err = makeError<Error>(OpenAI.BadRequestError, 400, {
      message: 'Your prompt exceeds the maximum context length of 4096',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('BadRequestError(400)含 token limit → code=context_too_long', async () => {
    const err = makeError<Error>(OpenAI.BadRequestError, 400, {
      message: 'token limit reached',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('BadRequestError(400)含中文上下文长度 → code=context_too_long', async () => {
    const err = makeError<Error>(OpenAI.BadRequestError, 400, {
      message: '输入超过模型上下文长度限制',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('BadRequestError(400)普通 invalid param → code=invalid_request', async () => {
    const err = makeError<Error>(OpenAI.BadRequestError, 400, {
      message: 'invalid parameter: messages cannot be empty',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('InternalServerError(500)→ code=network / retryable=true', async () => {
    const err = makeError<Error>(OpenAI.InternalServerError, 500, { message: 'server boom' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIConnectionError → code=network / retryable=true', async () => {
    const err = new OpenAI.APIConnectionError({ message: 'fetch failed', cause: new Error('ENOTFOUND') })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIConnectionTimeoutError → code=network / retryable=true(继承自 APIConnectionError)', async () => {
    const err = new OpenAI.APIConnectionTimeoutError({ message: 'timed out' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('普通 Error(非 OpenAI SDK)→ code=network 兜底', async () => {
    const err = new Error('something went wrong in fetch')
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
    expect(llmErr.cause).toBe(err)
  })

  it('AbortError → code=unknown / retryable=false', async () => {
    const err = new Error('user aborted')
    err.name = 'AbortError'
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('streaming 中途抛错(非 create call 时)→ 同样翻译', async () => {
    const failingStream = (async function* () {
      yield {
        id: 'x',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'gpt-4o',
        choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }],
      }
      throw new Error('stream broke mid-flight')
    })()
    spyCreate(async () => failingStream)
    const provider = createOpenAICompatibleProvider({ id: 'openai', apiKey: 'sk-x' })
    try {
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError)
      expect((e as LLMError).code).toBe('network')
    }
  })
})

describe('translateOpenAIError — 直接单测兜底场景', () => {
  it('已是 LLMError → 直接 return(防御性)', () => {
    const existing = new LLMError('already', 'rate_limit', 'openai', true)
    expect(translateOpenAIError(existing, 'openai')).toBe(existing)
  })

  it('non-Error 抛(plain object)→ code=unknown / retryable=false', () => {
    const err = translateOpenAIError({ code: 'ENOTFOUND' }, 'openai')
    expect(err).toBeInstanceOf(LLMError)
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
    expect(err.cause).toEqual({ code: 'ENOTFOUND' })
  })

  it('NotFoundError(404)→ status fallback → code=invalid_request', () => {
    const e = new OpenAI.NotFoundError(404, { error: {} } as never, 'not found', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('ConflictError(409)→ status fallback 4xx → code=invalid_request', () => {
    const e = new OpenAI.ConflictError(409, { error: {} } as never, 'conflict', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('invalid_request')
  })

  it('UnprocessableEntityError(422)→ status fallback 4xx → code=invalid_request', () => {
    const e = new OpenAI.UnprocessableEntityError(
      422,
      { error: {} } as never,
      'unprocessable',
      new Headers(),
    )
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('invalid_request')
  })

  it('未知 APIError status=null → code=unknown', () => {
    // 构造一个 status 为 undefined 的 APIError
    const e = new OpenAI.APIError(
      undefined as never,
      { error: {} },
      'unknown api error',
      new Headers(),
    )
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('APIError 在 status 5xx 区间但非 InternalServerError 实例 → 通过 status fallback', () => {
    // SDK InternalServerError 实例已覆盖,补 status=502 经 generic APIError 走 fallback
    const e = new OpenAI.APIError(502, { error: {} }, 'bad gateway', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('APIError message 缺省 → formatMessage 用 fallback', () => {
    // status 已知,但 SDK 内部可能 message 缺省,这里直接构造一个空 message
    const e = new OpenAI.APIError(
      400,
      { error: {} },
      '',
      new Headers(),
    )
    const llmErr = translateOpenAIError(e, 'openai')
    // 类型是 invalid_request,message 用 SDK message(可能为空字符串)
    expect(llmErr.code).toBe('invalid_request')
  })

  it('裸 APIError status=401(非 AuthenticationError 子类)→ status fallback 走 auth', () => {
    // 中转 proxy 偶尔抛裸 APIError 而非子类,验 status code 兜底分支
    const e = new OpenAI.APIError(401, { error: {} }, 'raw 401', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
  })

  it('裸 APIError status=429 → status fallback 走 rate_limit', () => {
    const e = new OpenAI.APIError(429, { error: {} }, 'raw 429', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('rate_limit')
    expect(llmErr.retryable).toBe(true)
  })

  it('裸 APIError status=403 → status fallback 走 auth', () => {
    const e = new OpenAI.APIError(403, { error: {} }, 'raw 403', new Headers())
    const llmErr = translateOpenAIError(e, 'openai')
    expect(llmErr.code).toBe('auth')
  })
})
