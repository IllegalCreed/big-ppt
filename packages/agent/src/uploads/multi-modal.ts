/** Phase 13 Task D: hardcoded multi-modal LLM model whitelist + check helper. */

const SUPPORTED_MULTI_MODAL_MODELS = new Set<string>([
  // openai
  'gpt-5.5',
  'gpt-5.2',
  'gpt-5v-turbo',
  'gpt-4o',
  // anthropic
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022',
  // google / gemini (canonical id `gemini`)
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  // zhipu — only the vision variant
  'glm-5v-turbo',
  // xai
  'grok-2-vision',
])

/**
 * 宽松前缀匹配,兜底未来 model id 微调(如 claude-opus-4-7-experimental)。
 * 带 provider 限制时,只在 provider 匹配时才走前缀路径,避免误匹配。
 */
const SUPPORTED_PREFIXES: Array<{ provider?: string; prefix: string }> = [
  { provider: 'anthropic', prefix: 'claude-opus-' },
  { provider: 'anthropic', prefix: 'claude-sonnet-' },
  { provider: 'openai', prefix: 'gpt-4o' },
  { provider: 'openai', prefix: 'gpt-5' },
  { provider: 'gemini', prefix: 'gemini-' },
]

export function isMultiModalLLM(provider: string, modelId: string | undefined | null): boolean {
  if (!modelId) return false
  if (SUPPORTED_MULTI_MODAL_MODELS.has(modelId)) return true
  for (const p of SUPPORTED_PREFIXES) {
    if (p.provider && p.provider !== provider) continue
    if (modelId.startsWith(p.prefix)) return true
  }
  return false
}

export function getSupportedMultiModalHint(): string {
  return 'Claude / Gemini / GPT-4o+ / GLM-5v-turbo / Grok-2-vision'
}
