/**
 * Phase 6C / 7.5D — A/B Contract Test
 *
 * Phase 7.5D 起每模板 layer-1 layout 收敛到 5 个（cover / toc / section-title /
 * content / back-cover），公共组件由 commonComponentsCatalog 段（7.5D-2 引入）
 * 单独提供。本测试保证：
 *   - 5 个 layer-1 layout 段标题都出现 + frontmatter 字段名齐全
 *   - 新增 section-title 字段：chapterNumber / chapterTitle
 *   - content bodyGuidance 含公共组件用法引导（栅格 / 装饰 / 内容块）
 *   - 工作方式 / 工具参数约定 / 输出约束 / promptPersona 等文本保留
 *   - HTTP /api/system-prompt 端点契约不变
 *
 * 7.5D-2 完整化时会追加：4 个栅格 + 2 个装饰 + 6 个内容块 catalog 段断言、
 * 工作模式 5 档自由度断言、决策树关键短语断言。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { buildSystemPrompt } from '../src/prompts/buildSystemPrompt.js'
import { promptsRoute } from '../src/routes/prompts.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/beitou-standard/manifest.json',
)

let tmpRoot: string
let templatesRoot: string
let csDir: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-prompt-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  csDir = path.join(templatesRoot, 'beitou-standard')
  fs.mkdirSync(csDir, { recursive: true })
  // 复用真实 manifest.json，A/B contract 必须以生产 fixture 为准
  fs.copyFileSync(REAL_MANIFEST_PATH, path.join(csDir, 'manifest.json'))
  fs.writeFileSync(
    path.join(csDir, 'starter.md'),
    '---\nlayout: beitou-cover\nmainTitle: 占位\n---\n',
  )
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

describe('buildSystemPrompt（A/B contract）', () => {
  it('5 个 layer-1 layout 段标题全部出现', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('### `beitou-cover`')
    expect(prompt).toContain('### `beitou-toc`')
    expect(prompt).toContain('### `beitou-section-title`')
    expect(prompt).toContain('### `beitou-content`')
    expect(prompt).toContain('### `beitou-back-cover`')
  })

  it('cover layout 字段名齐：mainTitle / subtitle / reporter / date', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toMatch(/`mainTitle`/)
    expect(prompt).toMatch(/`subtitle`/)
    expect(prompt).toMatch(/`reporter`/)
    expect(prompt).toMatch(/`date`/)
  })

  it('toc layout 字段：items + active 可选', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toMatch(/`items` \(string\[\]\)/)
    expect(prompt).toMatch(/`active` \(number, 可选\)/)
  })

  it('section-title 字段：chapterNumber / chapterTitle 必填', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toMatch(/`chapterNumber`/)
    expect(prompt).toMatch(/`chapterTitle`/)
  })

  it('content bodyGuidance 引导使用公共组件（栅格 + 装饰 + 内容块）', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    // 内容页骨架的 bodyGuidance 应至少 mention 几类公共组件名
    expect(prompt).toContain('<TwoCol>')
    expect(prompt).toContain('<NineGrid>')
    expect(prompt).toContain('<PetalFour>')
    expect(prompt).toContain('<MetricCard>')
    expect(prompt).toContain('<BarChart>')
  })

  it('back-cover 字段：message + date 可选', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toMatch(/`message`/)
    const backCoverSection = prompt.split('### `beitou-back-cover`')[1] ?? ''
    expect(backCoverSection).toMatch(/`date`.*可选/)
  })

  it('保留四件套 + edit_slides + 工具参数约定文本', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('update_slide')
    expect(prompt).toContain('create_slide')
    expect(prompt).toContain('delete_slide')
    expect(prompt).toContain('reorder_slides')
    expect(prompt).toContain('edit_slides')
    expect(prompt).toContain('replaceFrontmatter')
  })

  it('保留输出约束 + 中文商务表达 + 字数口径', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('禁用套话')
    expect(prompt).toContain('≤ 150 字')
    expect(prompt).toContain('禁止')
    expect(prompt).toContain('合法 Slidev markdown')
  })

  it('promptPersona 段落出现在 prompt 开头附近', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('商务正式')
  })

  it('mcpBadges 提供时拼到 prompt 末尾，不提供时不拼', () => {
    const without = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(without).not.toContain('扩展工具（MCP）')
    const withBadges = buildSystemPrompt({
      templateId: 'beitou-standard',
      mcpBadges: ['搜索', '读网页'],
    })
    expect(withBadges).toContain('扩展工具（MCP）')
    expect(withBadges).toContain('搜索、读网页')
  })

  it('未知 templateId 抛错', () => {
    expect(() => buildSystemPrompt({ templateId: 'does-not-exist' })).toThrowError(/未知模板/)
  })
})

describe('GET /api/system-prompt', () => {
  function buildApp() {
    const app = new Hono()
    app.route('/api', promptsRoute)
    return app
  }

  it('templateId 缺失 → 400', async () => {
    const res = await buildApp().request('/api/system-prompt')
    expect(res.status).toBe(400)
  })

  it('templateId 不存在 → 404', async () => {
    const res = await buildApp().request('/api/system-prompt?templateId=does-not-exist')
    expect(res.status).toBe(404)
  })

  it('templateId=beitou-standard → 200 + 含 5 个 layer-1 layout', async () => {
    const res = await buildApp().request('/api/system-prompt?templateId=beitou-standard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.templateId).toBe('beitou-standard')
    expect(json.prompt).toContain('### `beitou-cover`')
    expect(json.prompt).toContain('### `beitou-section-title`')
    expect(json.prompt).toContain('### `beitou-back-cover`')
  })

  it('mcpBadges query 拼到 prompt', async () => {
    const res = await buildApp().request(
      '/api/system-prompt?templateId=beitou-standard&mcpBadges=%E6%90%9C%E7%B4%A2,%E8%AF%BB%E7%BD%91%E9%A1%B5',
    )
    const json = await res.json()
    expect(json.prompt).toContain('搜索、读网页')
  })
})
