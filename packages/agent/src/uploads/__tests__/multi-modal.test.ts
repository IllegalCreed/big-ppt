/** Phase 13 Task D: multi-modal LLM 检测 helper 单测。 */
import { describe, expect, it } from 'vitest'
import {
  getSupportedMultiModalHint,
  isMultiModalLLM,
} from '../multi-modal.js'

describe('isMultiModalLLM', () => {
  it('hardcoded set: openai/gpt-5.5 → true', () => {
    expect(isMultiModalLLM('openai', 'gpt-5.5')).toBe(true)
  })

  it('hardcoded set: anthropic/claude-opus-4-7 → true', () => {
    expect(isMultiModalLLM('anthropic', 'claude-opus-4-7')).toBe(true)
  })

  it('hardcoded set: gemini/gemini-2.5-flash → true', () => {
    expect(isMultiModalLLM('gemini', 'gemini-2.5-flash')).toBe(true)
  })

  it('prefix fallback: anthropic/claude-opus-4-7-future-x → true', () => {
    expect(isMultiModalLLM('anthropic', 'claude-opus-4-7-future-x')).toBe(true)
  })

  it('zhipu/glm-5.1 (非 vision 变体) → false', () => {
    // glm-5v-turbo 才是 vision,glm-5.1 是纯文本
    expect(isMultiModalLLM('zhipu', 'glm-5.1')).toBe(false)
  })

  it('null/undefined/空字符串 model → false', () => {
    expect(isMultiModalLLM('openai', null)).toBe(false)
    expect(isMultiModalLLM('openai', undefined)).toBe(false)
    expect(isMultiModalLLM('openai', '')).toBe(false)
  })

  it('unknown provider + 命中 hardcoded set → 仍 true(set 不卡 provider)', () => {
    // hardcoded set 完全凭 modelId 命中,不卡 provider name;只有 prefix fallback 卡
    expect(isMultiModalLLM('unknown', 'gpt-5.5')).toBe(true)
  })

  it('prefix fallback 卡 provider: 用错 provider name 走 gemini- 前缀 → false', () => {
    // 'gemini-3.0' 不在 hardcoded set;前缀 'gemini-' 仅当 provider='gemini' 时启用
    expect(isMultiModalLLM('openai', 'gemini-3.0')).toBe(false)
    expect(isMultiModalLLM('gemini', 'gemini-3.0')).toBe(true)
  })
})

describe('getSupportedMultiModalHint', () => {
  it('返非空 hint 字符串,包含主要 multi-modal provider', () => {
    const hint = getSupportedMultiModalHint()
    expect(hint).toMatch(/Claude/i)
    expect(hint).toMatch(/Gemini/i)
    expect(hint).toMatch(/GPT-4o/i)
  })
})
