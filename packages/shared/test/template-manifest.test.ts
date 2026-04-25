import { describe, expect, it } from 'vitest'
import { validateManifest } from '../src/template-manifest'

const BASE = {
  id: 'demo-standard',
  name: '示例模板',
  description: 'desc',
  promptPersona: 'persona',
  starterSlidesPath: 'starter.md',
  logos: { primary: 'logo.png' },
  layouts: [
    {
      name: 'cover',
      description: 'cover layout',
      frontmatterSchema: { type: 'object', properties: {} },
    },
  ],
} as const

describe('tagline 字段', () => {
  it('tagline 可省略', () => {
    const res = validateManifest({ ...BASE })
    expect(res.ok).toBe(true)
  })

  it('tagline 若存在必须为字符串', () => {
    const res = validateManifest({ ...BASE, tagline: 123 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.some((e) => e.includes('tagline'))).toBe(true)
  })

  it('tagline 为字符串时通过校验并透传', () => {
    const res = validateManifest({ ...BASE, tagline: '商务正式' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.tagline).toBe('商务正式')
  })
})
