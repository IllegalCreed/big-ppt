/**
 * Phase 12 Task B：先放最小 type 定义让 provider.ts 能 import。
 *
 * Task F 会扩展为完整 zod schema + `parseLlmSettings` + `migrateLegacySettings`
 * 函数(老 `{provider, apiKey, model, baseUrl, apiType}` shape → 新扁平
 * active+providers 结构,迁移脚本 `scripts/migrate-llm-settings.mjs` 调本文件)。
 *
 * Phase 12 Task E:补一个**最小** `parseLlmSettings` runtime check 让 routes/llm.ts
 * 可以接通新 canonical 路径。Task F 会把这函数换成 zod schema 校验 + 老 shape
 * migration helper,本 Task 不写 settings.ts 单测——Task F 会一并补完整覆盖。
 *
 * **本 Task E 完成后 dev 服务对现有用户 LLM 路由会报错**:user.llmSettings 入库
 * 还是 Phase 5 起的老 `{provider, apiKey, ...}` shape,parseLlmSettings 拿不到
 * activeProvider 就抛。这是预期的——Task F migration script 跑过 dev DB 后才修复。
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

/**
 * Phase 12 Task E 临时实现:仅做 minimal runtime type narrowing,Task F 会换成
 * zod schema + 老 shape migration。本函数有意**不**支持 Phase 5 起的老
 * `{provider, apiKey, model, baseUrl}` shape——那部分由 Task F 的 migration
 * script 在 DB 层一次性重写,routes/llm.ts 看到的永远是新 shape。
 *
 * 抛错类型说明:全部用普通 `Error`,route handler 会把 message 包进 500/400 JSON
 * 返回给 frontend。Task F 替换后 zod 错误 message 更详细。
 */
export function parseLlmSettings(raw: unknown): LlmSettings {
  if (!raw || typeof raw !== 'object') {
    throw new Error('llm_settings 不是 object')
  }
  const s = raw as Partial<LlmSettings>
  if (!s.activeProvider) {
    throw new Error('llm_settings 缺 activeProvider')
  }
  if (!s.providers || typeof s.providers !== 'object') {
    throw new Error('llm_settings 缺 providers')
  }
  const cfg = s.providers[s.activeProvider]
  if (!cfg?.apiKey) {
    throw new Error(`active provider "${s.activeProvider}" 缺 apiKey`)
  }
  return s as LlmSettings
}
