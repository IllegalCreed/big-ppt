/**
 * Template Manifest：单个模板的元数据规范（Phase 6A）。
 *
 * 每个模板目录 `<templatesRoot>/<id>/manifest.json` 必须符合此结构。
 * agent 启动自检时会对所有已声明模板做一次 `validateManifest`。
 */

export interface TemplateManifestLayout {
  /** frontmatter 里 `layout: <name>` 的取值 */
  name: string
  /** 一句话描述，供 prompt 拼装与前端展示使用 */
  description: string
  /** JSON Schema（简化版，只用 type / required / properties 子集），描述本 layout 允许的 frontmatter 字段 */
  frontmatterSchema: FrontmatterSchema
  /** 正文写法指引，供 prompt 拼装插入到 layout 段（可选） */
  bodyGuidance?: string
}

export interface FrontmatterSchema {
  type: 'object'
  required?: string[]
  properties: Record<string, FrontmatterFieldSchema>
}

export interface FrontmatterFieldSchema {
  /** 字段类型（本项目目前只用 string / number / array / object） */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  /** 一句话字段描述 */
  description: string
  /** array 字段的 item 类型，简化版 */
  items?: { type: 'string' | 'number' | 'boolean' | 'object' }
}

export interface TemplateManifest {
  /** 目录名，必须与 `<templatesRoot>/<id>/` 的 `<id>` 一致 */
  id: string
  /** 显示名，如 "公司标准模板" */
  name: string
  /** 一句话介绍 */
  description: string
  /** 相对模板目录的缩略图路径，如 `cover.png`；可选，新模板未生成缩略图前可不填（见 Phase 7C） */
  thumbnail?: string
  /** picker 卡片副标题（<= 12 字），如"商务正式 · 暖色调"；可选，缺省时 picker 不显示副标题 */
  tagline?: string
  /** 品牌 logo 资源集；路径同样相对模板目录 */
  logos: {
    primary: string
    mark?: string
    text?: string
  }
  /** 该模板在 system prompt 里的"设计定位"一段话 */
  promptPersona: string
  /** 相对模板目录的 starter.md 路径，新建 deck 时作为 version 1 加载 */
  starterSlidesPath: string
  /** 支持的 layout 清单 */
  layouts: TemplateManifestLayout[]
}

/** 校验结果。`ok: true` 时 `value` 必定为合法 manifest。 */
export type ValidateManifestResult =
  | { ok: true; value: TemplateManifest }
  | { ok: false; errors: string[] }

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const
const ITEM_TYPES = ['string', 'number', 'boolean', 'object'] as const

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function validateFieldSchema(path: string, raw: unknown, errors: string[]): void {
  if (!isPlainObject(raw)) {
    errors.push(`${path} 必须是对象`)
    return
  }
  const { type, description, items } = raw
  if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) {
    errors.push(`${path}.type 必须是 ${FIELD_TYPES.join('|')} 之一`)
  }
  if (!isNonEmptyString(description)) {
    errors.push(`${path}.description 必填（非空字符串）`)
  }
  if (type === 'array') {
    if (!isPlainObject(items)) {
      errors.push(`${path}.items 必须是对象（array 字段必填）`)
    } else if (
      typeof items.type !== 'string' ||
      !(ITEM_TYPES as readonly string[]).includes(items.type)
    ) {
      errors.push(`${path}.items.type 必须是 ${ITEM_TYPES.join('|')} 之一`)
    }
  }
}

function validateLayout(path: string, raw: unknown, errors: string[]): void {
  if (!isPlainObject(raw)) {
    errors.push(`${path} 必须是对象`)
    return
  }
  if (!isNonEmptyString(raw.name)) errors.push(`${path}.name 必填`)
  if (!isNonEmptyString(raw.description)) errors.push(`${path}.description 必填`)
  if (raw.bodyGuidance !== undefined && typeof raw.bodyGuidance !== 'string') {
    errors.push(`${path}.bodyGuidance 若存在必须为字符串`)
  }
  const schema = raw.frontmatterSchema
  if (!isPlainObject(schema)) {
    errors.push(`${path}.frontmatterSchema 必须是对象`)
    return
  }
  if (schema.type !== 'object') {
    errors.push(`${path}.frontmatterSchema.type 必须是 "object"`)
  }
  if (schema.required !== undefined) {
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((v) => typeof v !== 'string')
    ) {
      errors.push(`${path}.frontmatterSchema.required 若存在必须是字符串数组`)
    }
  }
  if (!isPlainObject(schema.properties)) {
    errors.push(`${path}.frontmatterSchema.properties 必须是对象`)
    return
  }
  for (const [fieldName, fieldRaw] of Object.entries(schema.properties)) {
    validateFieldSchema(
      `${path}.frontmatterSchema.properties.${fieldName}`,
      fieldRaw,
      errors,
    )
  }
}

/**
 * 校验任意对象是否为合法 TemplateManifest。
 * 返回聚合错误数组，不抛异常。agent 启动自检时把错误消息直接抛给 stderr。
 */
export function validateManifest(raw: unknown): ValidateManifestResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest 根必须是对象'] }
  }

  if (!isNonEmptyString(raw.id)) errors.push('id 必填（非空字符串）')
  if (!isNonEmptyString(raw.name)) errors.push('name 必填')
  if (!isNonEmptyString(raw.description)) errors.push('description 必填')
  if (raw.thumbnail !== undefined && typeof raw.thumbnail !== 'string') {
    errors.push('thumbnail 若存在必须是字符串')
  }
  if (raw.tagline !== undefined && typeof raw.tagline !== 'string') {
    errors.push('tagline 若存在必须是字符串')
  }
  if (!isNonEmptyString(raw.promptPersona)) errors.push('promptPersona 必填')
  if (!isNonEmptyString(raw.starterSlidesPath)) {
    errors.push('starterSlidesPath 必填')
  } else if (!raw.starterSlidesPath.endsWith('.md')) {
    errors.push('starterSlidesPath 必须以 .md 结尾')
  }

  const logos = raw.logos
  if (!isPlainObject(logos)) {
    errors.push('logos 必须是对象')
  } else {
    if (!isNonEmptyString(logos.primary)) errors.push('logos.primary 必填')
    if (logos.mark !== undefined && typeof logos.mark !== 'string') {
      errors.push('logos.mark 若存在必须是字符串')
    }
    if (logos.text !== undefined && typeof logos.text !== 'string') {
      errors.push('logos.text 若存在必须是字符串')
    }
  }

  const layouts = raw.layouts
  if (!Array.isArray(layouts) || layouts.length === 0) {
    errors.push('layouts 必须是非空数组')
  } else {
    const seen = new Set<string>()
    layouts.forEach((layout, idx) => {
      validateLayout(`layouts[${idx}]`, layout, errors)
      if (isPlainObject(layout) && isNonEmptyString(layout.name)) {
        if (seen.has(layout.name)) {
          errors.push(`layouts[${idx}].name 与前面重复: ${layout.name}`)
        }
        seen.add(layout.name)
      }
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: raw as unknown as TemplateManifest }
}
