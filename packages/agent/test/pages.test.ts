import { describe, expect, it } from 'vitest'
import { parseSlides, serializeSlides } from '../src/slides-store/pages.js'

describe('parseSlides', () => {
  it('解析单页（frontmatter + body）', () => {
    const md = '---\nlayout: cover\ntitle: hello\n---\n\n# Hello\n'
    const { pages } = parseSlides(md)
    expect(pages.length).toBe(1)
    expect(pages[0]!.frontmatter).toEqual({ layout: 'cover', title: 'hello' })
    expect(pages[0]!.body.trim()).toBe('# Hello')
  })

  it('解析多页，保留 frontmatter 与 body', () => {
    const md =
      '---\nlayout: cover\n---\n\n# P1\n\n---\nlayout: two-col\n---\n\n# P2\n'
    const { pages } = parseSlides(md)
    expect(pages.length).toBe(2)
    expect(pages[0]!.frontmatter.layout).toBe('cover')
    expect(pages[0]!.body.trim()).toBe('# P1')
    expect(pages[1]!.frontmatter.layout).toBe('two-col')
    expect(pages[1]!.body.trim()).toBe('# P2')
  })

  it('首块 frontmatter 混入 Slidev 全局配置视为 pages[0] 自带', () => {
    const md = '---\ntheme: seriph\ntitle: 我的演示\nlayout: cover\n---\n\nbody\n'
    const { pages } = parseSlides(md)
    expect(pages[0]!.frontmatter).toEqual({
      theme: 'seriph',
      title: '我的演示',
      layout: 'cover',
    })
  })

  it('支持 CRLF 行尾（Windows 文件）', () => {
    const md = '---\r\nlayout: cover\r\n---\r\n\r\nbody\r\n'
    const { pages } = parseSlides(md)
    expect(pages.length).toBe(1)
    expect(pages[0]!.frontmatter.layout).toBe('cover')
  })

  it('识别数字 / 布尔 / null', () => {
    const md = '---\nclicks: 5\nhide: true\nnote: null\nratio: 0.75\n---\n\nbody\n'
    const fm = parseSlides(md).pages[0]!.frontmatter
    expect(fm.clicks).toBe(5)
    expect(fm.hide).toBe(true)
    expect(fm.note).toBeNull()
    expect(fm.ratio).toBe(0.75)
  })

  it('识别带引号字符串', () => {
    const md = '---\ntitle: "hello: world"\nname: \'my-slide\'\n---\n\nbody\n'
    const fm = parseSlides(md).pages[0]!.frontmatter
    expect(fm.title).toBe('hello: world')
    expect(fm.name).toBe('my-slide')
  })

  it('识别 inline array', () => {
    const md = '---\naddons: ["./foo", "./bar"]\n---\n\nbody\n'
    const fm = parseSlides(md).pages[0]!.frontmatter
    expect(fm.addons).toEqual(['./foo', './bar'])
  })

  it('忽略注释和空行', () => {
    const md = '---\n# 这是一行注释\nlayout: cover\n\ntitle: hi\n---\n\nbody\n'
    const fm = parseSlides(md).pages[0]!.frontmatter
    expect(fm).toEqual({ layout: 'cover', title: 'hi' })
  })

  it('不以 --- 开头时抛错', () => {
    expect(() => parseSlides('no frontmatter\n')).toThrow(/---/)
  })

  it('frontmatter 未闭合时抛错', () => {
    expect(() => parseSlides('---\nlayout: cover\nbody without closing\n')).toThrow(/未闭合/)
  })

  it('pages 下标从 0 开始，顺序与文档一致', () => {
    const md = '---\na: 1\n---\n\nB1\n\n---\na: 2\n---\n\nB2\n\n---\na: 3\n---\n\nB3\n'
    const { pages } = parseSlides(md)
    expect(pages.map((p) => p.index)).toEqual([0, 1, 2])
    expect(pages.map((p) => p.frontmatter.a)).toEqual([1, 2, 3])
  })
})

describe('serializeSlides + round-trip', () => {
  it('canonical 形态下 serialize(parse(x)) === x', () => {
    const canonical = '---\nlayout: cover\ntitle: hi\n---\n\nbody\n'
    expect(serializeSlides(parseSlides(canonical))).toBe(canonical)
  })

  it('幂等：serialize(parse(serialize(parse(x)))) === serialize(parse(x))', () => {
    const noisy =
      '---\n# 注释\ntheme: seriph\n\nclicks: 3\n---\n\n\n# P1\n\n\n---\nlayout: two-col\nhide: false\n---\n\n# P2\n\n\n'
    const once = serializeSlides(parseSlides(noisy))
    const twice = serializeSlides(parseSlides(once))
    expect(twice).toBe(once)
  })

  it('含冒号必加引号；不被 YAML 误解的字符串保持无引号也能 round-trip', () => {
    const input = { pages: [{ index: 0, frontmatter: { tag: 'a:b', v: '1.2.3' }, body: 'x' }] }
    const out = serializeSlides(input)
    expect(out).toContain('tag: "a:b"')
    // v: '1.2.3' 不是合法 YAML number，不加引号也能回到字符串值
    const re = parseSlides(out).pages[0]!.frontmatter
    expect(re.tag).toBe('a:b')
    expect(re.v).toBe('1.2.3')
  })

  it('看起来像 bool / number 的字符串必加引号防止类型漂移', () => {
    const input = {
      pages: [
        { index: 0, frontmatter: { s1: 'true', s2: '42', s3: 'null' }, body: 'x' },
      ],
    }
    const out = serializeSlides(input)
    const re = parseSlides(out).pages[0]!.frontmatter
    // 最关键：round-trip 后仍是字符串而不是 bool/number/null
    expect(re.s1).toBe('true')
    expect(re.s2).toBe('42')
    expect(re.s3).toBe('null')
  })

  it('空 frontmatter 的页可输出 `---\\n---`', () => {
    const input = { pages: [{ index: 0, frontmatter: {}, body: 'only body' }] }
    const out = serializeSlides(input)
    expect(out).toContain('---\n---\n')
    expect(out).toContain('only body')
  })

  it('多页 serialize 每页之间有单空行分隔 body', () => {
    const input = {
      pages: [
        { index: 0, frontmatter: { a: 1 }, body: '# P1' },
        { index: 1, frontmatter: { a: 2 }, body: '# P2' },
      ],
    }
    const out = serializeSlides(input)
    const { pages } = parseSlides(out)
    expect(pages.length).toBe(2)
    expect(pages[0]!.body.trim()).toBe('# P1')
    expect(pages[1]!.body.trim()).toBe('# P2')
  })
})
