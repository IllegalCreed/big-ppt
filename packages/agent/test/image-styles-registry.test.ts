import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetImageStyleRegistryForTesting,
  getImageStyle,
  listImageStylePresetSummaries,
  listImageStyles,
  readImageStylePreview,
  readImageStyleReference,
  verifyImageStylesOrThrow,
} from '../src/image-styles/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { PNG_1X1, writeImageStyleFixture } from './_fixtures/image-style.js'

let tmpRoot: string
let imageStylesRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumideck-image-styles-'))
  imageStylesRoot = path.join(tmpRoot, 'image-styles')
  fs.mkdirSync(imageStylesRoot, { recursive: true })
  process.env.BIG_PPT_IMAGE_STYLES_ROOT = imageStylesRoot
  __resetPathsForTesting()
  __resetImageStyleRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_IMAGE_STYLES_ROOT
  __resetPathsForTesting()
  __resetImageStyleRegistryForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('image styles registry', () => {
  it('按 order、id 稳定排序并构造无私有字段的公开摘要', () => {
    writeImageStyleFixture(imageStylesRoot, 'zeta-style', {
      manifest: { order: 20, palettePolicy: 'reference' },
    })
    writeImageStyleFixture(imageStylesRoot, 'beta-style', { manifest: { order: 10 } })
    writeImageStyleFixture(imageStylesRoot, 'alpha-style', { manifest: { order: 10 } })

    expect(listImageStyles().map((style) => style.manifest.id)).toEqual([
      'alpha-style',
      'beta-style',
      'zeta-style',
    ])
    expect(getImageStyle('zeta-style')?.manifest.stylePrompt).toContain('private prompt')
    expect(getImageStyle('unknown')).toBeNull()

    const summaries = listImageStylePresetSummaries()
    expect(summaries[2]).toMatchObject({
      id: 'zeta-style',
      palettePolicy: 'reference',
      previewUrl: '/api/image-style-presets/zeta-style/preview',
    })
    expect(summaries[2]).not.toHaveProperty('stylePrompt')
    expect(summaries[2]).not.toHaveProperty('dir')
    expect(summaries[2]).not.toHaveProperty('previewImage')
  })

  it('读取已验证的 preview/reference 字节和真实元数据', () => {
    writeImageStyleFixture(imageStylesRoot, 'flat-style')
    expect(readImageStylePreview('flat-style')).toMatchObject({
      data: PNG_1X1,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    })
    expect(readImageStyleReference('flat-style', 0)).toMatchObject({
      data: PNG_1X1,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    })
    expect(readImageStyleReference('flat-style', 1)).toBeNull()
    expect(readImageStylePreview('unknown')).toBeNull()
  })

  it('拒绝 manifest id 与目录名不一致', () => {
    writeImageStyleFixture(imageStylesRoot, 'folder-id', { manifest: { id: 'other-id' } })
    expect(() => verifyImageStylesOrThrow()).toThrow(/manifest\.id.*与目录名.*不一致/)
  })

  it('拒绝缺失图片、非法 magic 和扩展名伪装', () => {
    writeImageStyleFixture(imageStylesRoot, 'missing-image', { previewBytes: null })
    expect(() => verifyImageStylesOrThrow()).toThrow(/previewImage.*文件不存在/)

    fs.rmSync(path.join(imageStylesRoot, 'missing-image'), { recursive: true })
    __resetImageStyleRegistryForTesting()
    writeImageStyleFixture(imageStylesRoot, 'bad-magic', {
      previewBytes: Buffer.from('not an image'),
    })
    expect(() => verifyImageStylesOrThrow()).toThrow(/不是有效的 PNG\/JPEG\/WebP/)

    fs.rmSync(path.join(imageStylesRoot, 'bad-magic'), { recursive: true })
    __resetImageStyleRegistryForTesting()
    writeImageStyleFixture(imageStylesRoot, 'wrong-extension', {
      manifest: { previewImage: 'preview.jpg' },
      previewBytes: PNG_1X1,
    })
    expect(() => verifyImageStylesOrThrow()).toThrow(/扩展名与 magic bytes 不一致/)
  })

  it('拒绝 reference 真实尺寸与 manifest 不一致', () => {
    writeImageStyleFixture(imageStylesRoot, 'wrong-size', {
      manifest: { references: [{ file: 'reference.png', width: 1280, height: 624 }] },
    })
    expect(() => verifyImageStylesOrThrow()).toThrow(/尺寸不符.*1280×624.*1×1/)
  })

  it('拒绝图片符号链接，即使链接目标位于包内', () => {
    const { dir } = writeImageStyleFixture(imageStylesRoot, 'linked-style')
    fs.renameSync(path.join(dir, 'reference.png'), path.join(dir, 'real.png'))
    fs.symlinkSync(path.join(dir, 'real.png'), path.join(dir, 'reference.png'))
    expect(() => verifyImageStylesOrThrow()).toThrow(/不允许使用符号链接/)
  })

  it('根目录不存在或无合法包时拒绝启动', () => {
    expect(() => verifyImageStylesOrThrow()).toThrow(/未发现任何合法系统风格/)

    fs.rmSync(imageStylesRoot, { recursive: true })
    __resetImageStyleRegistryForTesting()
    expect(() => verifyImageStylesOrThrow()).toThrow(/imageStylesRoot 不存在/)
  })

  it('缓存加载后若图片被替换为不同尺寸/格式则拒绝读取', () => {
    const { dir } = writeImageStyleFixture(imageStylesRoot, 'mutable-style')
    verifyImageStylesOrThrow()
    fs.writeFileSync(path.join(dir, 'preview.png'), Buffer.from('changed'))
    expect(() => readImageStylePreview('mutable-style')).toThrow(/加载后发生变化/)
  })
})
