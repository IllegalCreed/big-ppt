/**
 * Phase 11.5：生图模型独立配置（与主 Chat LLM 完全解耦）。
 *
 * 当前 v1 仅支持 OpenAI provider；未来可扩展 Midjourney / Flux / Stable Diffusion 等。
 * 与 LLMSettings 故意分开放，避免后端推断 key 类型不可靠。
 */
export interface ImageLlmSettings {
  /** v1 仅 'openai'；预留为联合 enum，未来加 provider 时扩展 */
  provider: 'openai'
  apiKey: string
  /** 自定义中转 baseUrl；空时默认 https://api.openai.com/v1 */
  baseUrl?: string
  /**
   * 显式选定的模型名。
   * - 'gpt-5.5' / 'gpt-5' 等含 'gpt-5' 前缀 → 走路 A（Responses API + image_generation tool）
   * - 'gpt-image-2' / 'gpt-image-1.5' → 直走路 B（/v1/images/generations）
   * - 留空 → 默认 'gpt-5.5' 主 + 'gpt-image-2' fallback
   */
  model?: string
}
