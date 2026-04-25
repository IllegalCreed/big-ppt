/** 把 deck 当前版本内容落地到 packages/slidev/slides.md，供 Slidev 热重载。 */
import fs from 'node:fs'
import { getPaths } from '../workspace.js'

/**
 * Phase 7D fix（hash-mode）：把 Slidev 切到 hash 路由模式。
 *
 * 不切的话 iframe 翻页要改 src（path），导致整体 reload —— LLM 工具调用频繁触发
 * setPage 会让 iframe 闪烁 + 浏览器扩展的 postMessage 在 contentWindow null 瞬间挂错。
 *
 * 实现：写盘前检查首段 frontmatter 是否声明 routerMode；缺失则强制插一行 `routerMode: hash`。
 * - 新模板（starter.md）已带 routerMode: hash，本函数等价于 no-op
 * - 老 deck（DB 里历史 content）激活/恢复/版本回滚时被自动加，无需数据迁移
 * - 已有 routerMode 字段的 deck 保持不动（用户自定义优先）
 */
export function ensureRouterModeHash(content: string): string {
  // 只处理"以 --- 开头"的合法 frontmatter；不是的话直接返回（不做强插，避免破坏非 Slidev 文本）
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content

  // 找第一段 frontmatter 的结束 ---（必须出现在第二行之后）
  const lines = content.split('\n')
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '---\r') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return content

  const fm = lines.slice(1, endIdx)
  if (fm.some((l) => /^routerMode\s*:/.test(l))) return content // 已有，不动

  // 在 frontmatter 末尾追加一行（保持已有字段顺序）
  const next = [...lines.slice(0, endIdx), 'routerMode: hash', ...lines.slice(endIdx)]
  return next.join('\n')
}

export function mirrorSlidesContent(content: string): void {
  const { slidesPath } = getPaths()
  fs.writeFileSync(slidesPath, ensureRouterModeHash(content), 'utf-8')
}
