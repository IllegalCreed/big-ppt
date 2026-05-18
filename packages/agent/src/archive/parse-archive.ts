/**
 * Phase 15 Task 31-C:把 `.lumideck` zip 字节解 + 校验成内存对象。
 *
 * 不接 DB —— 只做 zip 解 + manifest schema 校 + asset 字节落 Map;
 * route 层接 ParsedArchive 后自己跑 transaction 入库。
 *
 * 校验顺序刻意从外往内,出错及早回:
 *   1. magic bytes(zip 头 PK\x03\x04 前 2 字节)—— 非 zip 直接 'not-a-zip'
 *   2. jszip loadAsync —— 内部结构损坏触发 'not-a-zip'
 *   3. manifest.json 存在 → JSON.parse 成功 → schemaVersion 在 SUPPORTED 内
 *      → manifest 必填字段(deck.title / deck.templateId / assets array)
 *   4. content.md 存在
 *   5. 遍历 manifest.assets:id 形状 → assets/<id>.<ext> 存在 → bytes 长度 = bytesSize
 *
 * 注意:
 * - asset 文件名扩展名由 manifest.mimeType 推(跟 build-archive 同套路),
 *   parse 端不靠包内文件名扩展名做校验,只信 manifest.mimeType。
 * - bytesSize 不匹配抛 'asset-corrupt' —— 防止意外被改包或下载截断。
 * - 不接受 zip 内额外文件(忽略,不报错)—— 留扩展空间(未来加 README.txt 等)。
 */
import JSZip from 'jszip'
import { SUPPORTED_SCHEMA_VERSIONS, type ArchiveManifest } from '@big-ppt/shared'
import { ArchiveError } from './errors.js'
import { mimeToExt } from './mime-ext.js'

export interface ParsedArchive {
  manifest: ArchiveManifest
  content: string
  /** asset id → 字节 buffer。Map 顺序跟 manifest.assets 一致。 */
  assets: Map<string, Buffer>
}

export async function parseArchive(zipBuffer: Buffer): Promise<ParsedArchive> {
  // 1. magic-bytes 校验:zip 头 PK\x03\x04(0x50 0x4b 0x03 0x04)
  //    只校前 2 字节就够定位「不是 zip」,后 2 字节(0x03 0x04)留给 jszip loadAsync 验
  if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
    throw new ArchiveError('not-a-zip', '数据包损坏: 不是合法 zip 文件')
  }
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBuffer)
  } catch (e) {
    throw new ArchiveError('not-a-zip', '数据包损坏: 无法解析 zip', e)
  }

  // 2. manifest.json 存在 + JSON parse 成功
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) {
    throw new ArchiveError('manifest-missing', '数据包缺少 manifest.json')
  }
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await manifestFile.async('string'))
  } catch (e) {
    throw new ArchiveError('manifest-invalid', '数据包 manifest.json 不是合法 JSON', e)
  }
  if (!manifestRaw || typeof manifestRaw !== 'object') {
    throw new ArchiveError('manifest-invalid', 'manifest.json 不是 object')
  }
  const manifest = manifestRaw as ArchiveManifest

  // 3. schemaVersion 在 SUPPORTED 列表内
  if (
    typeof manifest.schemaVersion !== 'number' ||
    !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(manifest.schemaVersion)
  ) {
    throw new ArchiveError(
      'schema-unsupported',
      `数据包版本 ${manifest.schemaVersion} 不被当前 Lumideck 支持,请用新版重新导出`,
    )
  }

  // 4. manifest 必填字段齐
  if (
    !manifest.deck ||
    typeof manifest.deck.title !== 'string' ||
    typeof manifest.deck.templateId !== 'string'
  ) {
    throw new ArchiveError('manifest-invalid', 'manifest.json deck 字段不完整')
  }
  if (!Array.isArray(manifest.assets)) {
    throw new ArchiveError('manifest-invalid', 'manifest.json assets 字段非数组')
  }

  // 5. content.md 存在
  const contentFile = zip.file('content.md')
  if (!contentFile) {
    throw new ArchiveError('content-missing', '数据包缺少 content.md')
  }
  const content = await contentFile.async('string')

  // 6. assets/ 文件名跟 manifest 一一对应 + size 匹配
  const assetsMap = new Map<string, Buffer>()
  for (const entry of manifest.assets) {
    if (typeof entry.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.id)) {
      throw new ArchiveError('manifest-invalid', `asset id 不是合法 uuid: ${entry.id}`)
    }
    if (typeof entry.mimeType !== 'string' || typeof entry.bytesSize !== 'number') {
      throw new ArchiveError('manifest-invalid', `asset ${entry.id} 元数据缺字段`)
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

  return { manifest, content, assets: assetsMap }
}
