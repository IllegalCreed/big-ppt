/**
 * Phase 12 Task B：先放最小 type 定义让 provider.ts 能 import。
 *
 * Task F 会扩展为完整 zod schema + `parseLlmSettings` + `migrateLegacySettings`
 * 函数(老 `{provider, apiKey, model, baseUrl, apiType}` shape → 新扁平
 * active+providers 结构,迁移脚本 `scripts/migrate-llm-settings.mjs` 调本文件)。
 *
 * 本 Task 不写单测——Task F 会一并补完整覆盖。
 */

export type ProviderConfigEntry = {
  apiKey: string
  model?: string
  baseUrl?: string
}

export type ActiveProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'zhipu'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'

export type LlmSettings = {
  activeProvider: ActiveProviderId
  providers: Partial<Record<ActiveProviderId, ProviderConfigEntry>>
  advanced?: {
    anthropic?: {
      promptCaching?: boolean
      thinkingEnabled?: boolean
      thinkingBudgetTokens?: number
    }
    gemini?: {
      jsonMode?: boolean
      longContextStrategy?: 'truncate' | 'segment'
    }
    common?: {
      temperature?: number
      maxTokens?: number
      topP?: number
      stopSequences?: string[]
    }
  }
}
