/**
 * Phase 10.5 落地：parseDeck 单测。
 *
 * 真实 starter.md fixture 直接读 workspace 内 slidev 包。原 spike 5 case
 * 保留 + 新增 deck-level frontmatter 抽出 case（Task 25-B-1 新增功能）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDeck } from './parse-deck'

function fixture(rel: string): string {
  const p = fileURLToPath(new URL(rel, import.meta.url))
  return readFileSync(p, 'utf8')
}

describe('parseDeck', () => {
  it('单页 markdown 无 frontmatter → layout=default + body 透传', () => {
    const { slides, deckFrontmatter } = parseDeck('# Hello\n\nworld')
    expect(slides).toHaveLength(1)
    expect(slides[0]?.layout).toBe('default')
    expect(slides[0]?.frontmatter).toEqual({})
    expect(slides[0]?.body).toContain('# Hello')
    expect(deckFrontmatter).toEqual({})
  })

  it('多页用顶格 --- 分隔，每页带自己的 frontmatter', () => {
    const md = [
      '---',
      'layout: beitou-cover',
      'mainTitle: T1',
      '---',
      '',
      '---',
      'layout: beitou-content',
      'heading: H2',
      '---',
      '',
      'body of slide 2',
      '',
    ].join('\n')
    const { slides } = parseDeck(md)
    expect(slides).toHaveLength(2)
    expect(slides[0]?.layout).toBe('beitou-cover')
    expect(slides[0]?.frontmatter.mainTitle).toBe('T1')
    expect(slides[0]?.body).toBe('')
    expect(slides[1]?.layout).toBe('beitou-content')
    expect(slides[1]?.frontmatter.heading).toBe('H2')
    expect(slides[1]?.body).toBe('body of slide 2')
  })

  it('真实北投 starter.md：5 页全识别，layout 字段对', () => {
    const md = fixture('../../../slidev/templates/beitou-standard/starter.md')
    const { slides } = parseDeck(md)
    expect(slides.length).toBe(5)
    expect(slides.map((s) => s.layout)).toEqual([
      'beitou-cover',
      'beitou-toc',
      'beitou-section-title',
      'beitou-content',
      'beitou-back-cover',
    ])
    // toc 页 items 是 YAML 内联数组
    expect(slides[1]?.frontmatter.items).toEqual(['背景介绍', '数据概览', '对比分析'])
    // content 页 body 含 <EqualSplit> Vue 组件标签(Phase 11.8 dogfood:starter
    // 删废弃 <TwoCol> 用 EqualSplit count=2 取代)
    expect(slides[3]?.body).toContain('<EqualSplit')
    expect(slides[3]?.body).toContain('使用示例')
  })

  it('真实竞业达 starter.md：layout 全部 jingyeda-* 前缀', () => {
    const md = fixture('../../../slidev/templates/jingyeda-standard/starter.md')
    const { slides } = parseDeck(md)
    expect(slides.length).toBeGreaterThanOrEqual(3)
    expect(slides[0]?.layout).toMatch(/^jingyeda-/)
    const last = slides[slides.length - 1]
    expect(last?.layout).toMatch(/^jingyeda-/)
  })

  it('YAML 解析失败时静默降级为 layout=default', () => {
    const md = ['---', 'layout: cover', '  bad indent: [unclosed', '---', '', 'body'].join('\n')
    const { slides } = parseDeck(md)
    expect(slides.length).toBeGreaterThanOrEqual(1)
    expect(slides[0]).toBeDefined()
  })

  it('deck-level frontmatter 抽出：theme/title/transition 不污染 slide-1 frontmatter', () => {
    const md = fixture('../../../slidev/templates/beitou-standard/starter.md')
    const { deckFrontmatter, slides } = parseDeck(md)
    // 跑去 deck-level
    expect(deckFrontmatter.theme).toBe('seriph')
    expect(deckFrontmatter.title).toBe('新建幻灯片')
    expect(deckFrontmatter.transition).toBe('slide-left')
    expect(deckFrontmatter.routerMode).toBe('hash')
    // 真正属于 slide-1 的字段留下
    expect(slides[0]?.layout).toBe('beitou-cover')
    expect(slides[0]?.frontmatter.mainTitle).toBe('请填写标题')
    // slide-1 frontmatter 不应再有 deck-level 字段
    expect(slides[0]?.frontmatter).not.toHaveProperty('theme')
    expect(slides[0]?.frontmatter).not.toHaveProperty('title')
    expect(slides[0]?.frontmatter).not.toHaveProperty('transition')
  })

  it('提取末尾 HTML comment 为演讲者备注并从正文移除', () => {
    const md = [
      '---',
      'layout: beitou-content',
      'heading: Roadmap',
      '---',
      '',
      '正文内容',
      '',
      '<!--',
      '先讲结论，再解释风险。',
      '-->',
    ].join('\n')

    const { slides } = parseDeck(md)
    expect(slides[0]?.body).toBe('正文内容')
    expect(slides[0]?.notes).toBe('先讲结论，再解释风险。')
  })

  it('正文中间的 HTML comment 不误判为演讲者备注', () => {
    const { slides } = parseDeck('# A\n\n<!-- inline -->\n\n后续正文')
    expect(slides[0]?.notes).toBe('')
    expect(slides[0]?.body).toContain('<!-- inline -->')
  })
})
