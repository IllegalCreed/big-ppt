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
 * 4. `getActiveProviderConfig(encrypted)` —— shape-agnostic 读取:同时兼容新/老两种 shape,
 *    所有非 canonical-route 的 llm_settings 消费者(rewriteForTemplate / MCP $LLM_KEY /
 *    Settings UI 兼容期 GET)走它,这样 migration 跑前后都能工作。
 *
 * 注意:除 `getActiveProviderConfig` 外本文件保持纯函数(不访问 DB / 不解密)。
 * `getActiveProviderConfig` 自己内部解密,接受**密文**串简化 caller。
 *
 * Task E 的 minimal stub 由本 Task 替换。type shape 完全 backwards-compatible
 * (`activeProvider` / `providers` / `advanced` 字段名相同,只是从手写 type
 * 换成 `z.infer<typeof LlmSettingsSchema>`),不破坏 provider.ts / routes/llm.ts。
 */

import { z } from 'zod'
import { decryptApiKey } from '../crypto/apikey.js'

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
  'mistral', // Phase 12.5
  'groq', // Phase 12.5
  'xai', // Phase 12.5
  'openrouter', // Phase 12.5
  'cerebras', // Phase 12.5
])

export type ActiveProviderId = z.infer<typeof ActiveProviderIdSchema>

/**
 * Phase 12.7 Task E:thinking 级别 6 档 enum,替换 boolean shape。
 *
 * 老 shape `thinkingEnabled: boolean` 在兼容期由 `parseLlmSettings` 预处理转换:
 * - `false` → `'off'`
 * - `true` → `'medium'`(沿用 pi-agent-core 默认 thinking 强度)
 *
 * 6 档对齐 pi-ai 0.74.0 `ThinkingLevel`(off / minimal / low / medium / high / xhigh)。
 */
export const ThinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>

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
    mistral: ProviderConfigSchema.optional(), // Phase 12.5
    groq: ProviderConfigSchema.optional(), // Phase 12.5
    xai: ProviderConfigSchema.optional(), // Phase 12.5
    openrouter: ProviderConfigSchema.optional(), // Phase 12.5
    cerebras: ProviderConfigSchema.optional(), // Phase 12.5
  }),
  advanced: z
    .object({
      anthropic: z
        .object({
          promptCaching: z.boolean().optional(),
          thinkingLevel: ThinkingLevelSchema.optional(),
          thinkingBudgetTokens: z.number().int().positive().optional(),
        })
        .optional(),
      gemini: z
        .object({
          jsonMode: z.boolean().optional(),
          longContextStrategy: z.enum(['truncate', 'segment']).optional(),
          thinkingLevel: ThinkingLevelSchema.optional(),
        })
        .optional(),
      common: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().positive().optional(),
          topP: z.number().min(0).max(1).optional(),
          stopSequences: z.array(z.string()).optional(),
          thinkingLevel: ThinkingLevelSchema.optional(),
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
 *
 * Phase 12.7 Task E 兼容预处理:输入 advanced.<scope>.thinkingEnabled(boolean)
 * 转 thinkingLevel(enum)再 zod。详见 normalizeThinkingFields。
 */
export function parseLlmSettings(raw: unknown): LlmSettings {
  return LlmSettingsSchema.parse(normalizeThinkingFields(raw))
}

/**
 * Phase 12.7 Task E:兼容期把 advanced.<scope>.thinkingEnabled(boolean)→
 * thinkingLevel(enum)。export 出去供 routes/auth.ts / routes/llm.ts 直接调
 * `LlmSettingsSchema.safeParse` 时同样走兼容路径(自身没经过 parseLlmSettings)。
 *
 * 触发条件:`advanced.anthropic` / `advanced.gemini` / `advanced.common` 任一
 * 子区有 `thinkingEnabled` 字段且无 `thinkingLevel` 字段。否则原样返回(不深拷贝
 * 避免 happy path 性能开销)。映射:`false → 'off'` / `true → 'medium'`。
 *
 * 设计取舍:zod preprocess 通用方案是 z.preprocess + transform,但这里 input
 * shape 是 unknown(可能 null / 字符串等)→ 走手写守护更稳。预处理后老字段被
 * 显式 delete,避免 zod strict mode 撞 unknown key,也避免 round-trip 把老字段
 * 再 echo 回 DB / GET 响应。
 */
export function normalizeThinkingFields(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const root = raw as Record<string, unknown>
  const advanced = root.advanced
  if (!advanced || typeof advanced !== 'object') return raw
  const advancedObj = advanced as Record<string, unknown>
  const scopes = ['anthropic', 'gemini', 'common'] as const
  let touched = false
  const nextAdvanced: Record<string, unknown> = { ...advancedObj }
  for (const scope of scopes) {
    const sub = advancedObj[scope]
    if (!sub || typeof sub !== 'object') continue
    const subObj = sub as Record<string, unknown>
    if (!('thinkingEnabled' in subObj)) continue
    const nextSub = { ...subObj }
    const enabled = subObj.thinkingEnabled
    delete nextSub.thinkingEnabled
    if (!('thinkingLevel' in nextSub)) {
      if (enabled === true) nextSub.thinkingLevel = 'medium'
      else if (enabled === false) nextSub.thinkingLevel = 'off'
      // 非 boolean(string / number 等)→ 不写 thinkingLevel,让 zod 拒收原值
    }
    nextAdvanced[scope] = nextSub
    touched = true
  }
  if (!touched) return raw
  return { ...root, advanced: nextAdvanced }
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

/**
 * 当前 active provider 的归一化 config view。
 *
 * Why 单独抽:Task F migration 之后 users.llm_settings 是新 shape,但仍有 6 个消费者
 * 直接读老 `{apiKey, provider, baseUrl, model}` 字段(rewriteForTemplate /
 * rewriteSinglePageToComponents / routes/mcp.ts:userHasLlmKey / mcp-registry/
 * registry.ts:fetchLlmKey / routes/auth.ts GET+PUT)。这些消费者都不是 canonical-route
 * 受众,改成 canonical 路径成本高(Phase 12 Task I 后续才处理 frontend)。
 * 本 helper 给它们一个 shape-agnostic 读法:同时支持新/老 shape,migration 跑前后
 * 都能拿到正确值。
 *
 * @param encryptedSettings - 加密的 `user.llmSettings` 串(原样从 DB 取出来)
 * @returns active 的 provider 配置(apiKey + baseUrl? + model? + provider id);
 *          解密 / parse / 校验失败均返 null(caller 处理 fallback)。
 *
 * 兼容判断:
 * - 含 `activeProvider` 字段 → 新 shape,走 zod 校验取 providers[activeProvider]
 * - 含 `apiKey` + `provider` 字段 → 老 shape,直接返字段
 * - 其它 → null(损坏或 shape 不识别)
 */
export function getActiveProviderConfig(encryptedSettings: string): {
  apiKey: string
  baseUrl?: string
  model?: string
  provider: string
} | null {
  let raw: unknown
  try {
    raw = JSON.parse(decryptApiKey(encryptedSettings))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // 新 shape:有 activeProvider 字段
  if (typeof obj.activeProvider === 'string') {
    const result = LlmSettingsSchema.safeParse(normalizeThinkingFields(raw))
    if (!result.success) return null
    const cfg = result.data.providers[result.data.activeProvider]
    if (!cfg?.apiKey) return null
    return {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      provider: result.data.activeProvider,
    }
  }

  // 老 shape:{provider, apiKey, baseUrl?, model?}
  if (typeof obj.apiKey === 'string' && typeof obj.provider === 'string') {
    const apiKey = obj.apiKey.trim()
    if (!apiKey) return null
    return {
      apiKey,
      provider: obj.provider,
      baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
      model: typeof obj.model === 'string' ? obj.model : undefined,
    }
  }

  return null
}
