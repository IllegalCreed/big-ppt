/**
 * Phase 17 system image-style package manifest.
 *
 * Every package lives at `packages/slidev/image-styles/<id>/manifest.json`.
 * Prompt text remains server-side; clients only receive `ImageStylePresetSummary`.
 */

export const IMAGE_STYLE_MANIFEST_SCHEMA_VERSION = 1 as const

export const IMAGE_STYLE_PALETTE_POLICIES = ['template', 'reference'] as const
export type ImageStylePalettePolicy = (typeof IMAGE_STYLE_PALETTE_POLICIES)[number]

export interface ImageStyleReferenceManifest {
  /** File colocated with manifest.json. Nested/absolute paths are forbidden. */
  file: string
  /** Expected intrinsic dimensions. The registry verifies these against the bytes. */
  width: number
  height: number
}

export interface ImageStyleManifest {
  schemaVersion: typeof IMAGE_STYLE_MANIFEST_SCHEMA_VERSION
  /** Kebab-case package id; must equal the containing directory name. */
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  /** Stable display order. Ties are resolved by id. */
  order: number
  /** Private generation instruction. Never expose this in a public DTO. */
  stylePrompt: string
  palettePolicy: ImageStylePalettePolicy
  /** Lightweight image shown in the picker, colocated with this manifest. */
  previewImage: string
  /** One or more generation references, colocated with this manifest. */
  references: ImageStyleReferenceManifest[]
}

/** Public picker DTO. Intentionally excludes stylePrompt and all filesystem paths. */
export interface ImageStylePresetSummary {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  order: number
  palettePolicy: ImageStylePalettePolicy
  previewUrl: string
}

export type ValidateImageStyleManifestResult =
  | { ok: true; value: ImageStyleManifest }
  | { ok: false; errors: string[] }

const ROOT_FIELDS = new Set([
  'schemaVersion',
  'id',
  'name',
  'description',
  'category',
  'tags',
  'order',
  'stylePrompt',
  'palettePolicy',
  'previewImage',
  'references',
])
const REFERENCE_FIELDS = new Set(['file', 'width', 'height'])
const SAFE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SAFE_ASSET_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp)$/i

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTrimmedNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  )
}

function reportUnknownFields(
  objectPath: string,
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  errors: string[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errors.push(`${objectPath} 含未知字段: ${key}`)
  }
}

function validateAssetFilename(
  fieldPath: string,
  value: unknown,
  errors: string[],
): value is string {
  if (!isTrimmedNonEmptyString(value, 160)) {
    errors.push(`${fieldPath} 必须是 1-160 字符的非空文件名`)
    return false
  }
  if (!SAFE_ASSET_FILE_RE.test(value)) {
    errors.push(`${fieldPath} 必须是同目录的 png/jpg/jpeg/webp 安全文件名`)
    return false
  }
  return true
}

function validatePositiveDimension(fieldPath: string, value: unknown, errors: string[]): void {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 16_384) {
    errors.push(`${fieldPath} 必须是 1-16384 的整数`)
  }
}

/** Pure structural validation. Filesystem and image-byte checks belong to the agent registry. */
export function validateImageStyleManifest(raw: unknown): ValidateImageStyleManifestResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest 根必须是对象'] }
  }

  const errors: string[] = []
  reportUnknownFields('manifest', raw, ROOT_FIELDS, errors)

  if (raw.schemaVersion !== IMAGE_STYLE_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须是 ${IMAGE_STYLE_MANIFEST_SCHEMA_VERSION}`)
  }
  if (!isTrimmedNonEmptyString(raw.id, 64) || !SAFE_ID_RE.test(raw.id)) {
    errors.push('id 必须是 1-64 字符的 kebab-case 标识符')
  }
  if (!isTrimmedNonEmptyString(raw.name, 80)) {
    errors.push('name 必须是 1-80 字符的非空字符串')
  }
  if (!isTrimmedNonEmptyString(raw.description, 500)) {
    errors.push('description 必须是 1-500 字符的非空字符串')
  }
  if (!isTrimmedNonEmptyString(raw.category, 64) || !SAFE_ID_RE.test(raw.category)) {
    errors.push('category 必须是 1-64 字符的 kebab-case 标识符')
  }

  if (
    !Array.isArray(raw.tags) ||
    raw.tags.length === 0 ||
    raw.tags.length > 12 ||
    raw.tags.some((tag) => !isTrimmedNonEmptyString(tag, 40))
  ) {
    errors.push('tags 必须是含 1-12 个非空字符串的数组（每项最多 40 字符）')
  } else if (new Set(raw.tags).size !== raw.tags.length) {
    errors.push('tags 不能包含重复项')
  }

  if (!Number.isInteger(raw.order) || (raw.order as number) < 0) {
    errors.push('order 必须是非负整数')
  }
  if (!isTrimmedNonEmptyString(raw.stylePrompt, 8_000)) {
    errors.push('stylePrompt 必须是 1-8000 字符的非空字符串')
  }
  if (
    typeof raw.palettePolicy !== 'string' ||
    !(IMAGE_STYLE_PALETTE_POLICIES as readonly string[]).includes(raw.palettePolicy)
  ) {
    errors.push(`palettePolicy 必须是 ${IMAGE_STYLE_PALETTE_POLICIES.join('|')} 之一`)
  }

  validateAssetFilename('previewImage', raw.previewImage, errors)

  if (!Array.isArray(raw.references) || raw.references.length === 0) {
    errors.push('references 必须是非空数组')
  } else if (raw.references.length > 8) {
    errors.push('references 最多包含 8 项')
  } else {
    const files = new Set<string>()
    raw.references.forEach((reference, index) => {
      const fieldPath = `references[${index}]`
      if (!isPlainObject(reference)) {
        errors.push(`${fieldPath} 必须是对象`)
        return
      }
      reportUnknownFields(fieldPath, reference, REFERENCE_FIELDS, errors)
      if (validateAssetFilename(`${fieldPath}.file`, reference.file, errors)) {
        if (files.has(reference.file)) {
          errors.push(`${fieldPath}.file 与前面重复: ${reference.file}`)
        }
        files.add(reference.file)
      }
      validatePositiveDimension(`${fieldPath}.width`, reference.width, errors)
      validatePositiveDimension(`${fieldPath}.height`, reference.height, errors)
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: raw as unknown as ImageStyleManifest }
}
