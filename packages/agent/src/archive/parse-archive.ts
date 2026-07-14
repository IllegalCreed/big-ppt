/** 解包并校验 `.lumideck`，把 v1/v2 统一成 v2-shaped canonical manifest。 */
import JSZip from 'jszip'
import {
  SUPPORTED_SCHEMA_VERSIONS,
  type ArchiveAssetEntryV1,
  type ArchiveAssetEntryV2,
  type ArchiveAssetPurpose,
  type ArchiveManifestV1,
  type ArchiveManifestV2,
  type ArchiveStylePalettePolicy,
  type ArchiveStyleSource,
  type NormalizedArchiveManifest,
} from '@big-ppt/shared'
import { ArchiveError } from './errors.js'
import { mimeToExt } from './mime-ext.js'

export interface ParsedArchive {
  manifest: NormalizedArchiveManifest
  content: string
  assets: Map<string, Buffer>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PURPOSES = new Set<ArchiveAssetPurpose>([
  'anchor',
  'style-preset-anchor',
  'mood-board-candidate',
  'mood-board-discarded',
])
const STYLE_SOURCES = new Set<ArchiveStyleSource>(['system', 'user', 'explore'])
const PALETTE_POLICIES = new Set<ArchiveStylePalettePolicy>(['template', 'reference'])

function invalid(message: string): never {
  throw new ArchiveError('manifest-invalid', message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeV2Asset(entry: ArchiveAssetEntryV2): ArchiveAssetEntryV2 {
  if (entry.style !== null && (typeof entry.style !== 'string' || entry.style.length > 64)) {
    invalid(`asset ${entry.id} style 必须为 null 或不超过 64 字符`)
  }
  if (entry.purpose !== null && !PURPOSES.has(entry.purpose)) {
    invalid(`asset ${entry.id} purpose 非法`)
  }
  if (entry.styleSource !== null && !STYLE_SOURCES.has(entry.styleSource)) {
    invalid(`asset ${entry.id} styleSource 非法`)
  }
  if (
    entry.styleSourceId !== null &&
    (typeof entry.styleSourceId !== 'string' || entry.styleSourceId.length > 64)
  ) {
    invalid(`asset ${entry.id} styleSourceId 非法`)
  }
  if (entry.stylePalettePolicy !== null && !PALETTE_POLICIES.has(entry.stylePalettePolicy)) {
    invalid(`asset ${entry.id} stylePalettePolicy 非法`)
  }
  if (entry.styleSource !== null && (!entry.styleSourceId || !entry.stylePalettePolicy)) {
    invalid(`asset ${entry.id} 的 ${entry.styleSource} 来源缺少 sourceId 或 palettePolicy`)
  }
  if (
    entry.styleSource === null &&
    (entry.styleSourceId !== null || entry.stylePalettePolicy !== null)
  ) {
    invalid(`asset ${entry.id} 没有 styleSource 却携带来源元数据`)
  }
  if (entry.styleSource === 'explore' && !UUID_RE.test(entry.styleSourceId!)) {
    invalid(`asset ${entry.id} explore styleSourceId 必须是合法 uuid`)
  }
  if (entry.styleSource === 'user' && !UUID_RE.test(entry.styleSourceId!)) {
    invalid(`asset ${entry.id} user styleSourceId 必须是合法 uuid`)
  }
  if (
    entry.stylePrompt !== null &&
    (typeof entry.stylePrompt !== 'string' || entry.stylePrompt.length > 8_000)
  ) {
    invalid(`asset ${entry.id} stylePrompt 非法`)
  }
  for (const [field, value] of [
    ['imageWidth', entry.imageWidth],
    ['imageHeight', entry.imageHeight],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      invalid(`asset ${entry.id} ${field} 必须是 null 或正整数`)
    }
  }
  return {
    ...entry,
    style: entry.style ?? null,
    purpose: entry.purpose ?? null,
    styleSource: entry.styleSource ?? null,
    styleSourceId: entry.styleSourceId ?? null,
    stylePalettePolicy: entry.stylePalettePolicy ?? null,
    stylePrompt: entry.stylePrompt ?? null,
    imageWidth: entry.imageWidth ?? null,
    imageHeight: entry.imageHeight ?? null,
  }
}

function normalizeManifest(raw: ArchiveManifestV1 | ArchiveManifestV2): NormalizedArchiveManifest {
  if (raw.schemaVersion === 1) {
    return {
      ...raw,
      schemaVersion: 2,
      deck: {
        ...raw.deck,
        anchorAssetId: null,
        anchorSkipped: false,
      },
      assets: raw.assets.map((entry: ArchiveAssetEntryV1) => ({
        ...entry,
        style: null,
        purpose: null,
        styleSource: null,
        styleSourceId: null,
        stylePalettePolicy: null,
        stylePrompt: null,
        imageWidth: null,
        imageHeight: null,
      })),
    }
  }

  if (typeof raw.deck.anchorSkipped !== 'boolean') {
    invalid('manifest.json deck.anchorSkipped 必须是 boolean')
  }
  if (
    raw.deck.anchorAssetId !== null &&
    (typeof raw.deck.anchorAssetId !== 'string' || !UUID_RE.test(raw.deck.anchorAssetId))
  ) {
    invalid('manifest.json deck.anchorAssetId 必须是 null 或合法 uuid')
  }
  const assets = raw.assets.map(normalizeV2Asset)
  if (raw.deck.anchorAssetId && !assets.some((entry) => entry.id === raw.deck.anchorAssetId)) {
    invalid('manifest.json deck.anchorAssetId 在 assets 中不存在')
  }
  return { ...raw, assets }
}

export async function parseArchive(zipBuffer: Buffer): Promise<ParsedArchive> {
  if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
    throw new ArchiveError('not-a-zip', '数据包损坏: 不是合法 zip 文件')
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBuffer)
  } catch (error) {
    throw new ArchiveError('not-a-zip', '数据包损坏: 无法解析 zip', error)
  }

  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new ArchiveError('manifest-missing', '数据包缺少 manifest.json')

  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await manifestFile.async('string'))
  } catch (error) {
    throw new ArchiveError('manifest-invalid', '数据包 manifest.json 不是合法 JSON', error)
  }
  if (!manifestRaw || typeof manifestRaw !== 'object') invalid('manifest.json 不是 object')

  const raw = manifestRaw as ArchiveManifestV1 | ArchiveManifestV2
  if (
    typeof raw.schemaVersion !== 'number' ||
    !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(raw.schemaVersion)
  ) {
    throw new ArchiveError(
      'schema-unsupported',
      `数据包版本 ${raw.schemaVersion} 不被当前 Lumideck 支持,请用新版重新导出`,
    )
  }
  if (
    !raw.deck ||
    typeof raw.deck.title !== 'string' ||
    typeof raw.deck.templateId !== 'string' ||
    !Number.isInteger(raw.deck.originalDeckId) ||
    raw.deck.originalDeckId <= 0 ||
    typeof raw.deck.createdAt !== 'string' ||
    Number.isNaN(Date.parse(raw.deck.createdAt)) ||
    typeof raw.deck.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(raw.deck.updatedAt)) ||
    typeof raw.lumideckVersion !== 'string' ||
    typeof raw.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(raw.exportedAt))
  ) {
    invalid('manifest.json deck 字段不完整')
  }
  if (!Array.isArray(raw.assets)) invalid('manifest.json assets 字段非数组')

  const contentFile = zip.file('content.md')
  if (!contentFile) throw new ArchiveError('content-missing', '数据包缺少 content.md')
  const content = await contentFile.async('string')

  // 基础 asset 校验先做，之后再 normalize v2 扩展字段。
  const assetsMap = new Map<string, Buffer>()
  const seenAssetIds = new Set<string>()
  for (const unknownEntry of raw.assets) {
    if (!isPlainObject(unknownEntry)) invalid('manifest.json assets 每一项都必须是对象')
    const entry = unknownEntry as unknown as ArchiveAssetEntryV1
    if (typeof entry.id !== 'string' || !UUID_RE.test(entry.id)) {
      invalid(`asset id 不是合法 uuid: ${entry.id}`)
    }
    if (seenAssetIds.has(entry.id)) invalid(`asset id 重复: ${entry.id}`)
    seenAssetIds.add(entry.id)
    if (
      typeof entry.mimeType !== 'string' ||
      !Number.isInteger(entry.bytesSize) ||
      entry.bytesSize < 0 ||
      (entry.prompt !== null && typeof entry.prompt !== 'string') ||
      (entry.model !== null && typeof entry.model !== 'string')
    ) {
      invalid(`asset ${entry.id} 元数据缺字段`)
    }
    const filename = `assets/${entry.id}.${mimeToExt(entry.mimeType)}`
    const file = zip.file(filename)
    if (!file) {
      throw new ArchiveError('asset-missing', `数据包损坏: asset ${entry.id} 在包内未找到`)
    }
    const buf = Buffer.from(await file.async('arraybuffer'))
    if (buf.length !== entry.bytesSize) {
      throw new ArchiveError(
        'asset-corrupt',
        `asset ${entry.id} 实际 size 与 manifest 声明不匹配(${buf.length} vs ${entry.bytesSize})`,
      )
    }
    assetsMap.set(entry.id, buf)
  }

  const manifest = normalizeManifest(raw)
  return { manifest, content, assets: assetsMap }
}
