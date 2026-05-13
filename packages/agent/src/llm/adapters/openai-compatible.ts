/**
 * Phase 12 Task C：OpenAI 兼容 provider adapter。
 *
 * 一份 adapter 服务 5 个 provider(openai / zhipu / deepseek / moonshot / qwen):
 * - 协议层完全一致(都是 /v1/chat/completions + streaming chunk shape 兼容 OpenAI)
 * - 只是 baseURL / 默认 model 不同
 *
 * `cfg.baseUrl` 用户填的 > DEFAULT_BASE_URLS[cfg.id] > openai 兜底。
 * `cfg.model` 同理(用户在 settings 里可覆盖默认 model)。
 *
 * 错误翻译走 `translateOpenAIError`,按 OpenAI SDK 抛的 APIError 子类 + status code
 * 映射到 LLMErrorCode 6 元桶。详细映射:
 *
 * | OpenAI SDK error          | status | code              | retryable |
 * |---------------------------|--------|-------------------|-----------|
 * | AuthenticationError       | 401    | auth              | false     |
 * | PermissionDeniedError     | 403    | auth              | false     |
 * | RateLimitError            | 429    | rate_limit        | true      |
 * | BadRequestError(含 context)| 400    | context_too_long  | false     |
 * | BadRequestError(其他)      | 400    | invalid_request   | false     |
 * | InternalServerError       | 5xx    | network           | true      |
 * | APIConnectionError        | -      | network           | true      |
 * | APIConnectionTimeoutError | -      | network           | true      |
 * | 其他/未知                  | -      | unknown           | false     |
 *
 * `cause: e` 透传原始 SDK error,让 logger / 告警 / 排查能拿到 SDK 的 request_id / param 等
 * 元数据(LLMError.cause 在 errors.ts 已定义为 readonly + override)。
 */

import OpenAI from 'openai'
import { LLMError, type LLMErrorCode } from '../errors.js'
import type { LLMProvider, ProviderConfig } from '../provider.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'
import { fromOpenAIStream } from '../translate/from-openai-stream.js'
import { toOpenAIMessages, toOpenAITools } from '../translate/to-openai.js'

// OpenAI SDK 把 APIError 系列都挂在 OpenAI namespace 上,但暴露的是 class 值不是类型;
// 用 InstanceType 把 class 转成实例类型给 TS 用。
type OpenAIAPIError = InstanceType<typeof OpenAI.APIError>

/**
 * 5 个 OpenAI 兼容 provider 的默认 base URL。用户在 settings 里填了 baseUrl 时**完全
 * 覆盖**(不做 path merge),让中转代理 / 内网网关有完整控制。
 */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

/**
 * 每个 provider 的默认 model:跟 settings.ts 的 ActiveProviderId union 对齐。
 * 这里只是 fallback,用户在 settings 配 cfg.model 时优先用 cfg.model。
 */
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  zhipu: 'GLM-5.1',
  deepseek: 'deepseek-chat',
  moonshot: 'moonshot-v1-8k',
  qwen: 'qwen-plus',
}

export function createOpenAICompatibleProvider(cfg: ProviderConfig): LLMProvider {
  const baseURL = cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.id] ?? DEFAULT_BASE_URLS.openai!
  const model = cfg.model ?? DEFAULT_MODELS[cfg.id] ?? 'gpt-4o'
  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL })

  return {
    id: cfg.id,
    family: 'openai-compatible',
    async *streamChat(
      req: CanonicalChatRequest,
      signal: AbortSignal,
    ): AsyncIterable<CanonicalEvent> {
      let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
      try {
        stream = await client.chat.completions.create(
          {
            model,
            stream: true,
            // include_usage:让最后一个 chunk 带 prompt/completion_tokens
            stream_options: { include_usage: true },
            messages: toOpenAIMessages(req.messages),
            tools: req.tools && req.tools.length > 0 ? toOpenAITools(req.tools) : undefined,
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            top_p: req.topP,
            stop: req.stopSequences,
          },
          { signal },
        )
      } catch (e) {
        throw translateOpenAIError(e, cfg.id)
      }

      try {
        yield* fromOpenAIStream(stream)
      } catch (e) {
        // streaming 中途的错误(网络中断 / chunk 解析失败)同样走翻译
        throw translateOpenAIError(e, cfg.id)
      }
    },
  }
}

/**
 * OpenAI SDK error → LLMError 翻译。
 *
 * 设计:**先按 SDK 子类 instanceof**(语义最准),再 fallback 到 status 数字判断
 * (兼容 mock / SDK 更新版本/中转 proxy 抛裸 HTTP error 的场景)。
 */
export function translateOpenAIError(e: unknown, providerId: string): LLMError {
  // 已经是 LLMError,直接 rethrow(不应该发生,防御性)
  if (e instanceof LLMError) return e

  // 1. SDK 抛的 APIError 体系
  if (e instanceof OpenAI.APIError) {
    const { code, retryable } = classifyApiError(e)
    return new LLMError(formatMessage(e), code, providerId, retryable, e)
  }

  // 2. 普通 Error / 网络错(AbortError 留给 caller 上层处理,通常 controller.abort 已 throw)
  if (e instanceof Error) {
    const msg = e.message ?? 'unknown error'
    // AbortError 不 retryable,但属于 caller 主动取消,canonical 没有专门 code;
    // 上游路由会感知 signal.aborted,这里走 'unknown' 兜底。
    if (e.name === 'AbortError') {
      return new LLMError(msg, 'unknown', providerId, false, e)
    }
    // 通用 Error 视为 network(很可能是 fetch 层失败)
    return new LLMError(msg, 'network', providerId, true, e)
  }

  // 3. 非 Error 抛(SDK / 中转偶尔抛 plain object)
  return new LLMError('unknown error', 'unknown', providerId, false, e)
}

function classifyApiError(e: OpenAIAPIError): { code: LLMErrorCode; retryable: boolean } {
  // 优先用 SDK 子类做精确匹配
  if (e instanceof OpenAI.AuthenticationError) return { code: 'auth', retryable: false }
  if (e instanceof OpenAI.PermissionDeniedError) return { code: 'auth', retryable: false }
  if (e instanceof OpenAI.RateLimitError) return { code: 'rate_limit', retryable: true }
  if (e instanceof OpenAI.InternalServerError) return { code: 'network', retryable: true }
  if (e instanceof OpenAI.APIConnectionError) return { code: 'network', retryable: true }

  if (e instanceof OpenAI.BadRequestError) {
    return { code: looksLikeContextOverflow(e) ? 'context_too_long' : 'invalid_request', retryable: false }
  }

  // 没匹配到具体子类:按 status code 兜底(中转 proxy 可能抛裸 APIError,subclass 不准)
  const status = typeof e.status === 'number' ? e.status : 0
  if (status === 401 || status === 403) return { code: 'auth', retryable: false }
  if (status === 429) return { code: 'rate_limit', retryable: true }
  if (status >= 500 && status < 600) return { code: 'network', retryable: true }
  if (status === 400) {
    return { code: looksLikeContextOverflow(e) ? 'context_too_long' : 'invalid_request', retryable: false }
  }
  if (status >= 400 && status < 500) return { code: 'invalid_request', retryable: false }

  return { code: 'unknown', retryable: false }
}

/**
 * 400 BadRequest 里区分 context_too_long vs 普通 invalid_request。
 * 三家中文 / 英文报错关键词都看一遍:OpenAI 常用 "context_length_exceeded" / "maximum context length",
 * GLM / qwen 中文版可能写 "token limit" / "上下文长度"。
 */
function looksLikeContextOverflow(e: OpenAIAPIError): boolean {
  const haystack = `${e.message ?? ''} ${e.code ?? ''}`.toLowerCase()
  return (
    haystack.includes('context_length_exceeded') ||
    haystack.includes('maximum context length') ||
    haystack.includes('token limit') ||
    haystack.includes('context length') ||
    haystack.includes('上下文长度')
  )
}

function formatMessage(e: OpenAIAPIError): string {
  // APIError.message 已包含 status / param 等;直接用即可
  return e.message ?? `OpenAI API error (status ${e.status ?? 'unknown'})`
}
