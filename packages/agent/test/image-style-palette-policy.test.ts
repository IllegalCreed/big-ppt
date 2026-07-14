import { describe, expect, it } from 'vitest'
import {
  buildStructuredImagePrompt,
  STYLE_DECISION_POLL_TIMEOUT_MS,
} from '../src/tools/local/generate-slide-image.js'

const TEMPLATE_STYLE = {
  palette: ['#112233 (brand)'],
  styleHint: 'corporate',
}

describe('Phase 17 image style palette policy', () => {
  it('template policy 明确让品牌色覆盖 reference，且保留纯技法指令给 path-B fallback', () => {
    const prompt = buildStructuredImagePrompt(
      '画项目里程碑',
      TEMPLATE_STYLE,
      true,
      'layered paper-cut illustration',
      'template',
    )
    expect(prompt).toContain('Palette policy: TEMPLATE')
    expect(prompt).toContain('brand palette wins every color conflict')
    expect(prompt).toContain('layered paper-cut illustration')
    expect(prompt).toContain('Template brand palette is mandatory')
  })

  it('reference policy 保留既有 reference palette 优先语义', () => {
    const prompt = buildStructuredImagePrompt(
      '画项目里程碑',
      TEMPLATE_STYLE,
      true,
      'soft watercolor',
      'reference',
    )
    expect(prompt).toContain('Palette policy: REFERENCE')
    expect(prompt).toContain("Reference image's actual palette takes priority")
  })

  it('首次决策等待至少覆盖生产探索 3-5 分钟', () => {
    expect(STYLE_DECISION_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(360_000)
  })
})
