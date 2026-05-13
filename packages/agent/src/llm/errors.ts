/**
 * Phase 12 Task B：统一 LLM 错误类型。
 *
 * 三家 provider SDK 的错误形态各不相同(OpenAI 用 status code,Anthropic
 * 用 `APIError` 子类,Gemini 用 `GoogleGenerativeAIError`);adapter 层
 * 必须把它们正规化成 `LLMError`,这样上游路由 / 重试 / 告警逻辑只关心
 * `code` + `retryable`,不用 sniff 三家 SDK 的内部细节。
 *
 * - `code`:粗粒度桶,覆盖三家共同的错误大类。
 * - `retryable`:由 adapter 自行判断(429 / 5xx / 网络错通常 true,
 *   400 invalid_request / 401 auth 通常 false)。
 * - `provider`:出错的 adapter id,定位调用源。
 * - `cause`:原始 SDK 错误,保留给 logger / 告警深度排查。
 */

export type LLMErrorCode =
  | 'rate_limit'
  | 'auth'
  | 'network'
  | 'invalid_request'
  | 'context_too_long'
  | 'unknown'

export class LLMError extends Error {
  constructor(
    message: string,
    readonly code: LLMErrorCode,
    readonly provider: string,
    readonly retryable: boolean,
    // ES2022 起 Error 自带 `cause: unknown`,这里显式 override 用 readonly 锁定且
    // 让类型签名公开;tsconfig.base.json `noImplicitOverride: true` 要求 modifier。
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}
