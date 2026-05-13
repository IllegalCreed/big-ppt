import { describe, expect, it, vi } from 'vitest'
import { ProviderRegistry, type LLMProvider, type ProviderConfig } from '../provider.js'
import type { LlmSettings } from '../settings.js'
import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'

/**
 * Fake provider helper:
 * - 实现 LLMProvider interface(streamChat / listModels / id / family)。
 * - 留 ctorSpy 让单测能断言 factory 接到的 ProviderConfig。
 */
function makeFakeFactory(family: 'openai-compatible' | 'anthropic' | 'gemini' = 'openai-compatible') {
  const ctorSpy = vi.fn<(cfg: ProviderConfig) => void>()
  const factory = (cfg: ProviderConfig): LLMProvider => {
    ctorSpy(cfg)
    return {
      id: cfg.id,
      family,
      streamChat(_req: CanonicalChatRequest, _signal: AbortSignal): AsyncIterable<CanonicalEvent> {
        return (async function* () {
          yield { type: 'text.delta', text: 'hello from ' + cfg.id }
          yield { type: 'finish', reason: 'stop', usage: { input: 1, output: 1 } }
        })()
      },
    }
  }
  return { factory, ctorSpy }
}

describe('ProviderRegistry', () => {
  it('resolve 正确路径:active provider 已配 apiKey + factory 已注册 → 返回 adapter 实例', () => {
    const { factory, ctorSpy } = makeFakeFactory('openai-compatible')
    const registry = new ProviderRegistry(new Map([['openai', factory]]))
    const settings: LlmSettings = {
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-test', model: 'gpt-5.2', baseUrl: 'https://api.openai.com/v1' } },
      advanced: { common: { temperature: 0.7, maxTokens: 4096 } },
    }
    const provider = registry.resolve(settings)
    expect(provider.id).toBe('openai')
    expect(provider.family).toBe('openai-compatible')
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    const cfg = ctorSpy.mock.calls[0]![0]
    expect(cfg).toEqual({
      id: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-5.2',
      baseUrl: 'https://api.openai.com/v1',
      advanced: { common: { temperature: 0.7, maxTokens: 4096 } },
    })
  })

  it('active provider 未在 providers map 配 apiKey → 抛 "未配置 apiKey"', () => {
    const { factory } = makeFakeFactory()
    const registry = new ProviderRegistry(new Map([['anthropic', factory]]))
    const settings: LlmSettings = {
      activeProvider: 'anthropic',
      providers: {}, // 没有 anthropic 条目
    }
    expect(() => registry.resolve(settings)).toThrow(/active provider "anthropic" 未配置 apiKey/)
  })

  it('active provider 已配但 factory 未注册 → 抛 "adapter 未注册"', () => {
    const registry = new ProviderRegistry(new Map()) // 空 registry
    const settings: LlmSettings = {
      activeProvider: 'gemini',
      providers: { gemini: { apiKey: 'k-gem', model: 'gemini-2.5-flash' } },
    }
    expect(() => registry.resolve(settings)).toThrow(/provider "gemini" adapter 未注册/)
  })

  it('多 provider 注册时只调用 active 那个 factory', () => {
    const fa = makeFakeFactory('openai-compatible')
    const fb = makeFakeFactory('anthropic')
    const fc = makeFakeFactory('gemini')
    const registry = new ProviderRegistry(
      new Map<string, (cfg: ProviderConfig) => LLMProvider>([
        ['openai', fa.factory],
        ['anthropic', fb.factory],
        ['gemini', fc.factory],
      ]),
    )
    const settings: LlmSettings = {
      activeProvider: 'anthropic',
      providers: {
        openai: { apiKey: 'sk-a' },
        anthropic: { apiKey: 'sk-b' },
        gemini: { apiKey: 'sk-c' },
      },
    }
    const provider = registry.resolve(settings)
    expect(provider.family).toBe('anthropic')
    expect(fa.ctorSpy).not.toHaveBeenCalled()
    expect(fb.ctorSpy).toHaveBeenCalledTimes(1)
    expect(fc.ctorSpy).not.toHaveBeenCalled()
  })

  it('每次 resolve 都重新调用 factory(不缓存实例)——便于按调用上下文换 advanced 配置', () => {
    const { factory, ctorSpy } = makeFakeFactory()
    const registry = new ProviderRegistry(new Map([['openai', factory]]))
    const settings: LlmSettings = {
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-test' } },
    }
    registry.resolve(settings)
    registry.resolve(settings)
    registry.resolve(settings)
    expect(ctorSpy).toHaveBeenCalledTimes(3)
  })

  it('factory 接到的 model / baseUrl 可省略(provider 自己有默认)', () => {
    const { factory, ctorSpy } = makeFakeFactory()
    const registry = new ProviderRegistry(new Map([['openai', factory]]))
    const settings: LlmSettings = {
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-minimal' } },
    }
    registry.resolve(settings)
    const cfg = ctorSpy.mock.calls[0]![0]
    expect(cfg.apiKey).toBe('sk-minimal')
    expect(cfg.model).toBeUndefined()
    expect(cfg.baseUrl).toBeUndefined()
    expect(cfg.advanced).toBeUndefined()
  })

  it('streamChat 返 AsyncIterable<CanonicalEvent>,可正常迭代(冒烟)', async () => {
    const { factory } = makeFakeFactory()
    const registry = new ProviderRegistry(new Map([['openai', factory]]))
    const settings: LlmSettings = {
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-test' } },
    }
    const provider = registry.resolve(settings)
    const events: CanonicalEvent[] = []
    const controller = new AbortController()
    for await (const ev of provider.streamChat({ messages: [] }, controller.signal)) {
      events.push(ev)
    }
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'text.delta', text: 'hello from openai' })
    expect(events[1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })
})
