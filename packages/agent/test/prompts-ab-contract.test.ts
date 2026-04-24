/**
 * Phase 6C — A/B Contract Test
 *
 * 断言 manifest 驱动的 prompt 拼装结果跟 Phase 6B 之前的硬编码版本结构等价：
 *   - 7 个 layout 段都出现且字段名齐
 *   - frontmatter 字段名 / required 信息保留
 *   - bodyGuidance 关键短语保留（::left:: / metrics inline JSON / chart 提示）
 *   - 工作方式 / 架构约束 / 输出约束等文本不丢
 *
 * baseline 指令（≥10 条用户视角的典型指令）虽然不直接喂给 LLM 跑，但每条指令背后
 * 依赖的 layout 字段在 manifest → prompt 映射里必须**仍然出现**，否则就是回归。
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
  '../../slidev/templates/company-standard/manifest.json',
)

let tmpRoot: string
let templatesRoot: string
let csDir: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-prompt-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  csDir = path.join(templatesRoot, 'company-standard')
  fs.mkdirSync(csDir, { recursive: true })
  // 复用真实 manifest.json，A/B contract 必须以生产 fixture 为准
  fs.copyFileSync(REAL_MANIFEST_PATH, path.join(csDir, 'manifest.json'))
  fs.writeFileSync(
    path.join(csDir, 'starter.md'),
    '---\nlayout: cover\nmainTitle: 占位\n---\n',
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
  it('七个 layout 段标题全部出现', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toContain('### `cover`')
    expect(prompt).toContain('### `toc`')
    expect(prompt).toContain('### `content`')
    expect(prompt).toContain('### `two-col`')
    expect(prompt).toContain('### `data`')
    expect(prompt).toContain('### `image-content`')
    expect(prompt).toContain('### `back-cover`')
  })

  it('cover layout 字段名齐：mainTitle / subtitle / reporter / date', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toMatch(/`mainTitle`/)
    expect(prompt).toMatch(/`subtitle`/)
    expect(prompt).toMatch(/`reporter`/)
    expect(prompt).toMatch(/`date`/)
  })

  it('toc layout 字段：items + active 可选', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toMatch(/`items` \(string\[\]\)/)
    expect(prompt).toMatch(/`active` \(number, 可选\)/)
  })

  it('two-col bodyGuidance 含 ::left:: / ::right:: 提示', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toContain('::left::')
    expect(prompt).toContain('::right::')
  })

  it('data bodyGuidance 含 BarChart 组件示例 + metrics inline JSON 写法', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toContain('BarChart')
    expect(prompt).toMatch(/metrics: \[/)
  })

  it('image-content 字段：heading / image / textTitle', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toMatch(/`image`/)
    expect(prompt).toMatch(/`textTitle`/)
  })

  it('back-cover 字段：message + date 可选', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toMatch(/`message`/)
    // back-cover 的 date 是可选
    const backCoverSection = prompt.split('### `back-cover`')[1] ?? ''
    expect(backCoverSection).toMatch(/`date`.*可选/)
  })

  it('content layout 含 body 指引', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    const contentSection = prompt.split('### `content`')[1]?.split('### `')[0] ?? ''
    expect(contentSection).toContain('**body**')
  })

  it('保留四件套 + edit_slides + 工具参数约定文本', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toContain('update_slide')
    expect(prompt).toContain('create_slide')
    expect(prompt).toContain('delete_slide')
    expect(prompt).toContain('reorder_slides')
    expect(prompt).toContain('edit_slides')
    expect(prompt).toContain('replaceFrontmatter')
  })

  it('保留输出约束 + 中文商务表达 + 字数口径', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    expect(prompt).toContain('禁用套话')
    expect(prompt).toContain('≤ 150 字')
    expect(prompt).toContain('禁止')
    expect(prompt).toContain('合法 Slidev markdown')
  })

  it('promptPersona 段落出现在 prompt 开头附近', () => {
    const prompt = buildSystemPrompt({ templateId: 'company-standard' })
    // company-standard manifest 的 promptPersona 关键词
    expect(prompt).toContain('商务正式')
  })

  it('mcpBadges 提供时拼到 prompt 末尾，不提供时不拼', () => {
    const without = buildSystemPrompt({ templateId: 'company-standard' })
    expect(without).not.toContain('扩展工具（MCP）')
    const withBadges = buildSystemPrompt({
      templateId: 'company-standard',
      mcpBadges: ['搜索', '读网页'],
    })
    expect(withBadges).toContain('扩展工具（MCP）')
    expect(withBadges).toContain('搜索、读网页')
  })

  it('未知 templateId 抛错', () => {
    expect(() => buildSystemPrompt({ templateId: 'does-not-exist' })).toThrowError(
      /未知模板/,
    )
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

  it('templateId=company-standard → 200 + 含 7 个 layout', async () => {
    const res = await buildApp().request('/api/system-prompt?templateId=company-standard')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.templateId).toBe('company-standard')
    expect(json.prompt).toContain('### `cover`')
    expect(json.prompt).toContain('### `back-cover`')
  })

  it('mcpBadges query 拼到 prompt', async () => {
    const res = await buildApp().request(
      '/api/system-prompt?templateId=company-standard&mcpBadges=%E6%90%9C%E7%B4%A2,%E8%AF%BB%E7%BD%91%E9%A1%B5',
    )
    const json = await res.json()
    expect(json.prompt).toContain('搜索、读网页')
  })
})
