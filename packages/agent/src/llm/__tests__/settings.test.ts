/**
 * Phase 12 Task F:settings.ts(zod schema + migrateLegacySettings + getActiveProviderConfig)单测。
 *
 * 覆盖:
 * - parseLlmSettings happy / 各种 zod 失败路径(缺 activeProvider / providers 不是对象 / apiKey 空 / baseUrl 非 URL / temperature 越界)
 * - migrateLegacySettings happy / baseUrl model 缺省 / 非白名单 provider(转完 parse 抛错)
 * - getActiveProviderConfig:新 / 老 shape / 损坏 cipher / 缺关键字段 各 case
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  LlmSettingsSchema,
  getActiveProviderConfig,
  migrateLegacySettings,
  parseLlmSettings,
  type LlmSettings,
} from '../settings.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../../crypto/apikey.js'

const FIXED_KEY = Buffer.alloc(32, 0xef)
beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

describe('parseLlmSettings(zod schema)', () => {
  it('happy:完整新 shape 通过', () => {
    const raw: LlmSettings = {
      activeProvider: 'openai',
      providers: {
        openai: { apiKey: 'sk-test', model: 'gpt-5.2', baseUrl: 'https://api.openai.com/v1' },
        anthropic: { apiKey: 'sk-anthropic' },
      },
      advanced: {
        anthropic: { promptCaching: true, thinkingEnabled: true, thinkingBudgetTokens: 4096 },
        gemini: { jsonMode: true, longContextStrategy: 'segment' },
        common: { temperature: 0.7, maxTokens: 8192, topP: 0.9, stopSequences: ['\n\n'] },
      },
    }
    expect(parseLlmSettings(raw)).toEqual(raw)
  })

  it('minimal:只有 activeProvider + 该 provider 的 apiKey', () => {
    const raw = { activeProvider: 'zhipu', providers: { zhipu: { apiKey: 'k' } } }
    const parsed = parseLlmSettings(raw)
    expect(parsed.activeProvider).toBe('zhipu')
    expect(parsed.providers.zhipu).toEqual({ apiKey: 'k' })
  })

  it('null / 非 object 输入 → 抛 zod 错', () => {
    expect(() => parseLlmSettings(null)).toThrow()
    expect(() => parseLlmSettings('string')).toThrow()
    expect(() => parseLlmSettings(123)).toThrow()
  })

  it('缺 activeProvider → 抛 zod 错(message 提到 activeProvider 字段)', () => {
    expect(() => parseLlmSettings({ providers: {} })).toThrow(/activeProvider/)
  })

  it('activeProvider 不在白名单 → 抛 zod 错', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'unknown-provider',
        providers: {},
      }),
    ).toThrow()
  })

  it('缺 providers 字段 → 抛 zod 错', () => {
    expect(() => parseLlmSettings({ activeProvider: 'openai' })).toThrow()
  })

  it('providers 是数组而非对象 → 抛 zod 错', () => {
    expect(() => parseLlmSettings({ activeProvider: 'openai', providers: [] })).toThrow()
  })

  it('apiKey 空串 → 抛 zod 错(z.string().min(1) 拒)', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'openai',
        providers: { openai: { apiKey: '' } },
      }),
    ).toThrow()
  })

  it('baseUrl 非合法 URL → 抛 zod 错', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'openai',
        providers: { openai: { apiKey: 'k', baseUrl: 'not-a-url' } },
      }),
    ).toThrow()
  })

  it('advanced.common.temperature 越界(> 2) → 抛 zod 错', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'openai',
        providers: { openai: { apiKey: 'k' } },
        advanced: { common: { temperature: 3.5 } },
      }),
    ).toThrow()
  })

  it('advanced.common.topP 越界(> 1) → 抛 zod 错', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'openai',
        providers: { openai: { apiKey: 'k' } },
        advanced: { common: { topP: 1.5 } },
      }),
    ).toThrow()
  })

  it('advanced.anthropic.thinkingBudgetTokens 必须正整数', () => {
    expect(() =>
      parseLlmSettings({
        activeProvider: 'anthropic',
        providers: { anthropic: { apiKey: 'k' } },
        advanced: { anthropic: { thinkingBudgetTokens: -1 } },
      }),
    ).toThrow()
    expect(() =>
      parseLlmSettings({
        activeProvider: 'anthropic',
        providers: { anthropic: { apiKey: 'k' } },
        advanced: { anthropic: { thinkingBudgetTokens: 4.5 } },
      }),
    ).toThrow()
  })

  it('Schema export 可独立用于其他 caller 自己调 safeParse', () => {
    const result = LlmSettingsSchema.safeParse({ activeProvider: 'openai', providers: {} })
    expect(result.success).toBe(true)
  })
})

describe('migrateLegacySettings', () => {
  it('happy:转换后通过 parseLlmSettings(白名单 provider 全字段都在)', () => {
    const next = migrateLegacySettings({
      provider: 'zhipu',
      apiKey: 'sk-x',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'GLM-5.1',
    })
    expect(next).toEqual({
      activeProvider: 'zhipu',
      providers: {
        zhipu: {
          apiKey: 'sk-x',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'GLM-5.1',
        },
      },
    })
    // 验证转完确实能 parse 过
    expect(parseLlmSettings(next)).toEqual(next)
  })

  it('baseUrl / model 缺省时不写入空字段', () => {
    const next = migrateLegacySettings({ provider: 'openai', apiKey: 'sk-a' })
    expect(next).toEqual({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-a' } },
    })
    expect(parseLlmSettings(next)).toEqual(next)
  })

  it('非白名单 provider:转换照样跑(本函数宽松),但 parseLlmSettings 会抛', () => {
    const next = migrateLegacySettings({ provider: 'unknown', apiKey: 'k' })
    expect(next.activeProvider).toBe('unknown')
    expect(next.providers).toHaveProperty('unknown')
    expect(() => parseLlmSettings(next)).toThrow()
  })

  it('支持所有 7 个白名单 provider', () => {
    const ids = ['openai', 'anthropic', 'gemini', 'zhipu', 'deepseek', 'moonshot', 'qwen'] as const
    for (const id of ids) {
      const next = migrateLegacySettings({ provider: id, apiKey: 'k-' + id })
      expect(parseLlmSettings(next).activeProvider).toBe(id)
    }
  })

  it('baseUrl 非 URL 时函数仍返回(校验下游决定)', () => {
    const next = migrateLegacySettings({ provider: 'openai', apiKey: 'k', baseUrl: 'not-url' })
    expect(next.providers.openai?.baseUrl).toBe('not-url')
    expect(() => parseLlmSettings(next)).toThrow()
  })
})

describe('getActiveProviderConfig(shape-agnostic 读取)', () => {
  it('新 shape 输入 → 返回 active provider 的 cfg(apiKey/model/baseUrl/provider)', () => {
    const plaintext = JSON.stringify({
      activeProvider: 'zhipu',
      providers: {
        zhipu: { apiKey: 'sk-zhi', model: 'GLM-5.1', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
        openai: { apiKey: 'sk-other' }, // 不应该被返回
      },
    })
    const encrypted = encryptApiKey(plaintext)
    expect(getActiveProviderConfig(encrypted)).toEqual({
      apiKey: 'sk-zhi',
      model: 'GLM-5.1',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      provider: 'zhipu',
    })
  })

  it('新 shape minimal(无 baseUrl/model)→ 返回 cfg 但相应字段为 undefined', () => {
    const plaintext = JSON.stringify({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-m' } },
    })
    const cfg = getActiveProviderConfig(encryptApiKey(plaintext))
    expect(cfg).toEqual({ apiKey: 'sk-m', provider: 'openai', baseUrl: undefined, model: undefined })
  })

  it('老 shape 输入 → 返回老字段 + provider 字段透传(非白名单也允许)', () => {
    const plaintext = JSON.stringify({
      provider: 'zhipu',
      apiKey: 'sk-legacy',
      baseUrl: 'https://api.legacy.com',
      model: 'GLM-X',
    })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toEqual({
      apiKey: 'sk-legacy',
      provider: 'zhipu',
      baseUrl: 'https://api.legacy.com',
      model: 'GLM-X',
    })
  })

  it("老 shape provider='custom'(非白名单) → 仍返回(只是 provider 是非标准 id),caller 决定怎么用", () => {
    const plaintext = JSON.stringify({ provider: 'custom', apiKey: 'sk-c' })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toMatchObject({
      provider: 'custom',
      apiKey: 'sk-c',
    })
  })

  it('坏密文(decrypt 抛错)→ null', () => {
    expect(getActiveProviderConfig('not-a-v1-cipher-blob')).toBe(null)
    expect(getActiveProviderConfig('v1:not-base64:not-base64:not-base64')).toBe(null)
  })

  it('合法密文但内容非 JSON → null', () => {
    const encrypted = encryptApiKey('not-json{')
    expect(getActiveProviderConfig(encrypted)).toBe(null)
  })

  it('JSON 但不是 object → null', () => {
    expect(getActiveProviderConfig(encryptApiKey('null'))).toBe(null)
    expect(getActiveProviderConfig(encryptApiKey('"a-string"'))).toBe(null)
    expect(getActiveProviderConfig(encryptApiKey('123'))).toBe(null)
  })

  it('新 shape 但 activeProvider 不在白名单 → null(zod safeParse 失败)', () => {
    const plaintext = JSON.stringify({
      activeProvider: 'cohere',
      providers: { cohere: { apiKey: 'sk-c' } },
    })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toBe(null)
  })

  it('新 shape 但 active 对应的 provider 条目不存在 → null', () => {
    const plaintext = JSON.stringify({
      activeProvider: 'anthropic',
      providers: { openai: { apiKey: 'sk-not-active' } },
    })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toBe(null)
  })

  it('老 shape 但 apiKey 是空串 → null(可信"已配置"语义不应漏 false-positive)', () => {
    const plaintext = JSON.stringify({ provider: 'openai', apiKey: '' })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toBe(null)
  })

  it('老 shape 但 apiKey trim 后为空 → null', () => {
    const plaintext = JSON.stringify({ provider: 'openai', apiKey: '   ' })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toBe(null)
  })

  it('既没有 activeProvider 也没有 apiKey/provider → null', () => {
    const plaintext = JSON.stringify({ foo: 'bar' })
    expect(getActiveProviderConfig(encryptApiKey(plaintext))).toBe(null)
  })
})
