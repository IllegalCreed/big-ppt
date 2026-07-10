/**
 * 模板资源路径 helper。creator 可部署在非根 base 下，SFC 模板中的字符串路径不会
 * 自动被 Vite rewrite，因此统一用 `import.meta.env.BASE_URL` 拼接。
 */

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')

/** 把 / 开头的绝对路径加应用 base 前缀；外链 / 空 / 相对路径原样返回。 */
export function templateAsset(path: string): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  if (!path.startsWith('/')) return path
  return `${BASE}${path}`
}
