/**
 * Phase 12 Task F:LLM 配置的 zod schema + 老 shape 迁移 helper。
 *
 * 历史:
 * - Phase 5 起 users.llm_settings 入库 shape:`{provider, apiKey, baseUrl?, model?, apiType?}`
 *   单 active provider 平铺,无法同时配多家。
 * - Phase 12 新 shape:`{activeProvider, providers: { [id]: { apiKey, model?, baseUrl? } }, advanced?}`
 *   多 provider 配置共存,active 一处指定,advanced 收口 Anthropic prompt caching /
 *   Gemini structured output / 通用 temperature 等 provider 特有调参。
 *
 * 本文件职责:
 * 1. `LlmSettingsSchema` —— zod schema,描述新 shape 完整结构(parse 失败抛 ZodError)。
 * 2. `parseLlmSettings(raw)` —— 解密后的 JSON → 类型安全 LlmSettings;失败抛错(route 转 500)。
 * 3. `migrateLegacySettings(legacy)` —— 老 shape `{provider, apiKey, ...}` → 新 shape;
 *    用在 migration script `scripts/migrate-llm-settings.mjs` 和兼容期"老用户首次访问触发"路径。
 *
 * 注意:本文件保持纯函数,**不**访问 DB / 不解密。DB / crypto 由 caller 负责
 * (route handler 或 migration script);本层只做 shape 转换 + 校验。
 *
 * Task E 的 minimal stub 由本 Task 替换。type shape 完全 backwards-compatible
 * (`activeProvider` / `providers` / `advanced` 字段名相同,只是从手写 type
 * 换成 `z.infer<typeof LlmSettingsSchema>`),不破坏 provider.ts / routes/llm.ts。
 */

import { z } from 'zod'

export const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
})

export type ProviderConfigEntry = z.infer<typeof ProviderConfigSchema>

export const ActiveProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'zhipu',
  'deepseek',
  'moonshot',
  'qwen',
])

export type ActiveProviderId = z.infer<typeof ActiveProviderIdSchema>

export const LlmSettingsSchema = z.object({
  activeProvider: ActiveProviderIdSchema,
  providers: z.object({
    openai: ProviderConfigSchema.optional(),
    anthropic: ProviderConfigSchema.optional(),
    gemini: ProviderConfigSchema.optional(),
    zhipu: ProviderConfigSchema.optional(),
    deepseek: ProviderConfigSchema.optional(),
    moonshot: ProviderConfigSchema.optional(),
    qwen: ProviderConfigSchema.optional(),
  }),
  advanced: z
    .object({
      anthropic: z
        .object({
          promptCaching: z.boolean().optional(),
          thinkingEnabled: z.boolean().optional(),
          thinkingBudgetTokens: z.number().int().positive().optional(),
        })
        .optional(),
      gemini: z
        .object({
          jsonMode: z.boolean().optional(),
          longContextStrategy: z.enum(['truncate', 'segment']).optional(),
        })
        .optional(),
      common: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().positive().optional(),
          topP: z.number().min(0).max(1).optional(),
          stopSequences: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
})

export type LlmSettings = z.infer<typeof LlmSettingsSchema>

/**
 * 解密后的 JSON 走 zod 校验。
 *
 * 失败时抛 ZodError(zod 自带的错误类型,extends Error)。route handler 把
 * `(e as Error).message` 包进 500 响应。本函数**不**支持 Phase 5 起的老
 * `{provider, apiKey, ...}` shape —— migrateLegacySettings 是专用通道,
 * 老 shape 直接走 parseLlmSettings 会抛"Invalid input"类的 zod 错误(并不漂亮,
 * 但 migration script 跑过后就不会再撞到)。
 */
export function parseLlmSettings(raw: unknown): LlmSettings {
  return LlmSettingsSchema.parse(raw)
}

/**
 * 老 shape → 新 shape 迁移。
 *
 * 用在:
 * - `scripts/migrate-llm-settings.mjs`:一次性把 users.llm_settings 全表 rewrite。
 * - (兼容期可选)老用户首次访问 LLM 路由时如果解密出的还是老 shape,
 *   route handler 可调本函数 → encrypt → 写回 DB → continue。Phase 12 决定走
 *   纯 migration script 路径,**不**做运行时 fallback(simpler,只要 deploy 前
 *   跑一次 migration:llm-settings:prod 就行)。
 *
 * 入参约定:`provider` 必须是 ActiveProviderIdSchema 的 7 个 id 之一,否则
 * 后续 parseLlmSettings 会因 activeProvider 不在白名单抛 zod 错。本函数**不**
 * 做白名单校验(migration script 期望"宽松接收 → 严格输出";哪条 row 老 shape
 * 的 provider id 不在白名单,script 处理 zod 错时记到 failed 列表)。
 *
 * baseUrl / model 在老 shape 是可选的;转换时**不**做 URL 校验,因为老数据可能
 * 有 trailing slash / 带 path 等"宽松"形态,migration 阶段保留原值由
 * parseLlmSettings 决定是否拒收。
 */
export function migrateLegacySettings(legacy: {
  provider: string
  apiKey: string
  baseUrl?: string
  model?: string
}): LlmSettings {
  return {
    activeProvider: legacy.provider as ActiveProviderId,
    providers: {
      [legacy.provider]: {
        apiKey: legacy.apiKey,
        ...(legacy.baseUrl !== undefined ? { baseUrl: legacy.baseUrl } : {}),
        ...(legacy.model !== undefined ? { model: legacy.model } : {}),
      },
    } as LlmSettings['providers'],
  }
}
