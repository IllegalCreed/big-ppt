/**
 * Phase 12.7 Task C：createAgent 单测（5 测）。
 *
 * 覆盖：
 * 1. sessionId 格式 = `lumideck:user-${id}:deck-${id}`
 * 2. toolExecution = 'parallel' 默认
 * 3. advanced.<provider>.thinkingLevel 优先级
 * 4. 无 advanced 时 thinkingLevel fallback 'off'
 * 5. activeProvider 未配置 apiKey → 抛错（getActiveProviderConfig 返 null）
 *
 * 用 vi.mock 拦截 tool-bridge / history-loader / buildSystemPrompt / pi-ai-adapter
 * 避免真打 DB / pi-ai MODELS 表。Agent 公开字段 sessionId / toolExecution /
 * state.thinkingLevel 直接读取（pi-agent-core/dist/agent.d.ts 上是 public 类字段）。
 */
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
      signal: new AbortController().signal,
    })
    expect(agent.sessionId).toBe('lumideck:user-42:deck-7')
  })

  it('toolExecution 默认 parallel', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
      signal: new AbortController().signal,
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
      signal: new AbortController().signal,
    })
    expect(agent.state.thinkingLevel).toBe('high')
  })

  it('无 advanced 时 thinkingLevel fallback off', async () => {
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
      signal: new AbortController().signal,
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
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/LLM 未配置/)
  })
})
