/**
 * Phase 11.6 dogfood:frontmatter 必填字段校验单测。
 *
 * 关键覆盖:
 * - manifest 已注册的 layout + 必填字段缺失 → 返 missingFields + 友好 message
 * - manifest 已注册的 layout + 必填字段齐 → 返 null
 * - 未知 layout → 返 null(校验不适用,让 slides-store 自己处理)
 * - 未知 templateId(layout 前缀解析不出已注册模板) → 返 null
 * - 空字符串 / null / undefined 都视为缺失;非空字符串 / 数字 / 数组都视为齐
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { validateFrontmatterAgainstManifest } from '../src/templates/validate-frontmatter.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BEITOU_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/beitou-standard/manifest.json',
)

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-validate-fm-'))
  const dir = path.join(tmpRoot, 'packages/slidev/templates/beitou-standard')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(BEITOU_MANIFEST_PATH, path.join(dir, 'manifest.json'))
  fs.writeFileSync(
    path.join(dir, 'starter.md'),
    `---\nlayout: beitou-cover\nmainTitle: 占位\n---\n`,
  )
  process.env.BIG_PPT_TEMPLATES_ROOT = path.join(tmpRoot, 'packages/slidev/templates')
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('validateFrontmatterAgainstManifest', () => {
  it('beitou-image-content 缺 heading → missing=["heading"]', () => {
    const err = validateFrontmatterAgainstManifest('beitou-image-content', {})
    expect(err).not.toBeNull()
    expect(err?.layout).toBe('beitou-image-content')
    expect(err?.missingFields).toEqual(['heading'])
    expect(err?.message).toContain('heading')
    expect(err?.message).toContain('beitou-image-content')
  })

  it('beitou-image-content + heading="X" → 通过(返 null)', () => {
    const err = validateFrontmatterAgainstManifest('beitou-image-content', {
      heading: '第一页',
    })
    expect(err).toBeNull()
  })

  it('beitou-image-content + heading="" 空字符串 → 视为缺失', () => {
    const err = validateFrontmatterAgainstManifest('beitou-image-content', {
      heading: '   ',
    })
    expect(err?.missingFields).toEqual(['heading'])
  })

  it('beitou-cover 缺 mainTitle → missing=["mainTitle"]', () => {
    const err = validateFrontmatterAgainstManifest('beitou-cover', {
      subtitle: '副标题',
    })
    expect(err?.missingFields).toContain('mainTitle')
  })

  it('beitou-section-title 同时缺 chapterNumber + chapterTitle → 两个都报', () => {
    const err = validateFrontmatterAgainstManifest('beitou-section-title', {})
    expect(err?.missingFields).toEqual(
      expect.arrayContaining(['chapterNumber', 'chapterTitle']),
    )
  })

  it('未知 layout(prefix 对但 layout name 不在 manifest)→ 返 null(校验不适用)', () => {
    const err = validateFrontmatterAgainstManifest('beitou-nonexistent-layout', {})
    expect(err).toBeNull()
  })

  it('未知 template prefix → 返 null', () => {
    const err = validateFrontmatterAgainstManifest('does-not-exist', {})
    expect(err).toBeNull()
  })

  it('layout 字符串无 - 分隔(纯短词)→ 返 null', () => {
    const err = validateFrontmatterAgainstManifest('cover', {})
    expect(err).toBeNull()
  })

  it('frontmatter undefined → 与空对象等价', () => {
    const err = validateFrontmatterAgainstManifest('beitou-image-content', undefined)
    expect(err?.missingFields).toEqual(['heading'])
  })
})
