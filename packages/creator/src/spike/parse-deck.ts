/**
 * Phase 10.5 spike Task C：Slidev 风格 markdown → Slide[] 解析器。
 *
 * Slidev 的 .md 格式（参考 templates/<id>/starter.md）：
 *   - 文件首部 `---\n<yaml>\n---\n` 是第一页的 frontmatter（带 layout 等字段，
 *     同时也是 deck 级 frontmatter—— theme / title 等都混在这里）
 *   - 其后每页用顶格 `---` 行分隔
 *   - 每页可选自己的 `<yaml>\n---\n` 头，然后是 markdown body
 *
 * Spike 实现策略：split on `^---$` → 配对扫描（fm chunk + body chunk）。
 * YAML 解析用 js-yaml（gray-matter 内置依赖，能直接 import）。
 * 不追求 Slidev 100% 兼容 —— 边界 case（body 内 column-0 ---、嵌套 codefence
 * 内的 ---）这里都不处理，spike 通过后由 plan 25 用 remark 兼容性插件包覆盖。
 */

import yaml from 'js-yaml'

export interface Slide {
  /** frontmatter 里的 layout 字段；缺省 'default'。 */
  layout: string
  /** 完整 frontmatter 字典，layout 也包含在内（v-bind 用得着）。 */
  frontmatter: Record<string, unknown>
  /** frontmatter 之后的 markdown 原文，未做 markdown→HTML 编译。 */
  body: string
}

/**
 * 判断 chunk 是否是 YAML frontmatter 块（区别于 markdown body）。
 *
 * 规则：trim 后所有非空行必须形如 `key:`、`key: value` 或 `- item`（YAML 列表）。
 * 这能区分 frontmatter 跟「正文 markdown 段落」—— 正文几乎不会全部行都是 `k:` 形式。
 */
function looksLikeFrontmatter(chunk: string): boolean {
  const lines = chunk.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return false
  return lines.every(
    (l) =>
      /^[a-zA-Z_][\w-]*\s*:/.test(l) || // key: value
      /^\s*-\s/.test(l) || // - list item
      /^\s+[a-zA-Z_]/.test(l), // indented continuation
  )
}

export function parseDeck(markdown: string): Slide[] {
  // 顶格 --- 行作为分隔符；保留前后空块以便后续按位置配对。
  const blocks = markdown.split(/^---\s*$/m)
  const slides: Slide[] = []

  let i = 0
  // 跳过首块（文件以 --- 开头时为空字符串）
  if (blocks.length && blocks[0].trim() === '') i++

  while (i < blocks.length) {
    const chunk = blocks[i]
    if (looksLikeFrontmatter(chunk)) {
      let fm: Record<string, unknown> = {}
      try {
        const parsed = yaml.load(chunk)
        if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>
      } catch {
        // YAML 解析失败时静默降级，整块当 body
        slides.push({ layout: 'default', frontmatter: {}, body: chunk.trim() })
        i++
        continue
      }
      // 紧随的下一块视为 body（可能是空白分隔，也可能是真 markdown）
      const body = i + 1 < blocks.length ? blocks[i + 1].trim() : ''
      slides.push({
        layout: typeof fm.layout === 'string' ? fm.layout : 'default',
        frontmatter: fm,
        body,
      })
      i += 2
    } else {
      // 非 YAML 块独立成页（layout 默认）
      const body = chunk.trim()
      if (body !== '') {
        slides.push({ layout: 'default', frontmatter: {}, body })
      }
      i++
    }
  }

  return slides
}
