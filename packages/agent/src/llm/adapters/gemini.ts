/**
 * Phase 12 Task H:Gemini 原生 provider adapter。
 *
 * 三个核心区别(对比 OpenAI / Anthropic adapter):
 *
 * 1. **结构化输出 vs tools 互斥**:Gemini API spec 不允许同时启用 `tools.functionDeclarations`
 *    跟 `responseSchema`(会返 400)。canonical request 若同时配,**tools 优先**,
 *    structuredOutput silent drop + console.warn(plan §Task H 技术细节 #6)。
 *
 * 2. **AbortSignal 透传**:Gemini SDK `generateContentStream` 接受 `config.abortSignal`
 *    字段(跟 OpenAI 的 `{ signal }` 参数位置不同)。adapter 把 canonical signal 透传
 *    到 config 内层(plan §Task H 技术细节 #9)。
 *
 * 3. **systemInstruction 走 config 字段**:Gemini 的 system 不是 messages 数组里的
 *    一条,而是 config.systemInstruction 独立字段(Content shape)。translate 层
 *    `toGeminiInput` 返 `{ systemInstruction?, contents }`,adapter 把 systemInstruction
 *    塞进 config(plan §Task H 技术细节 #3)。
 *
 * **错误翻译** `translateGeminiError`:Gemini SDK 抛 `ApiError`(单一类,没子类),
 * 按 `status` 数字 + 消息子串映射到 LLMErrorCode 6 元桶:
 *
 * | Gemini SDK error / 触发条件 | status | code              | retryable |
 * |---------------------------|--------|-------------------|-----------|
 * | ApiError status=401       | 401    | auth              | false     |
 * | ApiError status=403       | 403    | auth              | false     |
 * | ApiError status=429       | 429    | rate_limit        | true      |
 * | ApiError status=400 含 context/token | 400 | context_too_long | false  |
 * | ApiError status=400 其他   | 400    | invalid_request   | false     |
 * | ApiError status=4xx 其他   | 4xx    | invalid_request   | false     |
 * | ApiError status=5xx       | 5xx    | network           | true      |
 * | AbortError                | -      | unknown           | false     |
 * | 普通 Error                 | -      | network           | true      |
 * | 其它                       | -      | unknown           | false     |
 *
 * 默认 model `gemini-2.5-flash`(Task A 探测 duckcoding 中转支持的模型)。
 */

import { GoogleGenAI, ApiError as GeminiApiError } from '@google/genai'
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai'
import { LLMError, type LLMErrorCode } from '../errors.js'
import type { LLMProvider, ProviderConfig } from '../provider.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'
import { fromGeminiStream } from '../translate/from-gemini-stream.js'
import { toGeminiInput, toGeminiTools } from '../translate/to-gemini.js'

const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * SDK client 工厂(测试可覆盖)。生产路径 `new GoogleGenAI(opts)`,测试期可注入
 * 返 mock client 的工厂跳过真 SDK 实例化(参考 from-gemini-stream 的 _idSource 模式)。
 */
type GeminiClientFactory = (opts: {
  apiKey: string
  httpOptions?: { baseUrl?: string }
}) => Pick<GoogleGenAI, 'models'>

let _clientFactory: GeminiClientFactory = (opts) => new GoogleGenAI(opts)

/**
 * @internal 仅测试用:注入 mock client 工厂。传 null 恢复默认 SDK 实例化。
 */
export function __setClientFactoryForTesting(fn: GeminiClientFactory | null): void {
  _clientFactory = fn ?? ((opts) => new GoogleGenAI(opts))
}

export function createGeminiProvider(cfg: ProviderConfig): LLMProvider {
  const client = _clientFactory({
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl ? { httpOptions: { baseUrl: cfg.baseUrl } } : {}),
  })
  const model = cfg.model ?? DEFAULT_MODEL

  return {
    id: cfg.id,
    family: 'gemini',
    async *streamChat(
      req: CanonicalChatRequest,
      signal: AbortSignal,
    ): AsyncIterable<CanonicalEvent> {
      const { systemInstruction, contents } = toGeminiInput(req.messages)
      const hasTools = !!(req.tools && req.tools.length > 0)
      const hasStructuredOutput = !!req.structuredOutput

      // tools + structuredOutput 互斥:tools 优先,structuredOutput silent drop + warn
      if (hasTools && hasStructuredOutput) {
        console.warn(
          '[gemini-adapter] both tools and structuredOutput specified; preferring tools and dropping structuredOutput (Gemini API does not allow both)',
        )
      }

      const config: GenerateContentParameters['config'] = {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(hasTools && req.tools ? { tools: toGeminiTools(req.tools) } : {}),
        ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
        ...(typeof req.maxTokens === 'number' ? { maxOutputTokens: req.maxTokens } : {}),
        ...(typeof req.topP === 'number' ? { topP: req.topP } : {}),
        ...(req.stopSequences && req.stopSequences.length > 0
          ? { stopSequences: req.stopSequences }
          : {}),
        // structuredOutput 仅在 no-tools 路径生效
        ...(!hasTools && hasStructuredOutput && req.structuredOutput
          ? {
              responseMimeType: 'application/json',
              responseSchema: req.structuredOutput.schema as GenerateContentParameters['config'] extends infer C
                ? C extends { responseSchema?: infer S }
                  ? S
                  : never
                : never,
            }
          : {}),
        // SDK 接受 AbortSignal 在 config 内层
        abortSignal: signal,
      }

      const params: GenerateContentParameters = {
        model,
        contents,
        config,
      }

      let stream: AsyncIterable<GenerateContentResponse>
      try {
        stream = await client.models.generateContentStream(params)
      } catch (e) {
        throw translateGeminiError(e, cfg.id)
      }

      try {
        yield* fromGeminiStream(stream)
      } catch (e) {
        throw translateGeminiError(e, cfg.id)
      }
    },
  }
}

/**
 * Gemini SDK error → LLMError 翻译。
 *
 * SDK 抛 `ApiError`(只有 status + message,没子类);其余可能是 AbortError / 普通 Error /
 * non-Error。先 `instanceof ApiError` 走 status-based 分类,再 fallback。
 */
export function translateGeminiError(e: unknown, providerId: string): LLMError {
  if (e instanceof LLMError) return e

  if (e instanceof GeminiApiError) {
    const { code, retryable } = classifyApiError(e)
    return new LLMError(formatMessage(e), code, providerId, retryable, e)
  }

  if (e instanceof Error) {
    const msg = e.message ?? 'unknown error'
    if (e.name === 'AbortError') {
      return new LLMError(msg, 'unknown', providerId, false, e)
    }
    return new LLMError(msg, 'network', providerId, true, e)
  }

  return new LLMError('unknown error', 'unknown', providerId, false, e)
}

function classifyApiError(e: GeminiApiError): { code: LLMErrorCode; retryable: boolean } {
  const status = typeof e.status === 'number' ? e.status : 0
  if (status === 401 || status === 403) return { code: 'auth', retryable: false }
  if (status === 429) return { code: 'rate_limit', retryable: true }
  if (status >= 500 && status < 600) return { code: 'network', retryable: true }
  if (status === 400) {
    return {
      code: looksLikeContextOverflow(e) ? 'context_too_long' : 'invalid_request',
      retryable: false,
    }
  }
  if (status >= 400 && status < 500) return { code: 'invalid_request', retryable: false }
  return { code: 'unknown', retryable: false }
}

/**
 * 400 BadRequest 里区分 context_too_long vs 普通 invalid_request。
 *
 * Gemini 报错关键词:`token` / `context` / `prompt is too long` / `maximum input` / 中文上下文。
 */
function looksLikeContextOverflow(e: GeminiApiError): boolean {
  const haystack = `${e.message ?? ''}`.toLowerCase()
  return (
    haystack.includes('token limit') ||
    haystack.includes('context length') ||
    haystack.includes('context window') ||
    haystack.includes('prompt is too long') ||
    haystack.includes('input too long') ||
    haystack.includes('maximum input') ||
    haystack.includes('上下文长度') ||
    // Gemini 常见提示:"The input token count ... exceeds the maximum"
    (haystack.includes('input token') && haystack.includes('exceed')) ||
    (haystack.includes('token count') && haystack.includes('exceed'))
  )
}

function formatMessage(e: GeminiApiError): string {
  return e.message ?? `Gemini API error (status ${e.status ?? 'unknown'})`
}
