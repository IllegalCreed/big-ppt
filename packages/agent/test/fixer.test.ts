import { describe, it, expect } from 'vitest'
import { fixOrphanedFrontmatter, looksLikeOrphanedFrontmatter } from '../src/slides-store/fixer.js'
import { parseSlides } from '../src/slides-store/pages.js'

describe('looksLikeOrphanedFrontmatter', () => {
  it('空 body → false', () => {
    expect(looksLikeOrphanedFrontmatter('')).toBe(false)
    expect(looksLikeOrphanedFrontmatter('   \n  ')).toBe(false)
  })

  it('全 yaml-only + 含 layout → true', () => {
    expect(looksLikeOrphanedFrontmatter('layout: foo\nheading: bar')).toBe(true)
    expect(
      looksLikeOrphanedFrontmatter('layout: beitou-content\nheading: 系统建设定位'),
    ).toBe(true)
  })

  it('全 yaml-only 但不含 layout → false(避免误伤普通 yaml 注释 / 数据)', () => {
    expect(looksLikeOrphanedFrontmatter('foo: 1\nbar: 2')).toBe(false)
  })

  it('含 markdown / HTML 标签 → false', () => {
    expect(looksLikeOrphanedFrontmatter('layout: foo\n\n# heading\n<div />')).toBe(false)
    expect(looksLikeOrphanedFrontmatter('<NineGrid>\n  <template #slot1>A</template>\n</NineGrid>')).toBe(false)
  })

  it('忽略空行和 # 注释行', () => {
    expect(looksLikeOrphanedFrontmatter('# 注释\nlayout: foo\n\nheading: bar')).toBe(true)
  })
})

describe('fixOrphanedFrontmatter', () => {
  it('合法 slides.md(每页有 body)→ no-op', () => {
    const md = [
      '---',
      'layout: cover',
      'title: t',
      '---',
      '',
      'cover body',
      '',
      '---',
      'layout: content',
      'heading: h',
      '---',
      '',
      '<MyComponent />',
      '',
    ].join('\n')
    const r = fixOrphanedFrontmatter(md)
    expect(r.fixCount).toBe(0)
    expect(r.fixed).toBe(md)
  })

  it('单处 LLM 错位:section-title 后接被吞的 content frontmatter,需插入 2 个分隔符', () => {
    // 末尾追加合法 trailing slide,接近 LLM 真实输出场景(slides.md 总有后续页)
    const md = [
      '---',
      'layout: beitou-section-title',
      'chapterNumber: 3',
      'chapterTitle: 项目过程管控',
      '---',
      'layout: beitou-content',
      'heading: 基建项目全周期流程',
      '---',
      '',
      '<ProcessFlow :cols="6" />',
      '',
      '---',
      'layout: beitou-back-cover',
      '---',
    ].join('\n')

    const r = fixOrphanedFrontmatter(md)
    // 1 处 LLM 错位 = 1 处 fm-like + fm-like 相邻 → 插入 1 个 ---
    expect(r.fixCount).toBe(1)

    const pages = parseSlides(r.fixed).pages
    expect(pages).toHaveLength(3)
    expect(pages[0]!.frontmatter).toMatchObject({
      layout: 'beitou-section-title',
      chapterNumber: 3,
      chapterTitle: '项目过程管控',
    })
    expect(pages[0]!.body).toBe('')
    expect(pages[1]!.frontmatter).toMatchObject({
      layout: 'beitou-content',
      heading: '基建项目全周期流程',
    })
    expect(pages[1]!.body).toContain('<ProcessFlow')
    expect(pages[2]!.frontmatter).toMatchObject({ layout: 'beitou-back-cover' })
  })

  it('连续多处错位:cover→toc→section-title→content 一路漏分隔,全部修复', () => {
    const md = [
      '---',
      'theme: seriph',
      'layout: beitou-cover',
      'mainTitle: T',
      '---',
      'layout: beitou-toc',
      'items: ["A", "B"]',
      '---',
      'layout: beitou-section-title',
      'chapterNumber: 1',
      'chapterTitle: 起步',
      '---',
      'layout: beitou-content',
      'heading: 引子',
      '---',
      '',
      'real content here',
      '',
      '---',
      'layout: beitou-back-cover',
      '---',
    ].join('\n')

    const r = fixOrphanedFrontmatter(md)
    expect(r.fixCount).toBe(3)

    const pages = parseSlides(r.fixed).pages
    expect(pages).toHaveLength(5)
    expect(pages[0]!.frontmatter.layout).toBe('beitou-cover')
    expect(pages[1]!.frontmatter.layout).toBe('beitou-toc')
    expect(pages[2]!.frontmatter.layout).toBe('beitou-section-title')
    expect(pages[3]!.frontmatter.layout).toBe('beitou-content')
    expect(pages[3]!.body).toContain('real content here')
    expect(pages[4]!.frontmatter.layout).toBe('beitou-back-cover')
  })

  it('合法 trailing slide(fm + EOF)不被误伤', () => {
    // trailing back-cover 合法,sepIdx 末尾有 fm 但前一段是真 body(markdown),
    // 算法不应在 back-cover 前插入 ---
    const md = [
      '---',
      'layout: A',
      '---',
      '',
      '# real markdown body',
      '',
      '---',
      'layout: back-cover',
      '---',
    ].join('\n')
    const r = fixOrphanedFrontmatter(md)
    expect(r.fixCount).toBe(0)
    expect(r.fixed).toBe(md)
  })

  it('body 看着像 yaml 但不含 layout 行 → 不动', () => {
    const md = [
      '---',
      'layout: A',
      '---',
      'foo: 1',
      'bar: 2',
      '---',
      '',
      'body',
    ].join('\n')
    const r = fixOrphanedFrontmatter(md)
    expect(r.fixCount).toBe(0)
  })

  it('parseSlides 抛错(slides.md 结构不合法)→ 返回原文', () => {
    const md = '---\nlayout: A\n# 缺收尾 ---'
    const r = fixOrphanedFrontmatter(md)
    expect(r.fixCount).toBe(0)
    expect(r.fixed).toBe(md)
  })

  it('修复后再过一遍 fixer 是 idempotent(已规范不再改)', () => {
    const md = [
      '---',
      'layout: A',
      '---',
      'layout: B',
      'heading: h',
      '---',
      '',
      'body',
      '',
      '---',
      'layout: C',
      '---',
    ].join('\n')
    const once = fixOrphanedFrontmatter(md)
    // 1 处 LLM 错位 = 1 处 fm-like 相邻,插入 1 个 ---
    expect(once.fixCount).toBe(1)
    const twice = fixOrphanedFrontmatter(once.fixed)
    expect(twice.fixCount).toBe(0)
    expect(twice.fixed).toBe(once.fixed)
  })
})
