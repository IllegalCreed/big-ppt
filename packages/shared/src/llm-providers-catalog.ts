/**
 * Phase 12 Task J:LLM provider 静态元信息目录。
 *
 * 跨 agent + creator 复用的 7 个 provider 配置常量:每条含 id / 显示名 /
 * 默认 baseUrl(若适用)/ 默认 model / 协议族。Settings UI 用它渲染 7 张 provider
 * 卡片;后端 ProviderRegistry 也可在未来需要 default model fallback 时复用同一份。
 *
 * **唯一事实来源**:模板元数据归 `packages/slidev/templates/<id>/`,provider 元
 * 数据归本文件;不允许在 agent / creator 内重写硬编表(详见 CLAUDE.md 「模板
 * 元数据归属」节同款约束)。
 *
 * `as const` 保留 literal:`PROVIDER_CATALOG[0].family` 推导成
 * `'openai-compatible'` 而非 `string`,跟 `ProviderFamily` union 对齐免强转。
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
] as const

export type ProviderCatalogEntry = (typeof PROVIDER_CATALOG)[number]
export type ProviderId = ProviderCatalogEntry['id']
export type ProviderFamilyTag = ProviderCatalogEntry['family']

/** 便捷 lookup:按 id 找 entry,UI / backend 反查默认值用。 */
export function getProviderEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id)
}
