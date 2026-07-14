import fs from 'node:fs'
import path from 'node:path'
import {
  validateImageStyleManifest,
  type ImageStyleManifest,
  type ImageStylePresetSummary,
} from '@big-ppt/shared'
import { getPaths } from '../workspace.js'

export type ImageStyleMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface LoadedImageStyleAsset {
  /** Server-internal only. Never serialize LoadedImageStyle directly to a client. */
  absPath: string
  mimeType: ImageStyleMimeType
  width: number
  height: number
}

export interface LoadedImageStyle {
  manifest: ImageStyleManifest
  /** Server-internal package directory. */
  dir: string
  preview: LoadedImageStyleAsset
  references: LoadedImageStyleAsset[]
}

export interface ReadImageStyleAsset {
  data: Buffer
  mimeType: ImageStyleMimeType
  width: number
  height: number
}

interface InspectedImage {
  format: 'png' | 'jpeg' | 'webp'
  mimeType: ImageStyleMimeType
  width: number
  height: number
}

let cached: Map<string, LoadedImageStyle> | null = null

export function __resetImageStyleRegistryForTesting(): void {
  cached = null
}

function parsePng(data: Buffer): InspectedImage | null {
  if (data.length < 33) return null
  if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) {
    return null
  }
  // The first PNG chunk must be the 13-byte IHDR chunk.
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width === 0 || height === 0) return null
  return { format: 'png', mimeType: 'image/png', width, height }
}

function parseJpeg(data: Buffer): InspectedImage | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }

    // JPEG permits fill bytes between markers.
    while (offset < data.length && data[offset] === 0xff) offset += 1
    if (offset >= data.length) return null
    const marker = data[offset]!
    offset += 1

    // Standalone markers have no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > data.length) return null
    const segmentLength = data.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > data.length) return null

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      if (segmentLength < 7) return null
      const height = data.readUInt16BE(offset + 3)
      const width = data.readUInt16BE(offset + 5)
      if (width === 0 || height === 0) return null
      return { format: 'jpeg', mimeType: 'image/jpeg', width, height }
    }
    offset += segmentLength
  }
  return null
}

function parseWebp(data: Buffer): InspectedImage | null {
  if (
    data.length < 30 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null
  }

  const chunk = data.toString('ascii', 12, 16)
  let width = 0
  let height = 0
  if (chunk === 'VP8X') {
    width = 1 + data.readUIntLE(24, 3)
    height = 1 + data.readUIntLE(27, 3)
  } else if (chunk === 'VP8L') {
    if (data.length < 25 || data[20] !== 0x2f) return null
    const b1 = data[21]!
    const b2 = data[22]!
    const b3 = data[23]!
    const b4 = data[24]!
    width = 1 + (((b2 & 0x3f) << 8) | b1)
    height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
  } else if (chunk === 'VP8 ') {
    if (data.length < 30 || data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) {
      return null
    }
    width = data.readUInt16LE(26) & 0x3fff
    height = data.readUInt16LE(28) & 0x3fff
  } else {
    return null
  }

  if (width === 0 || height === 0) return null
  return { format: 'webp', mimeType: 'image/webp', width, height }
}

function inspectImage(data: Buffer): InspectedImage | null {
  return parsePng(data) ?? parseJpeg(data) ?? parseWebp(data)
}

function expectedFormatForFilename(filename: string): InspectedImage['format'] | null {
  const extension = path.extname(filename).toLowerCase()
  if (extension === '.png') return 'png'
  if (extension === '.jpg' || extension === '.jpeg') return 'jpeg'
  if (extension === '.webp') return 'webp'
  return null
}

function loadAndValidateAsset(
  styleDir: string,
  filename: string,
  label: string,
  expectedDimensions?: { width: number; height: number },
): LoadedImageStyleAsset {
  const resolvedDir = path.resolve(styleDir)
  const candidate = path.resolve(styleDir, filename)
  if (path.dirname(candidate) !== resolvedDir) {
    throw new Error(`[image-styles] ${label} 路径越界: ${filename}`)
  }

  let stat: fs.Stats
  try {
    stat = fs.lstatSync(candidate)
  } catch {
    throw new Error(`[image-styles] ${label} 文件不存在: ${candidate}`)
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`[image-styles] ${label} 不允许使用符号链接: ${candidate}`)
  }
  if (!stat.isFile()) {
    throw new Error(`[image-styles] ${label} 必须是普通文件: ${candidate}`)
  }

  const realDir = fs.realpathSync(styleDir)
  const realFile = fs.realpathSync(candidate)
  if (path.dirname(realFile) !== realDir) {
    throw new Error(`[image-styles] ${label} realpath 越界: ${candidate}`)
  }

  const data = fs.readFileSync(realFile)
  const inspected = inspectImage(data)
  if (!inspected) {
    throw new Error(`[image-styles] ${label} 不是有效的 PNG/JPEG/WebP 图片: ${candidate}`)
  }
  const expectedFormat = expectedFormatForFilename(filename)
  if (inspected.format !== expectedFormat) {
    throw new Error(
      `[image-styles] ${label} 扩展名与 magic bytes 不一致: ${filename} 实际为 ${inspected.format}`,
    )
  }
  if (
    expectedDimensions &&
    (inspected.width !== expectedDimensions.width || inspected.height !== expectedDimensions.height)
  ) {
    throw new Error(
      `[image-styles] ${label} 尺寸不符: manifest=${expectedDimensions.width}×${expectedDimensions.height}, ` +
        `实际=${inspected.width}×${inspected.height}`,
    )
  }

  return {
    absPath: realFile,
    mimeType: inspected.mimeType,
    width: inspected.width,
    height: inspected.height,
  }
}

function loadAll(): Map<string, LoadedImageStyle> {
  const { imageStylesRoot } = getPaths()
  if (!fs.existsSync(imageStylesRoot)) {
    throw new Error(`[image-styles] imageStylesRoot 不存在: ${imageStylesRoot}`)
  }

  const result = new Map<string, LoadedImageStyle>()
  const entries = fs
    .readdirSync(imageStylesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const dir = path.join(imageStylesRoot, entry.name)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    if (fs.lstatSync(manifestPath).isSymbolicLink()) {
      throw new Error(`[image-styles] manifest 不允许使用符号链接: ${manifestPath}`)
    }

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(`[image-styles] 解析 ${manifestPath} 失败: ${(error as Error).message}`)
    }

    const validated = validateImageStyleManifest(raw)
    if (!validated.ok) {
      throw new Error(
        `[image-styles] ${manifestPath} manifest 校验失败:\n  - ${validated.errors.join('\n  - ')}`,
      )
    }
    const manifest = validated.value
    if (manifest.id !== entry.name) {
      throw new Error(
        `[image-styles] ${manifestPath} manifest.id (${manifest.id}) 与目录名 (${entry.name}) 不一致`,
      )
    }
    if (result.has(manifest.id)) {
      throw new Error(`[image-styles] 风格 id 重复: ${manifest.id}`)
    }

    const preview = loadAndValidateAsset(dir, manifest.previewImage, `${manifest.id}.previewImage`)
    const references = manifest.references.map((reference, index) =>
      loadAndValidateAsset(dir, reference.file, `${manifest.id}.references[${index}]`, {
        width: reference.width,
        height: reference.height,
      }),
    )
    result.set(manifest.id, { manifest, dir: fs.realpathSync(dir), preview, references })
  }

  if (result.size === 0) {
    throw new Error(`[image-styles] ${imageStylesRoot} 下未发现任何合法系统风格`)
  }
  return result
}

function getCache(): Map<string, LoadedImageStyle> {
  if (!cached) cached = loadAll()
  return cached
}

export function listImageStyles(): LoadedImageStyle[] {
  return [...getCache().values()].sort(
    (a, b) => a.manifest.order - b.manifest.order || a.manifest.id.localeCompare(b.manifest.id),
  )
}

export function getImageStyle(id: string): LoadedImageStyle | null {
  return getCache().get(id) ?? null
}

export function listImageStylePresetSummaries(): ImageStylePresetSummary[] {
  return listImageStyles().map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    tags: [...manifest.tags],
    order: manifest.order,
    palettePolicy: manifest.palettePolicy,
    previewUrl: `/api/image-style-presets/${encodeURIComponent(manifest.id)}/preview`,
  }))
}

function readAsset(asset: LoadedImageStyleAsset): ReadImageStyleAsset {
  const data = fs.readFileSync(asset.absPath)
  const inspected = inspectImage(data)
  if (
    !inspected ||
    inspected.mimeType !== asset.mimeType ||
    inspected.width !== asset.width ||
    inspected.height !== asset.height
  ) {
    throw new Error(`[image-styles] 图片在 registry 加载后发生变化: ${asset.absPath}`)
  }
  return { data, mimeType: asset.mimeType, width: asset.width, height: asset.height }
}

export function readImageStylePreview(id: string): ReadImageStyleAsset | null {
  const style = getImageStyle(id)
  return style ? readAsset(style.preview) : null
}

export function readImageStyleReference(
  id: string,
  referenceIndex: number,
): ReadImageStyleAsset | null {
  const style = getImageStyle(id)
  const reference = style?.references[referenceIndex]
  return reference ? readAsset(reference) : null
}

/** Startup or deployment self-check. Any malformed package aborts loading. */
export function verifyImageStylesOrThrow(): void {
  getCache()
}
