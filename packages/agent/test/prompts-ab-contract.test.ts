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
const BEITOU_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/beitou-standard/manifest.json',
)
const JINGYEDA_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/jingyeda-standard/manifest.json',
)

let tmpRoot: string
let templatesRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-prompt-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  // 复用真实两套 manifest.json，A/B contract 必须以生产 fixture 为准
  for (const id of ['beitou-standard', 'jingyeda-standard'] as const) {
    const dir = path.join(templatesRoot, id)
    fs.mkdirSync(dir, { recursive: true })
    const src = id === 'beitou-standard' ? BEITOU_MANIFEST_PATH : JINGYEDA_MANIFEST_PATH
    fs.copyFileSync(src, path.join(dir, 'manifest.json'))
    fs.writeFileSync(
      path.join(dir, 'starter.md'),
      `---\nlayout: ${id === 'beitou-standard' ? 'beitou-cover' : 'jingyeda-cover'}\nmainTitle: 占位\n---\n`,
    )
  }
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
    expect(prompt).toContain('<EqualSplit')
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

  it('可用 Components 段三个 sub-section 标题出现', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('## 可用 Components')
    expect(prompt).toContain('### 栅格类')
    expect(prompt).toContain('### 装饰类')
    expect(prompt).toContain('### 内容块类')
  })

  it('栅格类 6 个组件名都列在 Components 段（Phase 11.7 加 SixGrid + NineGrid 中央装饰 mode）', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    for (const name of [
      'EqualSplit',
      'OneVsThree',
      'TwoColumnsTwoRows',
      'SixGrid',
      'NineGrid',
      'ImageText',
    ]) {
      expect(prompt).toContain(`\`<${name}>\``)
    }
    // NineGrid 描述应含中央装饰 mode 提示
    expect(prompt).toContain('show-center-decoration')
    // 旧组件名不应再出现在 prompt 里
    expect(prompt).not.toContain('`<TwoCol>`')
    expect(prompt).not.toContain('`<ThreeCol>`')
    expect(prompt).not.toContain('`<OneLeftThreeRight>`')
    expect(prompt).not.toContain('`<OneRightThreeLeft>`')
    expect(prompt).not.toContain('`<OneTopThreeBottom>`')
  })

  it('装饰类 2 个组件 + 内容块类 6 个组件全部列出', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    for (const name of [
      'PetalFour',
      'ProcessFlow',
      'MetricCard',
      'Table',
      'Quote',
      'BarChart',
      'LineChart',
      'PieChart',
    ]) {
      expect(prompt).toContain(`\`<${name}>\``)
    }
  })

  it('Slot 容量速查表段含 small/medium/large 三档 + grid/decoration 组件分桶', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('Slot 容量速查')
    expect(prompt).toContain('**small**')
    expect(prompt).toContain('**medium**')
    expect(prompt).toContain('**large**')
    // small 应含 NineGrid + ProcessFlow
    expect(prompt).toMatch(/\*\*small\*\*[^\n]*<NineGrid>/)
    expect(prompt).toMatch(/\*\*small\*\*[^\n]*<ProcessFlow>/)
    // large 桶应含 ImageText(45/55 #text slot 容量大)
    expect(prompt).toMatch(/\*\*large\*\*[^\n]*<ImageText>/)
    // block 类(MetricCard / BarChart 等)不应出现在容量表(它们是叶子组件,无 slot)
    const tableSection = prompt.split('Slot 容量速查')[1]?.split('## ')[0] ?? ''
    expect(tableSection).not.toMatch(/\| .*<BarChart>.* \|/)
    expect(tableSection).not.toMatch(/\| .*<MetricCard>.* \|/)
  })

  it('工作模式 5 档段落 + 关键代价短语', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('## 工作模式')
    expect(prompt).toContain('5 档自由度')
    // 5 档每档至少有一个关键句段
    expect(prompt).toContain('档 1')
    expect(prompt).toContain('档 5')
    expect(prompt).toContain('字节级一致')
    expect(prompt).toContain('chart.js')
    expect(prompt).toContain('<script setup>')
  })

  it('决策树段含 5 条关键判定（必须栅格 / 优先装饰 / 必须 chart / 优先 metric / 切模板不重写）', () => {
    const prompt = buildSystemPrompt({ templateId: 'beitou-standard' })
    expect(prompt).toContain('## 选 Layout 与 Component 的决策树')
    expect(prompt).toContain('必须**用栅格类组件')
    expect(prompt).toContain('**优先**装饰类组件')
    expect(prompt).toContain('**必须** `<BarChart>`')
    expect(prompt).toContain('**优先** `<MetricCard>`')
    // Phase 11.6 dogfood:决策树最后一条改成「切换模板用 switch_template 工具」(原"仅替换 frontmatter"对 LLM 误导)
    expect(prompt).toContain('switch_template')
  })

  it('jingyeda-standard manifest 的 Components 段同样含组件 + 决策树', () => {
    const prompt = buildSystemPrompt({ templateId: 'jingyeda-standard' })
    expect(prompt).toContain('### 栅格类')
    expect(prompt).toContain('`<PetalFour>`')
    expect(prompt).toContain('`<EqualSplit>`')
    expect(prompt).toContain('## 选 Layout 与 Component 的决策树')
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

/**
 * Phase 11.6：图片优先模式（imageGenEnabled）双分支契约测试
 *
 * 关键认知：OFF 是当前行为；ON 用全新决策树**替换**原决策树
 * （不是叠加），把内容页流程导向 image-content layout + generate_slide_image。
 */
describe('buildSystemPrompt（Phase 11.6 图片优先双分支）', () => {
  it('imageGenEnabled=true → prompt 含图片优先决策树关键短语', () => {
    const prompt = buildSystemPrompt({
      templateId: 'beitou-standard',
      imageGenEnabled: true,
    })
    expect(prompt).toContain('图片优先')
    expect(prompt).toContain('image-content')
    expect(prompt).toContain('generate_slide_image')
    expect(prompt).toContain('fallbackSummary')
    // 显式列出例外的结构页（cover/toc/section/back-cover 仍走结构 layout）
    expect(prompt).toContain('cover')
    expect(prompt).toContain('toc')
    expect(prompt).toContain('section-title')
    expect(prompt).toContain('back-cover')
    // 关键约束：主 LLM 不指定形式，让生图 LLM 自决
    expect(prompt).toMatch(/不(要|得)指定(展示)?形式/)
  })

  it('imageGenEnabled=true → prompt 不再含 OFF 决策树的「优先 MetricCard / 必须 BarChart」组件指引', () => {
    const prompt = buildSystemPrompt({
      templateId: 'beitou-standard',
      imageGenEnabled: true,
    })
    // ON 模式下两条流程独立：内容页直走 image-content,不应让 LLM 再走组件路径
    expect(prompt).not.toContain('**必须** `<BarChart>`')
    expect(prompt).not.toContain('**优先** `<MetricCard>`')
    expect(prompt).not.toContain('**必须**用栅格类组件')
  })

  it('imageGenEnabled 默认 / false → 维持当前 OFF 决策树（含 BarChart / MetricCard / 栅格指引）', () => {
    const promptDefault = buildSystemPrompt({ templateId: 'beitou-standard' })
    const promptFalse = buildSystemPrompt({
      templateId: 'beitou-standard',
      imageGenEnabled: false,
    })
    for (const p of [promptDefault, promptFalse]) {
      expect(p).toContain('**必须** `<BarChart>`')
      expect(p).toContain('**优先** `<MetricCard>`')
      expect(p).toContain('必须**用栅格类组件')
      // 不能含 ON 独有短语（注：generate_slide_image 字面量在 manifest 的 image-content layout
      // 描述里就有,不算 ON 标记;真正的 ON 标记是「图片优先」+「fallbackSummary」+「写完 deck 后**必须**调」)
      expect(p).not.toContain('图片优先')
      expect(p).not.toContain('fallbackSummary')
    }
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
