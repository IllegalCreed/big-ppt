/**
 * Slidev iframe 内 dev 时配了 `--base /api/slidev-preview/`，但 SFC 模板里
 * 硬编码 `<img src="/templates/...">` 不会被 vite 自动加 base 前缀（vite 仅
 * rewrite import / module URL，不动模板字符串）。
 *
 * 本 composable 提供 helper：把 / 开头的绝对路径加 base 前缀，外链 / 相对路径
 * 不动。layer-1 layout 与公共组件 ImageText 都用它。
 */

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

/** 把 / 开头的绝对路径加 Slidev base 前缀；外链 / 空 / 相对路径原样返回 */
export function templateAsset(path: string): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  if (!path.startsWith('/')) return path
  return `${BASE}${path}`
}
