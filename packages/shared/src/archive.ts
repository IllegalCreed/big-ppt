/**
 * Phase 15 归档数据包 manifest schema 单一来源。
 *
 * 升级 schemaVersion 时:append SUPPORTED_SCHEMA_VERSIONS + bump CURRENT_SCHEMA_VERSION
 * + 加版本差异表(见 plan 31 close-out 章节)。
 * 不支持自动 migration —— 不在表里的版本号 import 直接 400。
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number]
export const CURRENT_SCHEMA_VERSION: SupportedSchemaVersion = 1

export interface ArchiveAssetEntry {
  id: string             // uuid (= deck_assets.id)
  mimeType: string       // e.g. "image/png"
  bytesSize: number      // 跟 assets/<id>.<ext> 实际字节一致(parse 端会校)
  prompt: string | null  // 出图 prompt,null 表示用户嵌图
  model: string | null   // 出图模型,如 "gpt-image-1"
}

export interface ArchiveDeckMeta {
  originalDeckId: number     // 源 deck id(import 不复用,纯审计)
  title: string
  templateId: string         // 'beitou-standard' 等
  createdAt: string          // ISO 8601
  updatedAt: string          // ISO 8601
}

export interface ArchiveManifest {
  schemaVersion: SupportedSchemaVersion
  lumideckVersion: string    // 当前实例 version,如 "0.1.0";仅审计用
  exportedAt: string         // ISO 8601
  deck: ArchiveDeckMeta
  assets: ArchiveAssetEntry[]
}
