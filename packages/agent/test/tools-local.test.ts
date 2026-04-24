import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __resetRegistry, getTool, hasTool, listTools } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-local-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  const templatesRoot = path.join(slidevDir, 'templates')
  const templatesDir = path.join(templatesRoot, 'company-standard')
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# hello\n')
  fs.writeFileSync(path.join(templatesDir, 'cover.md'), '<cover>封面</cover>\n')
  fs.writeFileSync(path.join(templatesDir, 'README.md'), 'USAGE\n')
  fs.writeFileSync(
    path.join(templatesDir, 'manifest.json'),
    JSON.stringify({
      id: 'company-standard',
      name: '公司标准模板',
      description: 'fixture',
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
    }),
  )
  fs.writeFileSync(
    path.join(templatesDir, 'starter.md'),
    '---\nlayout: cover\nmainTitle: 请填写标题\n---\n',
  )
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_TEMPLATES_DIR = templatesDir
  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  process.env.BIG_PPT_HISTORY_DIR = path.join(tmpRoot, 'slides-history')
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetRegistry()
  registerLocalTools()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_TEMPLATES_DIR
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  delete process.env.BIG_PPT_HISTORY_DIR
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('registerLocalTools', () => {
  it('注册 9 个本地工具（含四件套）', () => {
    expect(hasTool('read_slides')).toBe(true)
    expect(hasTool('write_slides')).toBe(true)
    expect(hasTool('edit_slides')).toBe(true)
    expect(hasTool('create_slide')).toBe(true)
    expect(hasTool('update_slide')).toBe(true)
    expect(hasTool('delete_slide')).toBe(true)
    expect(hasTool('reorder_slides')).toBe(true)
    expect(hasTool('list_templates')).toBe(true)
    expect(hasTool('read_template')).toBe(true)
    expect(listTools()).toHaveLength(9)
  })

  it('read_slides 返回 slides.md 原文', async () => {
    const tool = getTool('read_slides')!
    const out = await tool.exec({})
    expect(out).toBe('# hello\n')
  })

  it('write_slides 空内容返回 success=false', async () => {
    const out = await getTool('write_slides')!.exec({})
    expect(JSON.parse(out)).toEqual({ success: false, error: 'content 不能为空' })
  })

  it('write_slides 写成功后 read_slides 反映新内容', async () => {
    await getTool('write_slides')!.exec({ content: '# new\n' })
    const out = await getTool('read_slides')!.exec({})
    expect(out).toBe('# new\n')
  })

  it('edit_slides 定位唯一字符串并替换', async () => {
    await getTool('write_slides')!.exec({ content: '# hello\nworld\n' })
    await getTool('edit_slides')!.exec({ old_string: 'world', new_string: 'vitest' })
    const out = await getTool('read_slides')!.exec({})
    expect(out).toBe('# hello\nvitest\n')
  })

  it('list_templates 返回 cover.md 与 usage_guide 与 manifests', async () => {
    const raw = await getTool('list_templates')!.exec({})
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(true)
    expect(parsed.templates).toEqual([{ name: 'cover.md', path: 'company-standard/cover.md' }])
    expect(parsed.usage_guide).toBe('USAGE\n')
    expect(parsed.manifests).toHaveLength(1)
    expect(parsed.manifests[0].id).toBe('company-standard')
    expect(parsed.manifests[0].layouts[0].name).toBe('cover')
  })

  it('read_template 读 cover.md 正文', async () => {
    const raw = await getTool('read_template')!.exec({ name: 'cover.md' })
    expect(JSON.parse(raw)).toEqual({ success: true, content: '<cover>封面</cover>\n' })
  })

  it('read_template 拒绝非 md 后缀', async () => {
    const raw = await getTool('read_template')!.exec({ name: '../../../etc/passwd' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
  })

  // LLM（尤其 GLM）常把 integer 参数包成字符串 —— 工具层要宽容
  describe('integer args 宽容 coerce', () => {
    beforeEach(async () => {
      await getTool('write_slides')!.exec({
        content: '---\nlayout: cover\n---\n\n# P1\n\n---\nlayout: content\n---\n\n# P2\n',
      })
    })

    it('create_slide 接受字符串 "end" 和字符串 "4"', async () => {
      const r1 = JSON.parse(
        await getTool('create_slide')!.exec({ index: 'end', layout: 'content', body: 'new' }),
      )
      expect(r1.success).toBe(true)
      expect(r1.index).toBe(3)
      const r2 = JSON.parse(
        await getTool('create_slide')!.exec({ index: '2', layout: 'content', body: 'middle' }),
      )
      expect(r2.success).toBe(true)
      expect(r2.index).toBe(2)
    })

    it('update_slide 接受字符串 index "1"', async () => {
      const r = JSON.parse(
        await getTool('update_slide')!.exec({ index: '1', body: '# changed' }),
      )
      expect(r.success).toBe(true)
    })

    it('delete_slide 接受字符串 index "2"', async () => {
      const r = JSON.parse(await getTool('delete_slide')!.exec({ index: '2' }))
      expect(r.success).toBe(true)
    })

    it('reorder_slides 接受字符串元素数组 ["2","1"]', async () => {
      const r = JSON.parse(await getTool('reorder_slides')!.exec({ order: ['2', '1'] }))
      expect(r.success).toBe(true)
    })

    it('create_slide index 非整数字符串仍拒绝', async () => {
      const r = JSON.parse(
        await getTool('create_slide')!.exec({ index: 'foo', layout: 'content' }),
      )
      expect(r.success).toBe(false)
    })
  })
})
