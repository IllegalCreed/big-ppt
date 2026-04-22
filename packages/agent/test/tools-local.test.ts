import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __resetRegistry, getTool, hasTool, listTools } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-local-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  const templatesDir = path.join(slidevDir, 'templates/company-standard')
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# hello\n')
  fs.writeFileSync(path.join(templatesDir, 'cover.md'), '<cover>封面</cover>\n')
  fs.writeFileSync(path.join(templatesDir, 'README.md'), 'USAGE\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_TEMPLATES_DIR = templatesDir
  __resetPathsForTesting()
  __resetRegistry()
  registerLocalTools()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_TEMPLATES_DIR
  __resetPathsForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('registerLocalTools', () => {
  it('注册 5 个本地工具', () => {
    expect(hasTool('read_slides')).toBe(true)
    expect(hasTool('write_slides')).toBe(true)
    expect(hasTool('edit_slides')).toBe(true)
    expect(hasTool('list_templates')).toBe(true)
    expect(hasTool('read_template')).toBe(true)
    expect(listTools()).toHaveLength(5)
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

  it('list_templates 返回 cover.md 与 usage_guide', async () => {
    const raw = await getTool('list_templates')!.exec({})
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(true)
    expect(parsed.templates).toEqual([{ name: 'cover.md', path: 'company-standard/cover.md' }])
    expect(parsed.usage_guide).toBe('USAGE\n')
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
})
