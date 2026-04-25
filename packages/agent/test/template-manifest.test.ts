import { describe, expect, it } from 'vitest'
import { validateManifest, type TemplateManifest } from '@big-ppt/shared'

function baseManifest(): TemplateManifest {
  return {
    id: 'beitou-standard',
    name: '公司标准模板',
    description: '测试 manifest',
    thumbnail: 'cover.png',
    logos: { primary: 'logo.png' },
    promptPersona: '商务正式',
    starterSlidesPath: 'starter.md',
    layouts: [
      {
        name: 'cover',
        description: '封面',
        frontmatterSchema: {
          type: 'object',
          required: ['mainTitle'],
          properties: {
            mainTitle: { type: 'string', description: '主标题' },
          },
        },
      },
    ],
  }
}

describe('validateManifest', () => {
  it('合法 manifest 返回 ok=true 且原对象可重构', () => {
    const m = baseManifest()
    const res = validateManifest(m)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.id).toBe('beitou-standard')
  })

  it('缺失 id / name 聚合报错', () => {
    const m = baseManifest() as any
    delete m.id
    delete m.name
    const res = validateManifest(m)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors).toContain('id 必填（非空字符串）')
      expect(res.errors).toContain('name 必填')
    }
  })

  it('starterSlidesPath 非 .md 结尾报错', () => {
    const m = baseManifest()
    ;(m as any).starterSlidesPath = 'starter.txt'
    const res = validateManifest(m)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors).toContain('starterSlidesPath 必须以 .md 结尾')
    }
  })

  it('layouts 为空数组报错', () => {
    const m = baseManifest()
    m.layouts = []
    const res = validateManifest(m)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors).toContain('layouts 必须是非空数组')
  })

  it('layout 重名报错', () => {
    const m = baseManifest()
    m.layouts = [m.layouts[0]!, m.layouts[0]!]
    const res = validateManifest(m)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('与前面重复'))).toBe(true)
    }
  })

  it('array 字段缺 items 报错', () => {
    const m = baseManifest()
    m.layouts[0]!.frontmatterSchema.properties.items = {
      type: 'array',
      description: '数组字段',
      // items 缺失
    } as any
    const res = validateManifest(m)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('.items 必须是对象'))).toBe(true)
    }
  })
})
