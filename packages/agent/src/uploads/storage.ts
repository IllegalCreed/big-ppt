/** Phase 13 Task A: 本地 fs 抽象,后续 OSS 迁移走同一接口。 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

function getAssetsRoot(): string {
  return process.env.LUMIDECK_ASSETS_DIR ?? '/tmp/lumideck-assets'
}

function assetPath(userId: number, assetId: string): string {
  // 强制 ${userId}/${assetId} 模板,assetId 必须是 uuid v4 防 path traversal
  if (!/^[a-f0-9-]{36}$/.test(assetId)) throw new Error(`invalid assetId: ${assetId}`)
  return path.join(getAssetsRoot(), String(userId), assetId)
}

export async function putAssetBytes(userId: number, assetId: string, bytes: Buffer): Promise<string> {
  const p = assetPath(userId, assetId)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, bytes)
  // 返相对路径存进 DB.storagePath,跨机迁移时 root 可变
  return path.relative(getAssetsRoot(), p)
}

export async function getAssetBytes(userId: number, assetId: string): Promise<Buffer> {
  return fs.readFile(assetPath(userId, assetId))
}

export async function deleteAssetBytes(userId: number, assetId: string): Promise<void> {
  const p = assetPath(userId, assetId)
  try {
    await fs.unlink(p)
  } catch (e) {
    // ENOENT silently OK,让 delete 操作幂等(重复删除不报错)
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}

export function getAssetsRootForTest(): string {
  return getAssetsRoot()
}
