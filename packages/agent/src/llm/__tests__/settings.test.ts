/**
 * Phase 12 Task F:settings.ts(zod schema + migrateLegacySettings)单测。
 *
 * 覆盖:
 * - parseLlmSettings happy / 各种 zod 失败路径(缺 activeProvider / providers 不是对象 / apiKey 空 / baseUrl 非 URL / temperature 越界)
 * - migrateLegacySettings happy / baseUrl model 缺省 / 非白名单 provider(转完 parse 抛错)
 */
import { describe, expect, it } from 'vitest'
import {
  LlmSettingsSchema,
  migrateLegacySettings,
  parseLlmSettings,
  type LlmSettings,
} from '../settings.js'

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
