/**
 * Phase 7D fix（hash-mode）：mirror 写盘前 ensureRouterModeHash 注入。
 *
 * 让老 deck（DB 历史 content 没声明 routerMode）激活/恢复时被强制加 hash 路由模式，
 * 避免 iframe 翻页时改 src（path）触发整体 reload。
 */
import { describe, expect, it } from 'vitest'
import { ensureRouterModeHash, ensureValidTheme } from '../src/deck/mirror.js'

describe('ensureRouterModeHash', () => {
  it('frontmatter 缺 routerMode → 插入 routerMode: hash', () => {
    const input = `---
theme: seriph
title: X
---

# page1
`
    const out = ensureRouterModeHash(input)
    expect(out).toContain('routerMode: hash')
    expect(out).toMatch(/title: X\nrouterMode: hash\n---/)
    // 后续内容不变
    expect(out).toContain('# page1')
  })

  it('frontmatter 已有 routerMode → 保持不动（用户优先）', () => {
    const input = `---
title: X
routerMode: history
---

body
`
    expect(ensureRouterModeHash(input)).toBe(input)
  })

  it('frontmatter 已有 routerMode: hash → 等价 no-op', () => {
    const input = `---
routerMode: hash
title: X
---

body
`
    expect(ensureRouterModeHash(input)).toBe(input)
  })

  it('content 不以 --- 开头（非 Slidev 文本）→ 不强插，保持原样', () => {
    const input = '# 普通 markdown\n\n没有 frontmatter\n'
    expect(ensureRouterModeHash(input)).toBe(input)
  })

  it('frontmatter 不闭合（畸形） → 不强插', () => {
    const input = '---\ntitle: 没有结尾\n\nbody'
    expect(ensureRouterModeHash(input)).toBe(input)
  })

  it('CRLF 行尾兼容', () => {
    const input = '---\r\ntitle: X\r\n---\r\n\r\n# body'
    const out = ensureRouterModeHash(input)
    expect(out).toContain('routerMode: hash')
  })

  it('多页 deck 只动第一段 frontmatter', () => {
    const input = `---
title: deck
layout: cover
---

# page1

---
layout: content
---

# page2
`
    const out = ensureRouterModeHash(input)
    // 第一段被加
    expect(out.split('---')[1]).toContain('routerMode: hash')
    // 第二段不变（layout: content 行后无 routerMode 注入）
    const segs = out.split(/^---$/m)
    expect(segs[3]).not.toContain('routerMode')
  })
})

describe('ensureValidTheme', () => {
  it('theme 是 seriph → 不动', () => {
    const input = '---\ntheme: seriph\nlayout: cover\n---\n\nbody'
    expect(ensureValidTheme(input)).toBe(input)
  })

  it('theme 是 default → 不动（slidev 内置主题）', () => {
    const input = '---\ntheme: default\nlayout: cover\n---\n\nbody'
    expect(ensureValidTheme(input)).toBe(input)
  })

  it('theme 是模板 id（jingyeda-standard）→ 强制改回 seriph（用户线上踩到的真实场景）', () => {
    const input = '---\ntheme: jingyeda-standard\nlayout: jingyeda-cover\nrouterMode: hash\n---\n\nbody'
    const out = ensureValidTheme(input)
    expect(out).toContain('theme: seriph')
    expect(out).not.toContain('theme: jingyeda-standard')
    // 其他字段保留
    expect(out).toContain('layout: jingyeda-cover')
    expect(out).toContain('routerMode: hash')
  })

  it('theme 带引号 → 也能识别并修', () => {
    const input = '---\ntheme: "jingyeda-standard"\nlayout: x\n---\n\nbody'
    const out = ensureValidTheme(input)
    expect(out).toContain('theme: seriph')
  })

  it('frontmatter 不含 theme 字段 → 不动（slidev 用 default 主题不会 crash）', () => {
    const input = '---\nlayout: cover\nrouterMode: hash\n---\n\nbody'
    expect(ensureValidTheme(input)).toBe(input)
  })

  it('content 不以 --- 开头 → 不动', () => {
    expect(ensureValidTheme('# raw markdown')).toBe('# raw markdown')
  })

  it('多页中第二段 frontmatter 的 theme 字段（边角情况）→ 不动（只兜底首段）', () => {
    const input = `---
theme: seriph
layout: cover
---

# page1

---
theme: ignore-me
layout: content
---

# page2
`
    const out = ensureValidTheme(input)
    // 首段不动
    expect(out).toContain('theme: seriph')
    // 第二段（不是真正的 slidev frontmatter，只是页内分隔符）保留原样
    expect(out).toContain('theme: ignore-me')
  })
})
