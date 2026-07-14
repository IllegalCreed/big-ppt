/**
 * `.lumideck` 归档 manifest schema 单一来源。
 *
 * v1:deck 当前内容 + asset 基础元数据。
 * v2(Phase 17):补齐配图风格来源、asset purpose 与 deck anchor 决策。
 * import 继续接受 v1；parse 端会把缺失字段 normalize 成 null / false。
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number]
export const CURRENT_SCHEMA_VERSION = 2 as const satisfies SupportedSchemaVersion

export type ArchiveAssetPurpose =
  | 'anchor'
  | 'style-preset-anchor'
  | 'mood-board-candidate'
  | 'mood-board-discarded'

export type ArchiveStyleSource = 'system' | 'user' | 'explore'
export type ArchiveStylePalettePolicy = 'template' | 'reference'

export interface ArchiveAssetEntryV1 {
  id: string
  mimeType: string
  bytesSize: number
  prompt: string | null
  model: string | null
}

export interface ArchiveAssetEntryV2 extends ArchiveAssetEntryV1 {
  style: string | null
  purpose: ArchiveAssetPurpose | null
  styleSource: ArchiveStyleSource | null
  styleSourceId: string | null
  stylePalettePolicy: ArchiveStylePalettePolicy | null
  stylePrompt: string | null
  imageWidth: number | null
  imageHeight: number | null
}

/** 当前代码消费的统一 asset 形状；v1 parse 后缺失字段已补 null。 */
export type ArchiveAssetEntry = ArchiveAssetEntryV2

export interface ArchiveDeckMetaV1 {
  originalDeckId: number
  title: string
  templateId: string
  createdAt: string
  updatedAt: string
}

export interface ArchiveDeckMetaV2 extends ArchiveDeckMetaV1 {
  anchorAssetId: string | null
  anchorSkipped: boolean
}

/** 当前代码消费的统一 deck 形状；v1 parse 后缺失字段已补 null / false。 */
export type ArchiveDeckMeta = ArchiveDeckMetaV2

interface ArchiveManifestBase<TVersion extends SupportedSchemaVersion, TDeck, TAsset> {
  schemaVersion: TVersion
  lumideckVersion: string
  exportedAt: string
  deck: TDeck
  assets: TAsset[]
}

export type ArchiveManifestV1 = ArchiveManifestBase<1, ArchiveDeckMetaV1, ArchiveAssetEntryV1>
export type ArchiveManifestV2 = ArchiveManifestBase<2, ArchiveDeckMetaV2, ArchiveAssetEntryV2>
export type ArchiveManifest = ArchiveManifestV1 | ArchiveManifestV2

/** parseArchive 返回的 canonical v2-shaped manifest。 */
export type NormalizedArchiveManifest = ArchiveManifestV2

/** POST /api/decks/import 响应体。 */
export interface ImportArchiveResponse {
  deckId: number
  title: string
}
