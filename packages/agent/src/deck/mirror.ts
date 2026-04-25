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

/**
 * Phase 7D fix（theme 兜底）：保证首段 frontmatter 的 `theme` 字段是合法 slidev 主题。
 *
 * 起因：rewriteForTemplate 调真 LLM 时，模型偶尔把"模板 id"（jingyeda-standard）误写到
 * `theme:` 字段。slidev 启动时按这个值找 npm 主题包（@slidev/theme-jingyeda-standard），
 * 找不到就 cli 进程 crash。turbo dev 是 persistent，子进程 crash 不会自动重启 → :3031
 * 死掉用户得手动 pnpm dev。
 *
 * 策略：白名单检查，不在 SAFE_THEMES 内的 theme 值强制改为 'seriph'（slidev 默认主题）。
 * - 缺 theme 字段 → 不动（slidev 默认是 default 主题，不会 crash）
 * - theme 是 SAFE_THEMES 之一 → 不动
 * - theme 是其他值（疑似模板 id 漂移）→ 替换成 seriph
 */
const SAFE_THEMES = new Set(['seriph', 'default', 'apple-basic', 'bricks'])

export function ensureValidTheme(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content

  const lines = content.split('\n')
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '---\r') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return content

  let changed = false
  const next = lines.map((line, i) => {
    if (i === 0 || i >= endIdx) return line
    const m = line.match(/^(theme\s*:\s*)(.*?)\s*$/)
    if (!m) return line
    const value = m[2]!.trim().replace(/^['"]|['"]$/g, '') // 去引号
    if (SAFE_THEMES.has(value)) return line
    changed = true
    return `${m[1]}seriph`
  })
  return changed ? next.join('\n') : content
}

export function mirrorSlidesContent(content: string): void {
  const { slidesPath } = getPaths()
  const sanitized = ensureValidTheme(ensureRouterModeHash(content))
  fs.writeFileSync(slidesPath, sanitized, 'utf-8')
}
