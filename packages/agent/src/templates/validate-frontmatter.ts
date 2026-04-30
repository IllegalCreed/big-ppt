/**
 * 工具层 frontmatter 必填字段校验。
 *
 * 设计动机:LLM 写 layout 时常漏必填字段(尤其 *-image-content 漏 heading 导致顶部 header
 * 留白丑陋,*-section-title 漏 chapterNumber/chapterTitle 整页空白等)。早先工具层只做
 * 字符串校验不查 manifest,字段缺失会直接落盘。本模块根据 layout 推导 templateId,查
 * manifest 拿 required 字段集,告诉调用方哪些必填字段缺了。
 *
 * 推导策略:跟 generate-slide-image 的 deriveImageLayoutName 对称——layout 名形如
 *   "<prefix>-<role>" (e.g. "beitou-image-content" / "jingyeda-cover"),
 * 取第一段当 templateId 前缀拼 "<prefix>-standard"。当前项目仅 -standard 后缀模板,
 * 加新后缀模板时本函数需要扩展。
 */
import { getManifest } from './registry.js'

export interface FrontmatterValidationError {
  layout: string
  missingFields: string[]
  /** 给 LLM 看的友好错误文本(中文) */
  message: string
}

/**
 * 根据 layout 名 derive templateId,查 manifest required 字段集,与 frontmatter 比对。
 *
 * @returns null 表示通过 / 校验不适用(未知 layout / 未知 template);
 *          否则返回 missing 字段列表 + 友好错误文本。
 */
export function validateFrontmatterAgainstManifest(
  layout: string,
  frontmatter: Record<string, unknown> | undefined,
): FrontmatterValidationError | null {
  const prefix = layout.split('-')[0]
  if (!prefix) return null
  const templateId = `${prefix}-standard`
  const manifest = getManifest(templateId)
  if (!manifest) return null
  const layoutDef = manifest.layouts.find((l) => l.name === layout)
  if (!layoutDef) return null

  const required = layoutDef.frontmatterSchema?.required ?? []
  if (required.length === 0) return null

  const missing: string[] = []
  for (const field of required) {
    const v = frontmatter?.[field]
    if (
      v === undefined ||
      v === null ||
      (typeof v === 'string' && v.trim() === '')
    ) {
      missing.push(field)
    }
  }
  if (missing.length === 0) return null

  return {
    layout,
    missingFields: missing,
    message: `layout \`${layout}\` 必填字段缺失:${missing.map((f) => `\`${f}\``).join(', ')}。请在 frontmatter 提供这些字段(参考 manifest 的 frontmatterSchema)。`,
  }
}
