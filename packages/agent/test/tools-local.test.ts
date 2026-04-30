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
  const templatesDir = path.join(templatesRoot, 'beitou-standard')
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# hello\n')
  fs.writeFileSync(path.join(templatesDir, 'cover.md'), '<cover>封面</cover>\n')
  fs.writeFileSync(path.join(templatesDir, 'README.md'), 'USAGE\n')
  fs.writeFileSync(
    path.join(templatesDir, 'manifest.json'),
    JSON.stringify({
      id: 'beitou-standard',
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
        // Phase 11.6 dogfood:加 prefixed layout 让 validate-frontmatter 能 derive templateId
        {
          name: 'beitou-image-content',
          description: '图片内容页',
          frontmatterSchema: {
            type: 'object',
            required: ['heading'],
            properties: {
              heading: { type: 'string', description: '页标题' },
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
  it('注册 10 个本地工具（含四件套 + switch_template + generate_slide_image,Phase 11.6 删 list_templates）', () => {
    expect(hasTool('read_slides')).toBe(true)
    expect(hasTool('write_slides')).toBe(true)
    expect(hasTool('edit_slides')).toBe(true)
    expect(hasTool('create_slide')).toBe(true)
    expect(hasTool('update_slide')).toBe(true)
    expect(hasTool('delete_slide')).toBe(true)
    expect(hasTool('reorder_slides')).toBe(true)
    expect(hasTool('read_template')).toBe(true)
    expect(hasTool('switch_template')).toBe(true)
    expect(hasTool('generate_slide_image')).toBe(true)
    // Phase 11.6 dogfood 后删除:list_templates 跨模板返回触发污染
    expect(hasTool('list_templates')).toBe(false)
    expect(listTools()).toHaveLength(10)
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

  it('write_slides 拒绝覆盖真用户内容(无 starter 占位)', async () => {
    // 写入真用户内容(无占位 marker)
    await getTool('write_slides')!.exec({
      content: '---\nlayout: cover\nmainTitle: 我的真实标题\n---\n',
    })
    // 再次 write_slides 应被拒(已有真内容)
    const out = await getTool('write_slides')!.exec({ content: '---\nlayout: cover\nmainTitle: X\n---\n' })
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toContain('write_slides')
  })

  it('write_slides 放行覆盖默认 starter 占位骨架(首次生成场景)', async () => {
    // 模拟新建 deck 时的 starter 占位内容(含 mainTitle/subtitle/YYYY/MM/DD 占位)
    const starter = `---
layout: cover
mainTitle: 请填写标题
subtitle: 请填写副标题
date: YYYY/MM/DD
---

---
layout: content
heading: 请填写页标题
---
`
    // 直接写入 starter(绕过 write_slides 第一次自身的拒收检查 — 因为初始 slides.md 为空)
    await getTool('write_slides')!.exec({ content: starter })
    // 再次 write_slides 应被放行(starter 占位骨架)
    const out = await getTool('write_slides')!.exec({
      content: '---\nlayout: cover\nmainTitle: 真实首次生成\n---\n',
    })
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(true)
    const after = await getTool('read_slides')!.exec({})
    expect(after).toContain('真实首次生成')
    expect(after).not.toContain('请填写标题')
  })

  it('edit_slides 定位唯一字符串并替换', async () => {
    await getTool('write_slides')!.exec({ content: '# hello\nworld\n' })
    await getTool('edit_slides')!.exec({ old_string: 'world', new_string: 'vitest' })
    const out = await getTool('read_slides')!.exec({})
    expect(out).toBe('# hello\nvitest\n')
  })

  it('Phase 11.6 dogfood 后:edit_slides old_string > 300 char → 拒收(防 LLM 误用改大段)', async () => {
    await getTool('write_slides')!.exec({ content: '# hello\nworld\n' })
    const tool = getTool('edit_slides')!
    const longText = 'x'.repeat(301)
    const raw = await tool.exec.call(tool, { old_string: longText, new_string: 'short' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toMatch(/长度.*300/)
    expect(parsed.error).toMatch(/update_slide/)
  })

  it('Phase 11.6 dogfood 后:edit_slides 边界 = 300 char 通过(若文件中匹配)', async () => {
    const longText = 'x'.repeat(300)
    await getTool('write_slides')!.exec({ content: `prefix ${longText} suffix\n` })
    const tool = getTool('edit_slides')!
    const raw = await tool.exec.call(tool, { old_string: longText, new_string: 'OK' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(true)
  })

  // Phase 11.6 dogfood 后:read_template 改 ctx-aware,unit test 没 deck context 时
  // 报「无 active deck」(防跨模板)。完整 ctx-aware 行为测试见集成测试。
  it('read_template 缺 ctx → 拒收(防跨模板)', async () => {
    const tool = getTool('read_template')!
    const raw = await tool.exec.call(tool, { name: 'starter.md' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
  })

  it('Phase 11.6 dogfood 后:read_template 白名单只接受 DESIGN.md / starter.md', () => {
    const tool = getTool('read_template')!
    const props = (tool.parameters as { properties: Record<string, { enum?: string[] }> })
      .properties
    expect(props.name?.enum).toEqual(['DESIGN.md', 'starter.md'])
  })

  describe('Phase 11.6 dogfood 后:create_slide / update_slide 必填字段校验', () => {
    it('create_slide layout=beitou-image-content 缺 heading → 拒收 + 引导', async () => {
      const tool = getTool('create_slide')!
      const raw = await tool.exec.call(tool, {
        index: 'end',
        layout: 'beitou-image-content',
        frontmatter: {},
      })
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('heading')
      expect(parsed.error).toContain('beitou-image-content')
    })

    it('create_slide layout=beitou-image-content + heading="X" → 通过', async () => {
      const tool = getTool('create_slide')!
      const raw = await tool.exec.call(tool, {
        index: 'end',
        layout: 'beitou-image-content',
        frontmatter: { heading: '系统架构' },
      })
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })

    it('update_slide 显式换 layout=beitou-image-content 缺 heading → 拒收', async () => {
      // 先 create 一页
      await getTool('create_slide')!.exec({
        index: 'end',
        layout: 'beitou-image-content',
        frontmatter: { heading: '原标题' },
      })
      const tool = getTool('update_slide')!
      // 显式传 layout=beitou-image-content 但不带 heading
      const raw = await tool.exec.call(tool, {
        index: 1,
        frontmatter: { layout: 'beitou-image-content' },
      })
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('heading')
    })

    it('update_slide 不带 layout 字段(部分合并)→ 跳过校验,通过', async () => {
      // 先 create 一页
      await getTool('create_slide')!.exec({
        index: 'end',
        layout: 'beitou-image-content',
        frontmatter: { heading: '原标题' },
      })
      const tool = getTool('update_slide')!
      // 仅改 body,frontmatter 不带 layout
      const raw = await tool.exec.call(tool, { index: 1, body: '新正文' })
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })

    it('未知 layout(不带 prefix 或不在 manifest)→ 校验跳过,行为同改前', async () => {
      // 'cover' 不带 prefix,validate 推导 'cover-standard' 找不到 manifest → 跳过
      const tool = getTool('create_slide')!
      const raw = await tool.exec.call(tool, {
        index: 'end',
        layout: 'cover',
        frontmatter: { mainTitle: 'X' },
      })
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })
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
