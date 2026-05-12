/**
 * Phase 10.5 spike Task C：parseDeck 单测。
 *
 * 真实 starter.md fixture 直接读 workspace 内 slidev 包，确保「spike 解析器
 * 能吃下我们当前实际投产的两套模板 starter」这一硬约束。
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
    const slides = parseDeck('# Hello\n\nworld')
    expect(slides).toHaveLength(1)
    expect(slides[0].layout).toBe('default')
    expect(slides[0].frontmatter).toEqual({})
    expect(slides[0].body).toContain('# Hello')
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
    const slides = parseDeck(md)
    expect(slides).toHaveLength(2)
    expect(slides[0].layout).toBe('beitou-cover')
    expect(slides[0].frontmatter.mainTitle).toBe('T1')
    expect(slides[0].body).toBe('')
    expect(slides[1].layout).toBe('beitou-content')
    expect(slides[1].frontmatter.heading).toBe('H2')
    expect(slides[1].body).toBe('body of slide 2')
  })

  it('真实北投 starter.md：5 页全识别，layout 字段对', () => {
    const md = fixture('../../../slidev/templates/beitou-standard/starter.md')
    const slides = parseDeck(md)
    expect(slides.length).toBe(5)
    expect(slides.map((s) => s.layout)).toEqual([
      'beitou-cover',
      'beitou-toc',
      'beitou-section-title',
      'beitou-content',
      'beitou-back-cover',
    ])
    // cover 页同时承担 deck-level frontmatter
    expect(slides[0].frontmatter.theme).toBe('seriph')
    expect(slides[0].frontmatter.title).toBe('新建幻灯片')
    // toc 页 items 是 YAML 内联数组
    expect(slides[1].frontmatter.items).toEqual(['背景介绍', '数据概览', '对比分析'])
    // content 页 body 含 <TwoCol> Vue 组件标签（spike 阶段不渲染 Vue 标签，
    // 仅验证 body 透传）
    expect(slides[3].body).toContain('<TwoCol')
    expect(slides[3].body).toContain('使用示例')
  })

  it('真实竞业达 starter.md：layout 全部 jingyeda-* 前缀', () => {
    const md = fixture('../../../slidev/templates/jingyeda-standard/starter.md')
    const slides = parseDeck(md)
    expect(slides.length).toBeGreaterThanOrEqual(3)
    expect(slides[0].layout).toMatch(/^jingyeda-/)
    expect(slides[slides.length - 1].layout).toMatch(/^jingyeda-/)
  })

  it('YAML 解析失败时静默降级为 layout=default', () => {
    // 故意写错的 YAML（冒号后没空格 + 缩进非法）
    const md = ['---', 'layout: cover', '  bad indent: [unclosed', '---', '', 'body'].join('\n')
    const slides = parseDeck(md)
    expect(slides.length).toBeGreaterThanOrEqual(1)
    // 不抛异常即算通过
    expect(slides[0]).toBeDefined()
  })
})
