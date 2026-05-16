/** Phase 12.7 Task C: createAgent factory 单测。 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../tool-bridge.js', () => ({
  buildToolsForUser: vi.fn(async () => []),
}))

vi.mock('../history-loader.js', () => ({
  loadDeckChatHistory: vi.fn(async () => []),
}))

vi.mock('../../../prompts/buildSystemPrompt.js', () => ({
  buildSystemPromptForDeck: vi.fn(async () => 'You are helpful.'),
}))

vi.mock('../../adapters/pi-ai-adapter.js', () => ({
  // 返回一个最小 Model 对象,Agent 构造不读 model 字段内容
  resolveModelForProvider: vi.fn(() => ({
    id: 'mock-model',
    api: 'openai-completions',
    provider: 'anthropic',
    baseUrl: 'https://example.com',
  })),
}))

import { createAgent } from '../index.js'
import {
  encryptApiKey,
  __setMasterKeyGetterForTesting,
} from '../../../crypto/apikey.js'

function makeSettings(opts: { advanced?: Record<string, unknown>; provider?: string } = {}) {
  const provider = opts.provider ?? 'anthropic'
  const settings = {
    activeProvider: provider,
    providers: { [provider]: { apiKey: 'sk-test' } },
    ...(opts.advanced ? { advanced: opts.advanced } : {}),
  }
  return encryptApiKey(JSON.stringify(settings))
}

describe('createAgent', () => {
  beforeAll(() => {
    __setMasterKeyGetterForTesting(() => Buffer.alloc(32, 'a'))
  })
  afterAll(() => {
    __setMasterKeyGetterForTesting(null)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sessionId 格式 = `lumideck:user-${id}:deck-${id}`', async () => {
    const agent = await createAgent({
      userId: 42,
      deckId: 7,
      encryptedSettings: makeSettings(),
    })
    expect(agent.sessionId).toBe('lumideck:user-42:deck-7')
  })

  it('toolExecution 默认 parallel', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
    })
    expect(agent.toolExecution).toBe('parallel')
  })

  it('advanced.<provider>.thinkingLevel 覆盖 thinkingLevel', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings({
        advanced: { anthropic: { thinkingLevel: 'high' } },
      }),
    })
    expect(agent.state.thinkingLevel).toBe('high')
  })

  it('无 advanced 时 thinkingLevel fallback off', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
    })
    expect(agent.state.thinkingLevel).toBe('off')
  })

  it('Phase 12.7 Task E (review fix):legacy thinkingEnabled boolean → 兼容期 thinkingLevel="medium"', async () => {
    // 模拟 migration 跑前的老 DB shape:advanced.anthropic.thinkingEnabled=true
    // (Phase 12 ↔ Phase 12.7 之间存量数据)。createAgent 走 normalizeThinkingFields
    // 兜底,转出 thinkingLevel='medium',跟 GET / PUT / parseLlmSettings 三处 compat
    // 对齐;不补此路径的话老用户在 migration 跑完前 thinking 能力被误判 'off'。
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings({
        advanced: { anthropic: { thinkingEnabled: true } },
      }),
    })
    expect(agent.state.thinkingLevel).toBe('medium')
  })

  it('Phase 12.7 Task E (review fix):legacy thinkingEnabled=false → thinkingLevel="off"', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings({
        advanced: { anthropic: { thinkingEnabled: false } },
      }),
    })
    expect(agent.state.thinkingLevel).toBe('off')
  })

  it('activeProvider 未配 apiKey → 抛 "LLM 未配置"', async () => {
    const broken = encryptApiKey(
      JSON.stringify({ activeProvider: 'anthropic', providers: {} }),
    )
    await expect(
      createAgent({
        userId: 1,
        deckId: 1,
        encryptedSettings: broken,
      }),
    ).rejects.toThrow(/LLM 未配置/)
  })
})
