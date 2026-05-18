/**
 * Phase 15:asset MIME → 文件扩展名映射(导出归档时落 assets/<id>.<ext>)。
 * 未知 MIME 统一落 .bin,parse 端按 manifest.mimeType 读不依赖扩展名。
 */
const MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function mimeToExt(mime: string): string {
  return MAP[mime.toLowerCase()] ?? 'bin'
}
