/**
 * Local tools 注册 + 行为单测。
 *
 * P0 fix(2026-05-18):slides-store 改 DB-based,工具单测改用 useTestDb + ALS
 * `runInRequest({userId, activeDeckId, ...})` 而非 fs mock。templates 配置仍走 env 临时目录
 * (template registry 和 manifest 文件读还是 fs-based,不在本次安全修复范围)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __resetRegistry, getTool, hasTool, listTools } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { runInRequest, type RequestContext } from '../src/context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

let tmpRoot: string
let currentUserId = 0
let currentDeckId = 0

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: currentUserId,
    sessionId: null,
    activeDeckId: currentDeckId,
    turnId: null,
    ...overrides,
  }
}

function inCtx<T>(fn: () => Promise<T>): Promise<T> {
  return runInRequest(ctx(), fn) as Promise<T>
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-local-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  const templatesRoot = path.join(slidevDir, 'templates')
  const templatesDir = path.join(templatesRoot, 'beitou-standard')
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# unused (slides-store DB-based)\n')
  fs.writeFileSync(path.join(templatesDir, 'cover.md'), '<cover>cover</cover>\n')
  fs.writeFileSync(path.join(templatesDir, 'README.md'), 'USAGE\n')
  fs.writeFileSync(
    path.join(templatesDir, 'manifest.json'),
    JSON.stringify({
      id: 'beitou-standard',
      name: 'std',
      description: 'fixture',
      thumbnail: 'cover.png',
      logos: { primary: 'logo.png' },
      promptPersona: 'biz',
      starterSlidesPath: 'starter.md',
      layouts: [
        {
          name: 'cover',
          description: 'cover',
          frontmatterSchema: {
            type: 'object',
            required: ['mainTitle'],
            properties: { mainTitle: { type: 'string', description: 'm' } },
          },
        },
        {
          name: 'beitou-image-content',
          description: 'img',
          frontmatterSchema: {
            type: 'object',
            required: ['heading'],
            properties: { heading: { type: 'string', description: 'h' } },
          },
        },
      ],
    }),
  )
  fs.writeFileSync(path.join(templatesDir, 'starter.md'), '---\nlayout: cover\nmainTitle: x\n---\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_TEMPLATES_DIR = templatesDir
  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetRegistry()
  registerLocalTools()

  const { user } = await createLoggedInUser('t@a.com', 'pw')
  // 初始 content 用 starter 占位骨架(含 YYYY/MM/DD + 请填写标题 marker),
  // 这样 inner beforeEach 里的 write_slides 通过护栏路径"覆盖 starter"得以执行。
  const STARTER =
    '---\nlayout: cover\nmainTitle: 请填写标题\nsubtitle: 请填写副标题\ndate: YYYY/MM/DD\n---\n'
  const { deck } = await createDeckDirect(user.id, 'D', STARTER)
  currentUserId = user.id
  currentDeckId = deck.id
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_TEMPLATES_DIR
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('registerLocalTools', () => {
  it('register 12 local tools', () => {
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
    expect(hasTool('list_uploaded_files')).toBe(true)
    expect(hasTool('read_uploaded_file')).toBe(true)
    expect(hasTool('list_templates')).toBe(false)
    expect(listTools()).toHaveLength(12)
  })

  it('read_slides returns current deck content (DB)', async () => {
    const tool = getTool('read_slides')!
    const out = await inCtx(() => tool.exec({}) as Promise<string>)
    expect(out).toContain('mainTitle: 请填写标题')
  })

  it('read_slides without ALS deckId returns JSON failure', async () => {
    const tool = getTool('read_slides')!
    const out = await tool.exec({})
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toMatch(/active deck/i)
  })

  it('write_slides empty content returns success=false', async () => {
    const out = await inCtx(() => getTool('write_slides')!.exec({}))
    expect(JSON.parse(out)).toEqual({ success: false, error: 'content 不能为空' })
  })

  it('write_slides allowed on starter content', async () => {
    const { user } = await createLoggedInUser('starter@a.com', 'pw')
    const starter =
      '---\nlayout: cover\nmainTitle: 请填写标题\nsubtitle: 请填写副标题\ndate: YYYY/MM/DD\n---\n\n---\nlayout: content\nheading: 请填写页标题\n---\n'
    const { deck } = await createDeckDirect(user.id, 'starter-deck', starter)
    const out = await runInRequest(
      ctx({ userId: user.id, activeDeckId: deck.id }),
      async () =>
        await getTool('write_slides')!.exec({
          content: '---\nlayout: cover\nmainTitle: real\n---\n',
        }),
    )
    const parsed = JSON.parse(out as string)
    expect(parsed.success).toBe(true)
  })

  it('edit_slides 唯一替换', async () => {
    await inCtx(async () => await getTool('edit_slides')!.exec({ old_string: '请填写标题', new_string: '改后标题' }))
    const out = await inCtx(() => getTool('read_slides')!.exec({}) as Promise<string>)
    expect(out).toContain('改后标题')
    expect(out).not.toContain('请填写标题')
  })

  it('edit_slides old_string > 300 char 拒收', async () => {
    const tool = getTool('edit_slides')!
    const longText = 'x'.repeat(301)
    const raw = await inCtx(() => tool.exec.call(tool, { old_string: longText, new_string: 'short' }))
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
    expect(parsed.error).toMatch(/长度.*300/)
  })

  it('read_template 缺 ctx → 拒收', async () => {
    const tool = getTool('read_template')!
    const raw = await tool.exec.call(tool, { name: 'starter.md' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
  })

  it('read_template 白名单只接 DESIGN.md / starter.md', () => {
    const tool = getTool('read_template')!
    const props = (tool.parameters as { properties: Record<string, { enum?: string[] }> }).properties
    expect(props.name?.enum).toEqual(['DESIGN.md', 'starter.md'])
  })

  describe('Phase 11.6 必填字段校验', () => {
    it('create_slide layout=beitou-image-content 缺 heading → 拒收', async () => {
      const tool = getTool('create_slide')!
      const raw = await inCtx(() =>
        tool.exec.call(tool, { index: 'end', layout: 'beitou-image-content', frontmatter: {} }),
      )
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(false)
      expect(parsed.error).toContain('heading')
    })

    it('create_slide layout=beitou-image-content + heading → 通过', async () => {
      const tool = getTool('create_slide')!
      const raw = await inCtx(() =>
        tool.exec.call(tool, {
          index: 'end',
          layout: 'beitou-image-content',
          frontmatter: { heading: '系统架构' },
        }),
      )
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })

    it('update_slide 不带 layout 字段 → 跳过校验,通过', async () => {
      await inCtx(async () =>
        await getTool('create_slide')!.exec({
          index: 'end',
          layout: 'beitou-image-content',
          frontmatter: { heading: '原标题' },
        }),
      )
      const tool = getTool('update_slide')!
      const raw = await inCtx(() => tool.exec.call(tool, { index: 2, body: '新正文' }))
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })

    it('未知 layout(不带 prefix)→ 校验跳过', async () => {
      const tool = getTool('create_slide')!
      const raw = await inCtx(() =>
        tool.exec.call(tool, { index: 'end', layout: 'cover', frontmatter: { mainTitle: 'X' } }),
      )
      const parsed = JSON.parse(raw)
      expect(parsed.success).toBe(true)
    })
  })

  describe('integer args 宽容 coerce', () => {
    beforeEach(async () => {
      await inCtx(async () =>
        await getTool('write_slides')!.exec({
          content: '---\nlayout: cover\nmainTitle: 请填写标题\nsubtitle: 请填写副标题\ndate: YYYY/MM/DD\n---\n\n# P1\n\n---\nlayout: content\n---\n\n# P2\n',
        }),
      )
    })

    it('create_slide 接受字符串 "end" 和字符串 "2"', async () => {
      const r1 = JSON.parse(
        await inCtx(() => getTool('create_slide')!.exec({ index: 'end', layout: 'content', body: 'new' })),
      )
      expect(r1.success).toBe(true)
      const r2 = JSON.parse(
        await inCtx(() => getTool('create_slide')!.exec({ index: '2', layout: 'content', body: 'middle' })),
      )
      expect(r2.success).toBe(true)
    })

    it('update_slide 接受字符串 index "1"', async () => {
      const r = JSON.parse(
        await inCtx(() => getTool('update_slide')!.exec({ index: '1', body: '# changed' })),
      )
      expect(r.success).toBe(true)
    })

    it('delete_slide 接受字符串 index "2"', async () => {
      const r = JSON.parse(await inCtx(() => getTool('delete_slide')!.exec({ index: '2' })))
      expect(r.success).toBe(true)
    })

    it('reorder_slides 接受字符串元素数组 ["2","1"]', async () => {
      const r = JSON.parse(await inCtx(() => getTool('reorder_slides')!.exec({ order: ['2', '1'] })))
      expect(r.success).toBe(true)
    })

    it('create_slide index 非整数字符串仍拒绝', async () => {
      const r = JSON.parse(
        await inCtx(() => getTool('create_slide')!.exec({ index: 'foo', layout: 'content' })),
      )
      expect(r.success).toBe(false)
    })
  })
})
