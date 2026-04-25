/**
 * Phase 7D fix（hash-mode）：mirror 写盘前 ensureRouterModeHash 注入。
 *
 * 让老 deck（DB 历史 content 没声明 routerMode）激活/恢复时被强制加 hash 路由模式，
 * 避免 iframe 翻页时改 src（path）触发整体 reload。
 */
import { describe, expect, it } from 'vitest'
import { ensureRouterModeHash } from '../src/deck/mirror.js'

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
