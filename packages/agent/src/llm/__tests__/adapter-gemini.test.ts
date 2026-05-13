/**
 * Phase 12 Task H:gemini adapter 单测。
 *
 * 策略:Gemini SDK 的 `generateContentStream` 是 `Models` 实例的 arrow function
 * (assigned in constructor),**不在 prototype 上**,所以 `vi.spyOn(Models.prototype, ...)`
 * 拿不到。改用 adapter 暴露的 `__setClientFactoryForTesting` 注入 mock client:
 * - 测试给个返回 fake `generateContentStream` 的 mock client
 * - 验 streamChat 传给 SDK 的 params(model / contents / config)正确
 * - 验 error 翻译
 *
 * 覆盖目标:
 * - factory 路径:默认 model gemini-2.5-flash + override
 * - baseUrl 透传到 SDK 构造器(httpOptions.baseUrl)
 * - streamChat 走通:转 canonical → SDK params → stream → translate canonical events
 * - systemInstruction 透传到 config.systemInstruction
 * - tools 空 / 非空 时 config.tools 的 shape
 * - structuredOutput 单独场景 → config.responseMimeType + responseSchema
 * - tools + structuredOutput 互斥 → tools 优先,structuredOutput silent drop + warn
 * - signal 透传给 SDK 的 config.abortSignal
 * - error 翻译:6 个 LLMErrorCode 各覆盖一遍 + non-Error 兜底
 */

import { GoogleGenAI, ApiError as GeminiApiError } from '@google/genai'
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGeminiProvider,
  translateGeminiError,
  __setClientFactoryForTesting,
} from '../adapters/gemini.js'
import { __setIdSourceForTesting } from '../translate/from-gemini-stream.js'
import { LLMError } from '../errors.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'

/**
 * Fake stream 工厂:返一段 text + finish。
 */
async function* fakeGeminiStream(): AsyncIterable<GenerateContentResponse> {
  yield {
    candidates: [
      {
        content: { parts: [{ text: 'hi' }], role: 'model' },
      },
    ],
  } as unknown as GenerateContentResponse
  yield {
    candidates: [
      {
        content: { parts: [], role: 'model' },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 5,
      candidatesTokenCount: 2,
      totalTokenCount: 7,
    },
  } as unknown as GenerateContentResponse
}

type MockClient = Pick<GoogleGenAI, 'models'>

/**
 * 创建 mock client:
 * - generateContentStream 返 stream factory 给的 AsyncIterable
 * - 记录 params 让单测断言
 */
function makeMockClient(opts: {
  stream?: () => AsyncIterable<GenerateContentResponse>
  throwErr?: unknown
  capture?: { params?: GenerateContentParameters }
  ctorOpts?: { apiKey?: string; httpOptions?: { baseUrl?: string } }
}): MockClient {
  const stream = opts.stream ?? fakeGeminiStream
  return {
    models: {
      generateContentStream: async (params: GenerateContentParameters) => {
        if (opts.capture) opts.capture.params = params
        if (opts.throwErr !== undefined) {
          throw opts.throwErr
        }
        return stream()
      },
    } as unknown as GoogleGenAI['models'],
  }
}

let capturedClientOpts: { apiKey?: string; httpOptions?: { baseUrl?: string } } = {}
let capturedParams: { params?: GenerateContentParameters } = {}

beforeEach(() => {
  // 注入确定性 id 让 functionCall id 可断言
  __setIdSourceForTesting(() => 'testid01')
  capturedClientOpts = {}
  capturedParams = {}
})

afterEach(() => {
  __setClientFactoryForTesting(null)
  __setIdSourceForTesting(null)
  vi.restoreAllMocks()
})

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

/**
 * 装上 mock client 工厂,顺便记录 ctor opts(让单测能断言 apiKey / baseUrl 透传)。
 */
function installMockFactory(opts: {
  stream?: () => AsyncIterable<GenerateContentResponse>
  throwErr?: unknown
} = {}): void {
  __setClientFactoryForTesting((ctorOpts) => {
    Object.assign(capturedClientOpts, ctorOpts)
    return makeMockClient({
      ...opts,
      capture: capturedParams,
    })
  })
}

describe('createGeminiProvider — factory 默认值', () => {
  it('id=gemini → 默认 model=gemini-2.5-flash', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'ai-test' })

    expect(provider.id).toBe('gemini')
    expect(provider.family).toBe('gemini')

    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))

    expect(capturedParams.params?.model).toBe('gemini-2.5-flash')
  })

  it('cfg.model 覆盖默认值', async () => {
    installMockFactory()
    const provider = createGeminiProvider({
      id: 'gemini',
      apiKey: 'ai-test',
      model: 'gemini-2.5-pro',
    })
    await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
    expect(capturedParams.params?.model).toBe('gemini-2.5-pro')
  })

  it('apiKey 透传到 SDK 构造器', async () => {
    installMockFactory()
    createGeminiProvider({ id: 'gemini', apiKey: 'special-key' })
    expect(capturedClientOpts.apiKey).toBe('special-key')
  })

  it('cfg.baseUrl 透传到 SDK 的 httpOptions.baseUrl', async () => {
    installMockFactory()
    createGeminiProvider({
      id: 'gemini',
      apiKey: 'k',
      baseUrl: 'https://duckcoding.example/v1beta',
    })
    expect(capturedClientOpts.httpOptions).toEqual({
      baseUrl: 'https://duckcoding.example/v1beta',
    })
  })

  it('cfg.baseUrl 未指定 → SDK 构造器不带 httpOptions', async () => {
    installMockFactory()
    createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    expect(capturedClientOpts.httpOptions).toBeUndefined()
  })
})

describe('createGeminiProvider — streamChat 走通', () => {
  it('canonical request → 转 Gemini params → 翻译成 canonical events', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })

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

    const params = capturedParams.params!
    expect(params.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
    expect(params.config?.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'be brief' }],
    })
    expect(params.config?.temperature).toBe(0.7)
    expect(params.config?.maxOutputTokens).toBe(1024)
    expect(params.config?.topP).toBe(0.9)
    expect(params.config?.stopSequences).toEqual(['END'])
  })

  it('tools 空数组 → config.tools = undefined(不发空数组)', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [] },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.tools).toBeUndefined()
  })

  it('tools 非空 → config.tools 经 toGeminiTools 包装', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
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
    expect(capturedParams.params?.config?.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'mcp__a__b',
            description: 'do thing',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ])
  })

  it('structuredOutput 单独 → config.responseMimeType + responseSchema', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'extract' }] }],
          structuredOutput: { schema },
        },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.responseMimeType).toBe('application/json')
    expect(capturedParams.params?.config?.responseSchema).toEqual(schema)
  })

  it('structuredOutput schema 含 additionalProperties / $ref / oneOf → 走 sanitizeForGemini drop', async () => {
    installMockFactory()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    // 用户给的 JSON Schema 含 Gemini 不支持字段:adapter 必须先 sanitize 再送 SDK,
    // 否则 Gemini API 直接 400(code reviewer 指出的 bug)
    const dirtySchema = {
      type: 'object',
      additionalProperties: false,
      $ref: '#/definitions/Foo',
      oneOf: [{ type: 'string' }],
      properties: {
        name: { type: 'string' },
        nested: {
          type: 'object',
          additionalProperties: true,
          properties: { x: { type: 'number' } },
        },
      },
    }
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'extract' }] }],
          structuredOutput: { schema: dirtySchema },
        },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.responseSchema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nested: {
          type: 'object',
          properties: { x: { type: 'number' } },
        },
      },
    })
    // 至少 4 次 warn(顶层 additionalProperties / $ref / oneOf + nested additionalProperties)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('tools + structuredOutput 同时 → tools 优先 + structuredOutput silent drop + warn', async () => {
    installMockFactory()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
          tools: [
            {
              name: 'mcp__a__b',
              description: 'd',
              inputSchema: { type: 'object' },
            },
          ],
          structuredOutput: { schema: { type: 'object' } },
        },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.tools).toBeDefined()
    expect(capturedParams.params?.config?.responseMimeType).toBeUndefined()
    expect(capturedParams.params?.config?.responseSchema).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('preferring tools and dropping structuredOutput'),
    )
    warnSpy.mockRestore()
  })

  it('signal 透传给 SDK 的 config.abortSignal', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    const controller = new AbortController()
    await collect(provider.streamChat({ messages: [] }, controller.signal))
    expect(capturedParams.params?.config?.abortSignal).toBe(controller.signal)
  })

  it('no system → params.config.systemInstruction 字段不存在', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.systemInstruction).toBeUndefined()
  })

  it('no temperature / topP / maxTokens / stopSequences → config 不带这些字段', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    await collect(
      provider.streamChat(
        { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.temperature).toBeUndefined()
    expect(capturedParams.params?.config?.topP).toBeUndefined()
    expect(capturedParams.params?.config?.maxOutputTokens).toBeUndefined()
    expect(capturedParams.params?.config?.stopSequences).toBeUndefined()
  })

  it('stopSequences 空数组 → config 不带该字段', async () => {
    installMockFactory()
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    await collect(
      provider.streamChat(
        {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          stopSequences: [],
        },
        new AbortController().signal,
      ),
    )
    expect(capturedParams.params?.config?.stopSequences).toBeUndefined()
  })
})

describe('createGeminiProvider — error translation 端到端', () => {
  async function expectErr(factoryError: Error | unknown): Promise<LLMError> {
    installMockFactory({ throwErr: factoryError })
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
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

  it('ApiError status=401 → code=auth / retryable=false', async () => {
    const err = new GeminiApiError({ status: 401, message: 'invalid api key' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
    expect(llmErr.provider).toBe('gemini')
    expect(llmErr.cause).toBe(err)
  })

  it('ApiError status=403 → code=auth / retryable=false', async () => {
    const err = new GeminiApiError({ status: 403, message: 'forbidden' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('auth')
    expect(llmErr.retryable).toBe(false)
  })

  it('ApiError status=429 → code=rate_limit / retryable=true', async () => {
    const err = new GeminiApiError({ status: 429, message: 'rate limited' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('rate_limit')
    expect(llmErr.retryable).toBe(true)
  })

  it('ApiError status=400 含 "token limit" → code=context_too_long', async () => {
    const err = new GeminiApiError({
      status: 400,
      message: 'The input exceeds the token limit of this model',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
    expect(llmErr.retryable).toBe(false)
  })

  it('ApiError status=400 含 "context length" → code=context_too_long', async () => {
    const err = new GeminiApiError({
      status: 400,
      message: 'Maximum context length exceeded',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('ApiError status=400 含中文上下文长度 → code=context_too_long', async () => {
    const err = new GeminiApiError({
      status: 400,
      message: '输入超过模型上下文长度限制',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('ApiError status=400 含 "input token count exceeds maximum" → context_too_long', async () => {
    const err = new GeminiApiError({
      status: 400,
      message: 'The input token count 200000 exceeds the maximum allowed',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('context_too_long')
  })

  it('ApiError status=400 普通 → code=invalid_request', async () => {
    const err = new GeminiApiError({
      status: 400,
      message: 'invalid parameter: contents cannot be empty',
    })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('ApiError status=404 → status fallback → code=invalid_request', async () => {
    const err = new GeminiApiError({ status: 404, message: 'model not found' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.retryable).toBe(false)
  })

  it('ApiError status=500 → code=network / retryable=true', async () => {
    const err = new GeminiApiError({ status: 500, message: 'server boom' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('ApiError status=503 → code=network / retryable=true', async () => {
    const err = new GeminiApiError({ status: 503, message: 'unavailable' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('ApiError status=0(未知)→ code=unknown / retryable=false', async () => {
    const err = new GeminiApiError({ status: 0, message: 'odd' })
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('AbortError(普通 Error 命名)→ code=unknown / retryable=false', async () => {
    const err = new Error('user aborted')
    err.name = 'AbortError'
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
  })

  it('普通 Error(非 SDK)→ code=network / retryable=true', async () => {
    const err = new Error('fetch failed')
    const llmErr = await expectErr(err)
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })

  it('non-Error 抛 → code=unknown / retryable=false', async () => {
    const llmErr = await expectErr({ code: 'WEIRD' })
    expect(llmErr.code).toBe('unknown')
    expect(llmErr.retryable).toBe(false)
    expect(llmErr.cause).toEqual({ code: 'WEIRD' })
  })

  it('streaming 中途抛错 → 翻译成 LLMError', async () => {
    const failingStream = (async function* (): AsyncGenerator<GenerateContentResponse> {
      yield {
        candidates: [
          { content: { parts: [{ text: 'partial' }], role: 'model' } },
        ],
      } as unknown as GenerateContentResponse
      throw new Error('stream broke mid-flight')
    })()
    __setClientFactoryForTesting(() =>
      makeMockClient({
        stream: () => failingStream,
      }),
    )
    const provider = createGeminiProvider({ id: 'gemini', apiKey: 'k' })
    try {
      await collect(provider.streamChat({ messages: [] }, new AbortController().signal))
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError)
      expect((e as LLMError).code).toBe('network')
    }
  })
})

describe('translateGeminiError — 直接单测兜底场景', () => {
  it('已是 LLMError → 直接 return(防御性)', () => {
    const existing = new LLMError('already', 'rate_limit', 'gemini', true)
    expect(translateGeminiError(existing, 'gemini')).toBe(existing)
  })

  it('non-Error → code=unknown / retryable=false', () => {
    const err = translateGeminiError({ code: 'WEIRD' }, 'gemini')
    expect(err).toBeInstanceOf(LLMError)
    expect(err.code).toBe('unknown')
    expect(err.retryable).toBe(false)
    expect(err.cause).toEqual({ code: 'WEIRD' })
  })

  it('ApiError status 不在 4xx/5xx 区间 → code=unknown', () => {
    const e = new GeminiApiError({ status: 200, message: 'odd success' })
    const llmErr = translateGeminiError(e, 'gemini')
    expect(llmErr.code).toBe('unknown')
  })

  it('ApiError status=422 → code=invalid_request(fallback 4xx)', () => {
    const e = new GeminiApiError({ status: 422, message: 'unprocessable' })
    const llmErr = translateGeminiError(e, 'gemini')
    expect(llmErr.code).toBe('invalid_request')
  })

  it('ApiError message 缺省 → fallback message 拼接', () => {
    const e = new GeminiApiError({ status: 400, message: '' })
    const llmErr = translateGeminiError(e, 'gemini')
    // 落到 invalid_request,message 不空(SDK message=空 string,fallback 用模板)
    expect(llmErr.code).toBe('invalid_request')
    expect(llmErr.message).toBeDefined()
  })

  it('普通 Error 缺 message → code=network / retryable=true', () => {
    const e = new Error()
    const llmErr = translateGeminiError(e, 'gemini')
    expect(llmErr.code).toBe('network')
    expect(llmErr.retryable).toBe(true)
  })
})
