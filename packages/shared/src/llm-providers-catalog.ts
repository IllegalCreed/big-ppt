/**
 * Phase 12 Task J:LLM provider 静态元信息目录（Phase 12.5 Task C 扩到 12 个）。
 *
 * 跨 agent + creator 复用的 12 个 provider 配置常量:每条含 id / 显示名 /
 * 默认 baseUrl(若适用)/ 默认 model / 协议族。Settings UI 用它渲染 12 张 provider
 * 卡片;后端 ProviderRegistry 也可在未来需要 default model fallback 时复用同一份。
 *
 * **唯一事实来源**:模板元数据归 `packages/slidev/templates/<id>/`,provider 元
 * 数据归本文件;不允许在 agent / creator 内重写硬编表(详见 CLAUDE.md 「模板
 * 元数据归属」节同款约束)。
 *
 * `as const` 保留 literal,推导出 `ProviderFamilyTag` 字面 union（5 个值含
 * mistral / xai）。
 *
 * **Two-type family 设计（intentional drift）**:
 * - `ProviderFamilyTag`(本文件)= UI badge 显示用,5 个值:openai-compatible /
 *   anthropic / gemini / mistral / xai —— UI 上想让用户看到独立厂商品牌。
 * - `ProviderFamily`(agent/src/llm/provider.ts)= adapter dispatch routing,
 *   只 3 个值:openai-compatible / anthropic / gemini —— adapter 层只关心传输
 *   协议族,mistral / xai 走 pi-ai 内部 streamXxx 但 family 字段统一标 openai-
 *   compatible(实际 grok / mistral 走 OpenAI 兼容协议或自家 SDK,canonical 层
 *   不区分)。
 *
 * 两者**有意 drift**:catalog 比 provider 多 mistral / xai 是因为 UI 上要独立
 * 品牌展示;实际 pi-ai dispatch 全走 OpenAI-compatible / Mistral SDK / Anthropic /
 * Google,跟 catalog.family 不一一对应。caller 想拿 adapter family 用
 * `LLMProvider.family`,想拿 UI 显示 tag 用 `catalog.family`。
 */

export const PROVIDER_CATALOG = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    family: 'openai-compatible',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-4-6',
    family: 'anthropic',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    family: 'gemini',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'GLM-5.1',
    family: 'openai-compatible',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    family: 'openai-compatible',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    family: 'openai-compatible',
  },
  {
    id: 'qwen',
    name: '千问 (Qwen)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    family: 'openai-compatible',
  },
  // Phase 12.5 新增 5 个 provider —— defaultModel 取自 pi-ai 0.74.0 MODELS 表
  // 实测可用 model id(见 plan 27 Task C Step 3 probe 结果)。
  //
  // family 标签:
  // - mistral 走 pi-ai 内部 streamMistral 独立 SDK(Mistral 自家协议),catalog
  //   标 'mistral' 让 UI badge 显示独立品牌。
  // - xai 标 'xai' **仅为 UI badge 显示精准**(实际 pi-ai dispatch 走
  //   openai-completions,跟 groq / openrouter / cerebras 同走 OpenAI 兼容协议;
  //   pi-ai 没有 streamXai)。这是 catalog vs ProviderFamily 有意 drift 的典型
  //   case —— UI 想要独立品牌,adapter 层不区分。
  // - groq / openrouter / cerebras 走 streamOpenAICompletions,归入 openai-
  //   compatible 没有别名。
  {
    id: 'mistral',
    name: 'Mistral',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    family: 'mistral',
  },
  {
    id: 'groq',
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    family: 'openai-compatible',
  },
  {
    id: 'xai',
    name: 'xAI',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4-fast',
    family: 'xai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o',
    family: 'openai-compatible',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'qwen-3-235b-a22b-instruct-2507',
    family: 'openai-compatible',
  },
] as const

export type ProviderCatalogEntry = (typeof PROVIDER_CATALOG)[number]
export type ProviderId = ProviderCatalogEntry['id']
export type ProviderFamilyTag = ProviderCatalogEntry['family']

/** 便捷 lookup:按 id 找 entry,UI / backend 反查默认值用。 */
export function getProviderEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id)
}
