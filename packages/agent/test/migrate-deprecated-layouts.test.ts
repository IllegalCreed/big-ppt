import { describe, expect, it } from 'vitest'
import {
  migrateContent,
  rewriteFrontmatterField,
  splitDeckPages,
} from '../src/templates/migrate-deprecated-layouts.js'

describe('rewriteFrontmatterField', () => {
  it('删除单行字段 + 保留其他', () => {
    const fm = 'layout: beitou-data\nheading: 关键指标\nmetrics: [{a:1}]\nother: 1'
    const { result, removed } = rewriteFrontmatterField(fm, 'metrics')
    expect(removed).toBe(true)
    expect(result).not.toContain('metrics:')
    expect(result).toContain('heading: 关键指标')
    expect(result).toContain('other: 1')
  })

  it('删除多行 YAML 数组字段（带 - 前缀续行）', () => {
    const fm = `layout: beitou-data
heading: X
metrics:
  - { value: "100", label: "A" }
  - { value: "200", label: "B" }
nextField: keep`
    const { result, removed } = rewriteFrontmatterField(fm, 'metrics')
    expect(removed).toBe(true)
    expect(result).not.toContain('metrics:')
    expect(result).not.toContain('value: "100"')
    expect(result).toContain('nextField: keep')
  })

  it('字段不存在 → removed=false，原文保留', () => {
    const fm = 'layout: beitou-content\nheading: X'
    const { result, removed } = rewriteFrontmatterField(fm, 'metrics')
    expect(removed).toBe(false)
    expect(result).toBe(fm)
  })
})

describe('splitDeckPages', () => {
  it('多页 deck 切到对应 frontmatter / body', () => {
    const content = `---
layout: beitou-cover
mainTitle: A
---

封面 body 占位

---
layout: beitou-content
heading: 第二页
---

正文`
    const pages = splitDeckPages(content)
    expect(pages.length).toBe(2)
    expect(pages[0].frontmatter).toContain('layout: beitou-cover')
    expect(pages[0].body).toContain('封面 body')
    expect(pages[1].frontmatter).toContain('layout: beitou-content')
    expect(pages[1].body).toContain('正文')
  })
})

describe('migrateContent', () => {
  it('beitou-data 页：layout → content + 移除 metrics 字段', () => {
    const old = `---
layout: beitou-data
heading: 数据
metrics:
  - { value: "100", label: "A" }
  - { value: "200", label: "B" }
---

<BarChart :labels='["Q1","Q2"]' :values='[1,2]' />`
    const { newContent, pageRewrites } = migrateContent(old)
    expect(pageRewrites).toHaveLength(1)
    expect(pageRewrites[0].oldLayout).toBe('beitou-data')
    expect(pageRewrites[0].newLayout).toBe('beitou-content')
    expect(pageRewrites[0].removedFields).toContain('metrics')
    expect(newContent).toContain('layout: beitou-content')
    expect(newContent).not.toContain('layout: beitou-data')
    expect(newContent).not.toContain('metrics:')
    // body 保留
    expect(newContent).toContain('<BarChart')
  })

  it('beitou-two-col 页：删除 leftTitle / rightTitle 字段', () => {
    const old = `---
layout: beitou-two-col
heading: 对比
leftTitle: 旧
rightTitle: 新
---

::left::
左栏内容

::right::
右栏内容`
    const { newContent, pageRewrites } = migrateContent(old)
    expect(pageRewrites[0].oldLayout).toBe('beitou-two-col')
    expect(pageRewrites[0].newLayout).toBe('beitou-content')
    expect(pageRewrites[0].removedFields).toEqual(
      expect.arrayContaining(['leftTitle', 'rightTitle']),
    )
    expect(newContent).toContain('layout: beitou-content')
    expect(newContent).not.toContain('leftTitle:')
    expect(newContent).not.toContain('rightTitle:')
    // body 老 slot 语法保留（不渲染但不丢内容）
    expect(newContent).toContain('::left::')
    expect(newContent).toContain('::right::')
  })

  it('jingyeda-image-content 页：删除 image / textTitle 字段', () => {
    const old = `---
layout: jingyeda-image-content
heading: 图文
image: /templates/jingyeda-standard/hero.png
textTitle: 标题
---

正文文字`
    const { newContent, pageRewrites } = migrateContent(old)
    expect(pageRewrites[0].oldLayout).toBe('jingyeda-image-content')
    expect(pageRewrites[0].newLayout).toBe('jingyeda-content')
    expect(pageRewrites[0].removedFields).toEqual(expect.arrayContaining(['image', 'textTitle']))
    expect(newContent).toContain('layout: jingyeda-content')
    expect(newContent).not.toContain('image:')
    expect(newContent).not.toContain('textTitle:')
  })

  it('幂等：已是 content layout 的 deck 不动', () => {
    const old = `---
layout: beitou-cover
mainTitle: A
---

---
layout: beitou-content
heading: B
---

正文`
    const { newContent, pageRewrites } = migrateContent(old)
    expect(pageRewrites).toEqual([])
    // 内容字面量不变（重组后空白可能微调，做包含断言）
    expect(newContent).toContain('layout: beitou-cover')
    expect(newContent).toContain('layout: beitou-content')
    expect(newContent).toContain('正文')
  })

  it('混合页：只迁移含旧 layout 的页，其他不动', () => {
    const old = `---
layout: beitou-cover
mainTitle: 标题
---

---
layout: beitou-data
heading: 数据
metrics: [{value: "1"}]
---

<BarChart />

---
layout: beitou-back-cover
message: 谢谢
---`
    const { pageRewrites } = migrateContent(old)
    expect(pageRewrites).toHaveLength(1)
    expect(pageRewrites[0].pageIndex).toBe(1) // 只有第 2 页是 data
    expect(pageRewrites[0].oldLayout).toBe('beitou-data')
  })
})
