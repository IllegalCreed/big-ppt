/**
 * Phase 12 Task G:Anthropic 原生 provider adapter。
 *
 * 这是 Phase 12 核心价值点 —— prompt caching + extended thinking 在 OpenAI 兼容代理
 * 拿不到,只能走 Anthropic 原生 SDK。
 *
 * 设计点:
 * - `client.messages.stream(body, { signal })` 返 `MessageStream` 实例,实现
 *   AsyncIterable<RawMessageStreamEvent>,直接 `yield*` 给 from-anthropic-stream 状态机
 * - thinking 在 canonical request `req.thinking?.enabled` 为 true 时把
 *   `{ thinking: { type: 'enabled', budget_tokens } }` 拼进 body
 * - 默认 model `claude-sonnet-4-6`(Task A probe 验证 duckcoding 中转支持的 sonnet 主线;
 *   `claude-sonnet-4-5` 不支持)
 * - max_tokens 默认 8192(Anthropic 必填字段;canonical 没指定时给主线 Claude 一个合理默认)
 *
 * 错误翻译 `translateAnthropicError`:Anthropic SDK 抛 APIError 子类
 * (AuthenticationError / RateLimitError / BadRequestError 等),按 status + subclass
 * 映射到 LLMErrorCode 6 元桶。详细映射:
 *
 * | Anthropic SDK error    | status | code              | retryable |
 * |------------------------|--------|-------------------|-----------|
 * | AuthenticationError    | 401    | auth              | false     |
 * | PermissionDeniedError  | 403    | auth              | false     |
 * | RateLimitError         | 429    | rate_limit        | true      |
 * | BadRequestError(含 context)| 400 | context_too_long  | false     |
 * | BadRequestError(其他)   | 400    | invalid_request   | false     |
 * | InternalServerError    | 5xx    | network           | true      |
 * | APIConnectionError     | -      | network           | true      |
 * | APIUserAbortError      | -      | unknown           | false     |
 * | 普通 Error             | -      | network           | true      |
 * | 其他/未知              | -      | unknown           | false     |
 *
 * cause 透传原始 SDK error,让 logger / 排查能拿 request_id / 错误明细。
 */

import Anthropic, {
  APIError as AnthropicAPIError,
  AuthenticationError as AnthropicAuthError,
  PermissionDeniedError as AnthropicPermError,
  RateLimitError as AnthropicRateLimitError,
  BadRequestError as AnthropicBadRequestError,
  InternalServerError as AnthropicInternalError,
  APIConnectionError as AnthropicConnError,
  APIUserAbortError as AnthropicAbortError,
} from '@anthropic-ai/sdk'
import { LLMError, type LLMErrorCode } from '../errors.js'
import type { LLMProvider, ProviderConfig } from '../provider.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'
import { fromAnthropicStream } from '../translate/from-anthropic-stream.js'
import { toAnthropicInput, toAnthropicTools } from '../translate/to-anthropic.js'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 8192

export function createAnthropicProvider(cfg: ProviderConfig): LLMProvider {
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
  })
  const model = cfg.model ?? DEFAULT_MODEL

  return {
    id: cfg.id,
    family: 'anthropic',
    async *streamChat(
      req: CanonicalChatRequest,
      signal: AbortSignal,
    ): AsyncIterable<CanonicalEvent> {
      const { system, messages } = toAnthropicInput(req.messages)

      const body: Anthropic.Messages.MessageStreamParams = {
        model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages,
        ...(system !== undefined ? { system } : {}),
        ...(req.tools && req.tools.length > 0 ? { tools: toAnthropicTools(req.tools) } : {}),
        ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
        ...(typeof req.topP === 'number' ? { top_p: req.topP } : {}),
        ...(req.stopSequences && req.stopSequences.length > 0
          ? { stop_sequences: req.stopSequences }
          : {}),
        ...(req.thinking?.enabled
          ? {
              thinking: {
                type: 'enabled' as const,
                budget_tokens: req.thinking.budgetTokens ?? 5000,
              },
            }
          : {}),
      }

      let stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>
      try {
        stream = client.messages.stream(body, { signal })
      } catch (e) {
        throw translateAnthropicError(e, cfg.id)
      }

      try {
        yield* fromAnthropicStream(stream)
      } catch (e) {
        throw translateAnthropicError(e, cfg.id)
      }
    },
  }
}

/**
 * Anthropic SDK error → LLMError 翻译。
 *
 * **先按 SDK 子类 instanceof**(语义最准),再 fallback 到 status 数字判断
 * (兼容 mock / SDK 更新版本 / 中转 proxy 抛裸 APIError 的场景)。
 */
export function translateAnthropicError(e: unknown, providerId: string): LLMError {
  if (e instanceof LLMError) return e

  if (e instanceof AnthropicAbortError) {
    return new LLMError(e.message || 'request aborted', 'unknown', providerId, false, e)
  }

  if (e instanceof AnthropicAPIError) {
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

function classifyApiError(e: AnthropicAPIError): { code: LLMErrorCode; retryable: boolean } {
  // 优先用 SDK 子类做精确匹配
  if (e instanceof AnthropicAuthError) return { code: 'auth', retryable: false }
  if (e instanceof AnthropicPermError) return { code: 'auth', retryable: false }
  if (e instanceof AnthropicRateLimitError) return { code: 'rate_limit', retryable: true }
  if (e instanceof AnthropicInternalError) return { code: 'network', retryable: true }
  if (e instanceof AnthropicConnError) return { code: 'network', retryable: true }

  if (e instanceof AnthropicBadRequestError) {
    return {
      code: looksLikeContextOverflow(e) ? 'context_too_long' : 'invalid_request',
      retryable: false,
    }
  }

  // 没匹配到具体子类:按 status code 兜底(中转 proxy 可能抛裸 APIError)
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
 * 400 BadRequest 区分 context_too_long vs 普通 invalid_request。
 *
 * Anthropic 中英文报错关键词:`context_length` / `prompt is too long` /
 * `maximum context length` / `输入超过` 等。
 */
function looksLikeContextOverflow(e: AnthropicAPIError): boolean {
  const haystack = `${e.message ?? ''}`.toLowerCase()
  return (
    haystack.includes('context_length_exceeded') ||
    haystack.includes('prompt is too long') ||
    haystack.includes('too long') ||
    haystack.includes('maximum context length') ||
    haystack.includes('context length') ||
    haystack.includes('token limit') ||
    haystack.includes('上下文长度')
  )
}

function formatMessage(e: AnthropicAPIError): string {
  return e.message ?? `Anthropic API error (status ${e.status ?? 'unknown'})`
}
