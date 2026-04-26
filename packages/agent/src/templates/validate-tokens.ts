/**
 * Phase 7.5A：模板 `--ld-*` token 规范校验。
 *
 * 公共组件（栅格 / 装饰 / 内容块）只读 `--ld-*` token；模板必须在 tokens.css 中
 * 给规范定义的 22 项 token 都赋值。本模块提供：
 *
 *   - LD_TOKEN_SPEC：22 项 token 名单（4 类）
 *   - parseLdTokens(css)：从 CSS 文本提取所有 `--ld-*` 声明名
 *   - validateTokens(css)：对照 spec 输出 missing / extra
 *   - validateManifestComponents(manifest, allowedNames)：校验 commonComponents 字段值合法
 *
 * spec 详见 packages/slidev/components/TOKENS.md。增删 token 是接口变更，要走提案。
 */

export type TokenCategory = 'colors' | 'fonts' | 'shapes' | 'shadows'

export interface LdTokenDef {
  name: string
  category: TokenCategory
  description: string
}

/** 22 项 `--ld-*` token 完整 schema —— 与 TOKENS.md 同步维护 */
export const LD_TOKEN_SPEC: readonly LdTokenDef[] = [
  // colors（9）
  { name: '--ld-color-brand-primary', category: 'colors', description: '品牌主色' },
  { name: '--ld-color-brand-primary-deep', category: 'colors', description: '主色深色变体' },
  { name: '--ld-color-brand-accent', category: 'colors', description: '辅色' },
  { name: '--ld-color-fg-primary', category: 'colors', description: '主文字色' },
  { name: '--ld-color-fg-muted', category: 'colors', description: '次要文字色' },
  { name: '--ld-color-bg-page', category: 'colors', description: '页面背景' },
  { name: '--ld-color-bg-subtle', category: 'colors', description: '浅灰填充背景' },
  { name: '--ld-color-chart-primary-bg', category: 'colors', description: '图表填充色' },
  { name: '--ld-color-chart-primary-border', category: 'colors', description: '图表边框 / 线条色' },
  // fonts（7）
  { name: '--ld-font-family-brand', category: 'fonts', description: '品牌字体' },
  { name: '--ld-font-family-ui', category: 'fonts', description: 'UI 字体（chart 文字 / 标签）' },
  { name: '--ld-font-size-h1', category: 'fonts', description: '一级标题字号' },
  { name: '--ld-font-size-h2', category: 'fonts', description: '二级标题字号' },
  { name: '--ld-font-size-body', category: 'fonts', description: '正文字号' },
  { name: '--ld-font-weight-bold', category: 'fonts', description: '粗体字重' },
  { name: '--ld-font-weight-regular', category: 'fonts', description: '常规字重' },
  // shapes（4）
  { name: '--ld-radius-sm', category: 'shapes', description: '小圆角' },
  { name: '--ld-radius-md', category: 'shapes', description: '中圆角' },
  { name: '--ld-border-width-thin', category: 'shapes', description: '细线' },
  { name: '--ld-border-width-thick', category: 'shapes', description: '强调粗线' },
  // shadows（2）
  { name: '--ld-shadow-sm', category: 'shadows', description: '浅阴影' },
  { name: '--ld-shadow-md', category: 'shadows', description: '中阴影' },
] as const

/** 提取 CSS 文本里所有 `--ld-*` 自定义属性声明的**名称**（不解析值） */
export function parseLdTokens(css: string): string[] {
  const found = new Set<string>()
  for (const match of css.matchAll(/(--ld-[a-z0-9-]+)\s*:/gi)) {
    found.add(match[1])
  }
  return Array.from(found).sort()
}

export interface TokenValidationResult {
  ok: boolean
  /** spec 要求但 css 里没声明的 token 名 */
  missing: string[]
  /** css 里声明了但不在 spec 里的 token 名（warning，不阻断） */
  extra: string[]
  /** 总数（spec / found / matched） */
  counts: { spec: number; found: number; matched: number }
}

/**
 * 校验 CSS 文本是否覆盖了 LD_TOKEN_SPEC 全部 22 项。
 *
 * - missing 非空 → ok = false（缺失阻断）
 * - extra 非空 + missing 空 → ok = true（多余只 warning）
 */
export function validateTokens(css: string): TokenValidationResult {
  const found = new Set(parseLdTokens(css))
  const specNames = new Set(LD_TOKEN_SPEC.map((t) => t.name))

  const missing: string[] = []
  for (const def of LD_TOKEN_SPEC) {
    if (!found.has(def.name)) missing.push(def.name)
  }

  const extra: string[] = []
  for (const name of found) {
    if (!specNames.has(name)) extra.push(name)
  }

  return {
    ok: missing.length === 0,
    missing,
    extra: extra.sort(),
    counts: {
      spec: specNames.size,
      found: found.size,
      matched: found.size - extra.length,
    },
  }
}

export interface ManifestLike {
  commonComponents?: unknown
}

export interface ManifestValidationResult {
  ok: boolean
  /** 字段值不在 allowedNames 中的项 */
  invalid: string[]
  /** 字段类型不对（不是 string[]）/ 其他结构错误 */
  structureError?: string
}

/**
 * 校验 manifest.commonComponents 字段：
 *
 * - 字段不存在 → ok = true（首版可以没 opt-in；7.5D 落 catalog 后再要求）
 * - 字段存在但不是 string[] → structureError + ok = false
 * - 字段存在且每项都在 allowedNames 中 → ok = true
 * - 任何一项不在 allowedNames → 该项进 invalid + ok = false
 */
export function validateManifestComponents(
  manifest: ManifestLike,
  allowedNames: readonly string[],
): ManifestValidationResult {
  if (!('commonComponents' in manifest) || manifest.commonComponents === undefined) {
    return { ok: true, invalid: [] }
  }

  const value = manifest.commonComponents
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return {
      ok: false,
      invalid: [],
      structureError: 'commonComponents 必须是 string 数组',
    }
  }

  const allowed = new Set(allowedNames)
  const invalid = value.filter((v) => !allowed.has(v))

  return {
    ok: invalid.length === 0,
    invalid,
  }
}
