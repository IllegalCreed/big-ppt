/**
 * Phase 7D：rewriteForTemplate 的 skeleton mode 单测。
 *
 * 生产路径调 LLM；BIG_PPT_TEST_REWRITE_MODE=skeleton 时直接返回目标模板的 starter.md，
 * 让 E2E 端到端跑通切换流而无需调外部 LLM。
 */
import { describe, expect, it, afterEach, vi } from 'vitest'
import { rewriteForTemplate, validateSlidevMarkdown } from '../src/prompts/rewriteForTemplate.js'
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

describe('validateSlidevMarkdown（LLM 返回值兜底）', () => {
  it('合法 slidev markdown：以 --- 开头 + 含 layout → 通过', () => {
    const md = '---\nlayout: cover\nmainTitle: Hi\n---\n\n# body'
    expect(() => validateSlidevMarkdown(md)).not.toThrow()
  })

  it('LLM 漂移成 tool-call 字面文本 → throw（用户线上踩到的真实场景）', () => {
    const garbage = '<tool_call)>\n<tool_name>read_slides</tool_name>\n</tool_call()>'
    expect(() => validateSlidevMarkdown(garbage)).toThrow(/未以 frontmatter|tool-call/)
  })

  it('LLM 返回纯文本无 frontmatter → throw', () => {
    const plain = '# 标题\n\n这是一段说明文字，没有 frontmatter'
    expect(() => validateSlidevMarkdown(plain)).toThrow(/未以 frontmatter/)
  })

  it('LLM 返回 frontmatter 但缺 layout → throw', () => {
    const noLayout = '---\ntitle: Hi\nauthor: x\n---\n\n# body'
    expect(() => validateSlidevMarkdown(noLayout)).toThrow(/缺 layout/)
  })

  it('content 含 ```tool_call 代码块（另一种 LLM 漂移） → throw', () => {
    const toolBlock = '---\nlayout: cover\n---\n\n```tool_call\nread_slides\n```'
    expect(() => validateSlidevMarkdown(toolBlock)).toThrow(/tool-call/)
  })
})
