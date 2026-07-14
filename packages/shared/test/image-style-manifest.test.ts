import { describe, expect, it } from 'vitest'
import {
  IMAGE_STYLE_MANIFEST_SCHEMA_VERSION,
  validateImageStyleManifest,
} from '../src/image-style-manifest'

const VALID = {
  schemaVersion: IMAGE_STYLE_MANIFEST_SCHEMA_VERSION,
  id: 'flat-infographic',
  name: '扁平信息图',
  description: '清晰、克制的矢量信息图。',
  category: 'infographic',
  tags: ['矢量', '商务'],
  order: 10,
  stylePrompt: 'Use crisp flat vector shapes and restrained detail.',
  palettePolicy: 'template',
  previewImage: 'preview.webp',
  references: [{ file: 'reference.png', width: 1280, height: 624 }],
} as const

describe('validateImageStyleManifest', () => {
  it('接受完整合法 manifest 并保留类型化值', () => {
    const result = validateImageStyleManifest(VALID)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.id).toBe('flat-infographic')
      expect(result.value.palettePolicy).toBe('template')
    }
  })

  it('拒绝未知 schemaVersion、非法枚举和空 prompt', () => {
    const result = validateImageStyleManifest({
      ...VALID,
      schemaVersion: 2,
      palettePolicy: 'brand',
      stylePrompt: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('schemaVersion'),
          expect.stringContaining('palettePolicy'),
          expect.stringContaining('stylePrompt'),
        ]),
      )
    }
  })

  it('拒绝 traversal、绝对路径、嵌套路径与非图片后缀', () => {
    for (const file of ['../secret.png', '/tmp/a.png', 'nested/a.png', 'prompt.txt']) {
      const result = validateImageStyleManifest({ ...VALID, previewImage: file })
      expect(result.ok, file).toBe(false)
      if (!result.ok) expect(result.errors.join('\n')).toContain('安全文件名')
    }
  })

  it('拒绝非法 id/category、重复 tags 与重复 reference', () => {
    const result = validateImageStyleManifest({
      ...VALID,
      id: 'Bad ID',
      category: '../art',
      tags: ['商务', '商务'],
      references: [VALID.references[0], VALID.references[0]],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const errors = result.errors.join('\n')
      expect(errors).toContain('id 必须')
      expect(errors).toContain('category 必须')
      expect(errors).toContain('tags 不能包含重复项')
      expect(errors).toContain('file 与前面重复')
    }
  })

  it('拒绝越界尺寸、非整数 order、空 references 与未知字段', () => {
    const result = validateImageStyleManifest({
      ...VALID,
      order: 1.5,
      references: [{ file: 'reference.png', width: 0, height: 20_000, typo: true }],
      unexpected: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const errors = result.errors.join('\n')
      expect(errors).toContain('order 必须是非负整数')
      expect(errors).toContain('width 必须是 1-16384 的整数')
      expect(errors).toContain('height 必须是 1-16384 的整数')
      expect(errors).toContain('manifest 含未知字段: unexpected')
      expect(errors).toContain('references[0] 含未知字段: typo')
    }

    expect(validateImageStyleManifest({ ...VALID, references: [] }).ok).toBe(false)
  })

  it('拒绝非对象输入且聚合普通字段错误', () => {
    expect(validateImageStyleManifest(null)).toEqual({
      ok: false,
      errors: ['manifest 根必须是对象'],
    })
    const result = validateImageStyleManifest({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(8)
  })
})
