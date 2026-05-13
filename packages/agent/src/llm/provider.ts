/**
 * Phase 12 Task B：LLMProvider interface + ProviderRegistry。
 *
 * - `LLMProvider`:三家 adapter 的统一接口。`streamChat` 接 canonical
 *   request 返 canonical event 流;`listModels` 可选,部分 provider 不支持
 *   就不实现。
 * - `ProviderRegistry`:**pure function-style** 工厂注册表(plan §关键设计
 *   抉择 #10)——`resolve(settings)` 按 active id 调对应 factory 出实例,
 *   **不**内部读 DB 或解密。DB 访问 + 解密 + zod 校验是 route handler
 *   职责;registry 完全可单测,未来加新 caller(如后台批处理用不同
 *   settings 来源)零成本。
 *
 * 本 Task 只搭骨架;真正的 factory 函数(`createOpenAIAdapter` 等)在
 * Task C / G / H 完成 adapter 后逐步注册进来。
 */

import type { CanonicalChatRequest, CanonicalEvent } from './types.js'
import type { LlmSettings } from './settings.js'

export type ProviderFamily = 'openai-compatible' | 'anthropic' | 'gemini'

export interface LLMProvider {
  readonly id: string
  readonly family: ProviderFamily
  streamChat(req: CanonicalChatRequest, signal: AbortSignal): AsyncIterable<CanonicalEvent>
  listModels?(): Promise<Array<{ id: string; description?: string }>>
}

export type ProviderConfig = {
  id: string
  apiKey: string
  model?: string
  baseUrl?: string
  advanced?: LlmSettings['advanced']
}

/**
 * 工厂注册表:按 user settings 构造 provider 实例。
 *
 * **Why ProviderRegistry.resolve(settings) 而非 get(userId)**:解耦关注点,
 * registry 只管「按 active id 构造 adapter」,DB/解密/校验留给 route
 * handler。这让 registry 100% pure 可单测,且新 caller(批处理 / cron 等
 * 用不同 settings 来源)零成本接入。
 */
export class ProviderRegistry {
  constructor(private readonly factories: Map<string, (cfg: ProviderConfig) => LLMProvider>) {}

  resolve(settings: LlmSettings): LLMProvider {
    const id = settings.activeProvider
    const cfg = settings.providers[id]
    if (!cfg) throw new Error(`active provider "${id}" 未配置 apiKey`)
    const factory = this.factories.get(id)
    if (!factory) throw new Error(`provider "${id}" adapter 未注册`)
    return factory({
      id,
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      advanced: settings.advanced,
    })
  }
}
