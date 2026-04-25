/**
 * Phase 7D：rewriteForTemplate 的 skeleton mode 单测。
 *
 * 生产路径调 LLM；BIG_PPT_TEST_REWRITE_MODE=skeleton 时直接返回目标模板的 starter.md，
 * 让 E2E 端到端跑通切换流而无需调外部 LLM。
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import { rewriteForTemplate } from '../src/prompts/rewriteForTemplate.js'
import { readStarter } from '../src/templates/registry.js'

describe('rewriteForTemplate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skeleton mode：env 命中时直接返回目标模板 starter.md，不调 LLM 不查 user', async () => {
    vi.stubEnv('BIG_PPT_TEST_REWRITE_MODE', 'skeleton')

    const got = await rewriteForTemplate({
      oldContent: '# 旧内容（不应出现在结果里）',
      fromTemplateId: 'beitou-standard',
      toTemplateId: 'jingyeda-standard',
      userId: 999999, // 故意填不存在的 userId，证明根本没查 DB
    })

    expect(got).toBe(readStarter('jingyeda-standard'))
    // 反向：返回值不含旧 content 痕迹
    expect(got).not.toContain('旧内容（不应出现在结果里）')
  })

  it('skeleton mode 关闭（默认）→ 走真实 LLM 路径，因 user 不存在 throw', async () => {
    // 不 stub env，确保进入 LLM 路径
    delete process.env.BIG_PPT_TEST_REWRITE_MODE

    await expect(
      rewriteForTemplate({
        oldContent: 'x',
        fromTemplateId: 'beitou-standard',
        toTemplateId: 'jingyeda-standard',
        userId: 999999,
      }),
    ).rejects.toThrow(/未配置 LLM API Key|llm_settings/i)
  })
})
