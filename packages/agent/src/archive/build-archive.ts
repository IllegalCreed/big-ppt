/**
 * Phase 15 Task 31-B:把单个 deck 打包成 `.lumideck` 归档(zip + manifest)。
 *
 * 包结构:
 *   manifest.json    — ArchiveManifest(schema 在 @big-ppt/shared/archive.ts)
 *   content.md       — 当前 currentVersion.content,byte-equal
 *   assets/<id>.<ext>— deck_assets BLOB 字节,扩展名由 mimeToExt 推
 *
 * 设计抉择:
 * - **`compression: 'STORE'`**:asset 多为 PNG/JPEG(已 deflate 过),再 deflate 一遍
 *   收益接近 0 但 CPU 多跑;跟 packages/creator/src/export/to-png-zip.ts 一致。
 * - **一次性 load 全部 BLOB 进内存**:dogfood 期单 deck N < 10、单图 < 2MB,30MB 内
 *   可控。未来 N 大或 单 BLOB 涨,可改 stream(jszip 也支持)。
 * - **不复用 routes/decks.ts 的 ownership 校验**:这是个 pure function,只接 deckId
 *   + userId,内部 ownership 自校;由 route 层先 404/403/401。但本函数额外再校一遍是
 *   defense-in-depth,err message 用 'deck-not-found-or-forbidden'(不区分两种)避免
 *   ownership 探测。
 * - **`lumideckVersion: '0.1.0'`**:暂硬编码,后续 plan 31 close-out 可改从 package.json
 *   读;manifest 字段语义是「审计」,跟 import 兼容性判断只看 schemaVersion。
 */
import JSZip from 'jszip'
import { eq } from 'drizzle-orm'
import { CURRENT_SCHEMA_VERSION, type ArchiveManifest } from '@big-ppt/shared'
import { getDb, decks, deckVersions, deckAssets } from '../db/index.js'
import { mimeToExt } from './mime-ext.js'

/** 暂硬编码;manifest 内仅审计用,不参与 import 兼容性判断(那个看 schemaVersion)。 */
const LUMIDECK_VERSION = '0.1.0'

export async function buildArchive(args: { deckId: number; userId: number }): Promise<Buffer> {
  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, args.deckId)).limit(1)
  if (!deck || deck.userId !== args.userId) {
    throw new Error('deck-not-found-or-forbidden')
  }

  // 当前版本内容:没 currentVersion(全空 deck)兜底空串
  const versionId = deck.currentVersionId
  const [version] = versionId
    ? await db.select().from(deckVersions).where(eq(deckVersions.id, versionId)).limit(1)
    : []
  const content = version?.content ?? ''

  // 一次性查所有 asset(含 BLOB)。dogfood 期单 deck 资源量可控。
  const assets = await db.select().from(deckAssets).where(eq(deckAssets.deckId, args.deckId))

  const manifest: ArchiveManifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lumideckVersion: LUMIDECK_VERSION,
    exportedAt: new Date().toISOString(),
    deck: {
      originalDeckId: deck.id,
      title: deck.title,
      templateId: deck.templateId,
      createdAt: deck.createdAt.toISOString(),
      updatedAt: deck.updatedAt.toISOString(),
    },
    assets: assets.map((a) => ({
      id: a.id,
      mimeType: a.mimeType,
      bytesSize: a.bytesSize,
      prompt: a.prompt,
      model: a.model,
    })),
  }

  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('content.md', content)
  const assetsDir = zip.folder('assets')
  if (!assetsDir) {
    // jszip 文档说仅在路径合法时返 null;'assets' 一定合法 —— 兜底防御性 throw
    throw new Error('jszip-folder-create-failed')
  }
  for (const a of assets) {
    const filename = `${a.id}.${mimeToExt(a.mimeType)}`
    assetsDir.file(filename, a.data, { compression: 'STORE' })
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}
