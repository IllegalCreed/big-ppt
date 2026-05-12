/**
 * Phase 10.5 spike Task A：防回归测试。
 *
 * 断言：layouts/ + components/{block,grid,decoration,private}/ 下所有 .vue
 * 不依赖 Slidev runtime 注入 API（$slidev / $nav / useNav / useSlideContext /
 * useDarkMode / useFixedClicks / $clicks）以及 `@slidev/client` import。
 *
 * 为什么要这道闸门：Phase 10.5 计划把 Slidev iframe 形态拆掉，改成 creator SPA
 * 内的 <DeckRenderer> Vue 组件直接 import 这批 layout/component 渲染。一旦未来
 * 哪个 layout 偷偷引入了 Slidev runtime API，DeckRenderer 就会在运行时报
 * "Cannot read property X of undefined"——此测试在 PR 阶段就把这种回归挡住。
 *
 * 设计期 2026-05-12 baseline：rg 全仓 0/278 命中，本测试断言保持 0 命中。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// jsdom env 下 import.meta.url 不一定是 file://，统一用 cwd。
// vitest 配置 root 已设到 packages/slidev/，process.cwd() 就是 slidev 根。
const slidevRoot = process.cwd()

const SCAN_DIRS = [
  'layouts',
  'components/block',
  'components/grid',
  'components/decoration',
  'components/private',
] as const

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: '$slidev 注入', re: /\$slidev\b/ },
  { name: '$nav 注入', re: /\$nav\b/ },
  { name: '@slidev/client import', re: /@slidev\/client/ },
  { name: 'useNav 组合式 API', re: /\buseNav\s*\(/ },
  { name: 'useSlideContext 组合式 API', re: /\buseSlideContext\s*\(/ },
  { name: 'useDarkMode 组合式 API', re: /\buseDarkMode\s*\(/ },
  { name: 'useFixedClicks 组合式 API', re: /\buseFixedClicks\s*\(/ },
  { name: '$clicks 注入', re: /\$clicks\b/ },
]

function listVueFiles(dir: string): string[] {
  const abs = join(slidevRoot, dir)
  const out: string[] = []
  try {
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        out.push(...listVueFiles(join(dir, entry)))
      } else if (entry.endsWith('.vue')) {
        out.push(join(dir, entry))
      }
    }
  } catch {
    // 目录不存在不报错（component 子目录可能后续增删）
  }
  return out
}

describe('Slidev runtime API 依赖防回归（Phase 10.5 spike 前置）', () => {
  const files = SCAN_DIRS.flatMap((d) => listVueFiles(d))

  it('至少扫到 20 个 .vue 文件（兜底：路径写错时直接红）', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`无文件命中: ${pattern.name}`, () => {
      const hits: string[] = []
      for (const rel of files) {
        const content = readFileSync(join(slidevRoot, rel), 'utf8')
        if (pattern.re.test(content)) {
          hits.push(rel)
        }
      }
      expect(hits, `命中 ${pattern.name}（破坏 Phase 10.5 spike 前提）：\n${hits.join('\n')}`).toEqual([])
    })
  }
})
