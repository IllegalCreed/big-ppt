/**
 * Phase 7.5D-3：扫描 deck 内容判 5 档自由度等级（pure / not-pure 二分用于切模板路径）。
 *
 * 5 档定义（详 plan 16 关键决策抉择 #12）：
 *   档 1：仅自由 markdown 文字 / 列表
 *   档 2：含内联 HTML（<div> / <span>），style 中颜色 / 字体仅出现 var(--*) 形式
 *   档 3：仅含公共组件（commonComponentsCatalog 名单）+ 自由 markdown
 *   档 4：含 chart.js 字面量（new Chart( / import.*chart.js）/ 第三方 lib 现写
 *   档 5：含 <script setup> / 自定义未知 PascalCase 标签 / inline style 含 hardcode 颜色
 *         / 未知 layer-1 layout 名 / 模板私有组件名（LBeitou* / LJyd*）
 *
 * pure 判定：所有页 level ≤ 3 = pure，可走 deterministic 字符串替换；level ≥ 4 →
 * not-pure，fallback LLM 重写。
 */
import { ALL_COMPONENT_NAMES } from '../prompts/commonComponentsCatalog.js'

export type Level = 1 | 2 | 3 | 4 | 5

export interface DeckPurityResult {
  pure: boolean
  /** 全 deck 最高 level（取所有 chunk levels 的 max） */
  level: Level
  /**
   * 每个 chunk 的 level 数组。chunk 由 `\n---\n` 切片产生，包括 frontmatter 块
   * 与 body 块——所以长度通常 ≈ 页数 × 2。仅作内部观测，调用方一般用 level 即可。
   */
  chunkLevels: Level[]
  reasons: string[]
}

/** layer-1 layout 名单（10 个：beitou-* 5 + jingyeda-* 5）。未来加新模板需扩充。 */
export const LAYER1_LAYOUT_NAMES: readonly string[] = [
  'beitou-cover',
  'beitou-toc',
  'beitou-section-title',
  'beitou-content',
  'beitou-back-cover',
  'jingyeda-cover',
  'jingyeda-toc',
  'jingyeda-section-title',
  'jingyeda-content',
  'jingyeda-back-cover',
]

const COMMON_COMPONENT_SET = new Set(ALL_COMPONENT_NAMES)
const LAYER1_LAYOUT_SET = new Set(LAYER1_LAYOUT_NAMES)

/**
 * Slidev 内置 / 已有的合法 PascalCase 标签（不归 commonComponents 但允许出现）。
 * 包含：Vue 内置 <Transition> / <Teleport> / <Suspense> / <KeepAlive> 等；
 * Slidev 内置 <Counter>（之前的示例组件）；模板私有 layer-1 装饰组件
 * （LBeitouCoverLogo / LBeitouTitleBlock / LJydHeader 应该只在 layer-1 layout
 * 内部用，不该出现在 deck content 里——出现即 level 5 的污染信号）。
 */
const PASCAL_TAG_ALLOWED_NON_LD: readonly string[] = [
  'Transition',
  'Teleport',
  'Suspense',
  'KeepAlive',
  'Counter', // Phase 3 之前留的示例组件
]
const PASCAL_TAG_ALLOWED_NON_LD_SET = new Set(PASCAL_TAG_ALLOWED_NON_LD)

/** 把 deck content 切片为多个 slide（按 Slidev 的 `\n---\n` 分隔） */
function splitSlides(content: string): string[] {
  // 首页可能没 leading "---"；按 "\n---\n" 切；首块 frontmatter 用 `---\n...\n---\n` 包
  // 实际 deck 内容中页间分隔是单独一行 "---"（前后有 \n）；用正则切。
  return content
    .split(/^---\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 提取 frontmatter 块内 `layout:` 字段值（每页 frontmatter 在第一个 --- 块内） */
function extractLayoutFromFrontmatter(slide: string): string | null {
  // slide 文本类似：
  //   layout: beitou-cover
  //   mainTitle: ...
  //   ---
  //   <body>...
  // 我们只看顶部 frontmatter 里的 layout: 行
  const lines = slide.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('---')) break // 进入 body
    const match = trimmed.match(/^layout:\s*(\S+)/)
    if (match) return match[1]
  }
  return null
}

/** 单 chunk 扫描，返回该 chunk 的 level + 触发原因 */
function analyzeChunk(chunk: string, idx: number): { level: Level; reasons: string[] } {
  const reasons: string[] = []
  let level: Level = 1

  // 1. 检查 frontmatter layout（只在含 `layout:` 行的 chunk 触发）
  const layout = extractLayoutFromFrontmatter(chunk)
  if (layout && !LAYER1_LAYOUT_SET.has(layout)) {
    reasons.push(`chunk #${idx + 1} layout 字段 \`${layout}\` 不在 layer-1 名单内`)
    return { level: 5, reasons }
  }

  // 2. 检查 <script setup> 标签
  if (/<script[^>]*\bsetup\b/i.test(chunk)) {
    reasons.push(`chunk #${idx + 1} 含 <script setup> 原创组件`)
    level = 5
  }

  // 3. 检查 chart.js 字面量
  if (/new\s+Chart\s*\(/.test(chunk) || /from\s+['"]chart\.js/.test(chunk)) {
    reasons.push(`chunk #${idx + 1} 含 chart.js 现场代码`)
    if (level < 4) level = 4
  }

  // 4. 检查 inline style 是否含 hardcode 颜色（hex / rgb / 命名色）
  //    允许 var(--*) 引用
  const styleMatches = chunk.matchAll(/style\s*=\s*"([^"]*)"/g)
  for (const m of styleMatches) {
    const styleVal = m[1]
    const hex = /#[0-9a-fA-F]{3,8}\b/.test(styleVal)
    const rgb = /\brgba?\s*\(/.test(styleVal)
    if (hex || rgb) {
      reasons.push(`chunk #${idx + 1} style 内含 hardcode 颜色（应用 var(--ld-*) token）`)
      level = 5
    }
  }

  // 5. 扫描 body 中所有 PascalCase 起头标签
  const tagMatches = chunk.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)
  let usedCommonComponent = false
  for (const m of tagMatches) {
    const tag = m[1]
    if (COMMON_COMPONENT_SET.has(tag)) {
      usedCommonComponent = true
      continue
    }
    if (PASCAL_TAG_ALLOWED_NON_LD_SET.has(tag)) continue
    if (tag.startsWith('LBeitou') || tag.startsWith('LJyd')) {
      reasons.push(`chunk #${idx + 1} 含模板私有组件 <${tag}>（应只在 layer-1 layout 内部使用）`)
      level = 5
      continue
    }
    reasons.push(`chunk #${idx + 1} 含未知组件 <${tag}>（不在公共 catalog 内）`)
    level = 5
  }
  if (level === 1 && usedCommonComponent) level = 3

  // 6. 内联 HTML 抬到档 2
  if (level <= 2) {
    const lowerHtmlTag = /<(div|span|section|article|p|figure|aside)\b/i.test(chunk)
    if (lowerHtmlTag) level = level === 1 ? 2 : level
  }

  return { level, reasons }
}

/**
 * 扫描整个 deck content，输出 5 档自由度等级 + 详细原因。
 *
 * - pure = true 当且仅当所有 chunk level ≤ 3
 * - level 取所有 chunk levels 的 max
 *
 * 分块策略：按 `^---$` 行简单切片；frontmatter 块（含 layout: 字段的 chunk）
 * 与 body 块都被独立扫描。空 chunk 跳过。
 */
export function analyzeDeckPurity(content: string): DeckPurityResult {
  const chunks = splitSlides(content)
  if (chunks.length === 0) {
    return { pure: true, level: 1, chunkLevels: [], reasons: [] }
  }

  const chunkLevels: Level[] = []
  const reasons: string[] = []
  let maxLevel: Level = 1

  for (let i = 0; i < chunks.length; i++) {
    const result = analyzeChunk(chunks[i], i)
    chunkLevels.push(result.level)
    if (result.level > maxLevel) maxLevel = result.level
    reasons.push(...result.reasons)
  }

  return {
    pure: maxLevel <= 3,
    level: maxLevel,
    chunkLevels,
    reasons,
  }
}
