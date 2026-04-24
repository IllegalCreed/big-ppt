import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listManifests,
  getManifest,
  readStarter,
  verifyTemplatesOrThrow,
  __resetTemplateRegistryForTesting,
} from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'

let tmpRoot: string
let templatesRoot: string

function writeTemplate(
  id: string,
  overrides: {
    manifest?: Record<string, unknown>
    starter?: string | null // null 表示不写 starter.md
  } = {},
) {
  const dir = path.join(templatesRoot, id)
  fs.mkdirSync(dir, { recursive: true })
  const manifest = overrides.manifest ?? {
    id,
    name: `${id} 名称`,
    description: 'fixture',
    thumbnail: 'cover.png',
    logos: { primary: 'logo.png' },
    promptPersona: '测试定位',
    starterSlidesPath: 'starter.md',
    layouts: [
      {
        name: 'cover',
        description: '封面',
        frontmatterSchema: {
          type: 'object',
          required: ['mainTitle'],
          properties: { mainTitle: { type: 'string', description: '主标题' } },
        },
      },
    ],
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  if (overrides.starter !== null) {
    fs.writeFileSync(
      path.join(dir, 'starter.md'),
      overrides.starter ?? '---\nlayout: cover\nmainTitle: X\n---\n',
    )
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-tpl-reg-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  fs.mkdirSync(templatesRoot, { recursive: true })
  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('templates registry', () => {
  it('载入合法模板后 listManifests 返回按 id 排序', () => {
    writeTemplate('company-standard')
    writeTemplate('alpha')
    expect(listManifests().map((m) => m.id)).toEqual(['alpha', 'company-standard'])
  })

  it('getManifest 按 id 返回 manifest，未知 id 返回 null', () => {
    writeTemplate('company-standard')
    expect(getManifest('company-standard')?.id).toBe('company-standard')
    expect(getManifest('does-not-exist')).toBeNull()
  })

  it('readStarter 返回 starter.md 原文', () => {
    writeTemplate('company-standard', {
      starter: '---\nlayout: cover\nmainTitle: T\n---\n',
    })
    expect(readStarter('company-standard')).toBe(
      '---\nlayout: cover\nmainTitle: T\n---\n',
    )
  })

  it('verifyTemplatesOrThrow 在 manifest 损坏时抛错', () => {
    // 写一个 id 与目录不一致的 manifest
    const dir = path.join(templatesRoot, 'company-standard')
    fs.mkdirSync(dir)
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'wrong-id',
        name: 'x',
        description: 'x',
        thumbnail: 'x.png',
        logos: { primary: 'l.png' },
        promptPersona: 'x',
        starterSlidesPath: 'starter.md',
        layouts: [
          {
            name: 'cover',
            description: 'x',
            frontmatterSchema: { type: 'object', properties: {} },
          },
        ],
      }),
    )
    fs.writeFileSync(path.join(dir, 'starter.md'), '# x\n')
    expect(() => verifyTemplatesOrThrow()).toThrowError(/与目录名.*不一致/)
  })

  it('verifyTemplatesOrThrow 在 starter.md 缺失时抛错', () => {
    writeTemplate('company-standard', { starter: null })
    expect(() => verifyTemplatesOrThrow()).toThrowError(
      /starterSlidesPath 不存在/,
    )
  })

  it('verifyTemplatesOrThrow 在根目录无任何合法模板时抛错', () => {
    // 空目录：registry load 完后为空 → 抛错
    expect(() => verifyTemplatesOrThrow()).toThrowError(/未发现任何合法模板/)
  })

  it('verifyTemplatesOrThrow 跳过无 manifest.json 的子目录', () => {
    writeTemplate('company-standard')
    fs.mkdirSync(path.join(templatesRoot, '_deprecated'))
    // 不应抛错
    expect(() => verifyTemplatesOrThrow()).not.toThrow()
    expect(listManifests().map((m) => m.id)).toEqual(['company-standard'])
  })
})
