/**
 * Slidev slides.md 健壮性修复:LLM 漏写 slide body 分隔符导致的 frontmatter 被吞。
 *
 * Slidev 的 slide 结构是 `---\n<frontmatter>\n---\n<body>`。LLM 偶尔会把多个 slide
 * 的 frontmatter 直接连写,中间漏写"空 body + 分隔符":
 *
 *   ---
 *   layout: A
 *   ---
 *   layout: B           ← LLM 想给下一页的 frontmatter,实际被 Slidev 当成 page A 的 body
 *   heading: foo
 *   ---
 *
 *   <实际的 body...>     ← 此页因为没 frontmatter,Slidev 退回默认主题(蓝色 / 无 header)
 *
 * 用户症状:beitou 模板该红却蓝、内容页该有 header 没 header,因为受影响那页根本
 * 没套上 beitou-* layout。本 fixer 把"看着像 frontmatter 的 body"还原成正确分隔。
 *
 * 算法:把文本按 `^---$` 行切成 segments,扫每对相邻 segment(k, k+1):
 *  - 如果**两者都是 yaml-only + 含 layout**(即两个相邻 fm-like 段),说明 LLM 把
 *    本来该是 slide A 的 body(空)+ slide B 的 fm 写成了"slide A fm 直接接 slide B fm"
 *  - 在 segment k+1 起始处插入 `---`,把它"提升"成独立 slide 的 fm
 *
 * 这样对位法只在"相邻两 fm-like"才触发,避免误伤合法 trailing slide(它前一段
 * 是真 markdown body,不会触发判定)。
 */

/**
 * body 是否像被吞的 frontmatter:每行都是 `key: value` 形态 + 至少一行 key 是 `layout`。
 * `layout` 是最强信号——这是 Slidev frontmatter 的核心字段,普通 markdown body
 * 几乎不会刚好整段连续 `key: value` 且包含 `layout: xxx` 行,误判面极小。
 */
export function looksLikeOrphanedFrontmatter(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed) return false

  const lines = trimmed.split('\n')
  let hasLayoutKey = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // 必须是 `key: value` 形态(key = ASCII letter/digit/_/-,起头是字母或下划线)
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*\S/)
    if (!m) return false
    if (m[1] === 'layout') hasLayoutKey = true
  }
  return hasLayoutKey
}

export interface FixResult {
  fixed: string
  /** 插入的 `---` 分隔符数量(0 = 原文已规范,无改动) */
  fixCount: number
}

/**
 * 主入口。安全护栏:
 * - separator 数 < 2:不是 Slidev 格式,直接返原文
 * - 任意一处 yaml-only segment 检测失败:不修该处(避免误改)
 * - 修复完后输出可被 Slidev 正确切片
 */
export function fixOrphanedFrontmatter(content: string): FixResult {
  const text = content.replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  // 找所有 `^---$` 行的索引(忽略行尾空白)
  const sepIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') sepIdx.push(i)
  }

  if (sepIdx.length < 3) return { fixed: content, fixCount: 0 }

  // segment k(k ≥ 1):介于 sepIdx[k-1] 与 sepIdx[k] 之间的内容
  // 扫每对相邻 segment(k, k+1):如果两者都是 yaml-only + 含 layout,则在
  // segment k+1 起始处插入 `---`,把它从"body 位"挤到下一个"fm 位"。
  function isFmLike(segIdx: number): boolean {
    const start = sepIdx[segIdx - 1]! + 1
    const end = sepIdx[segIdx]!
    if (start >= end) return false
    return looksLikeOrphanedFrontmatter(lines.slice(start, end).join('\n'))
  }

  const insertBefore: number[] = []
  for (let k = 1; k + 1 < sepIdx.length; k++) {
    if (isFmLike(k) && isFmLike(k + 1)) {
      // segment k+1 是孤立 fm,在它起始行插入额外 ---
      insertBefore.push(sepIdx[k]! + 1)
    }
  }

  if (insertBefore.length === 0) return { fixed: content, fixCount: 0 }

  // 从后往前 splice,避免索引漂移
  const out = [...lines]
  for (let i = insertBefore.length - 1; i >= 0; i--) {
    out.splice(insertBefore[i]!, 0, '---')
  }

  return { fixed: out.join('\n'), fixCount: insertBefore.length }
}
