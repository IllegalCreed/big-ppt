/** Phase 13 Task A: storage 单测 — tmpdir 隔离,不碰真 DB / 真 fs root. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { deleteAssetBytes, getAssetBytes, putAssetBytes } from '../storage.js'

let tmpDir: string
let prevEnv: string | undefined

beforeEach(async () => {
  prevEnv = process.env.LUMIDECK_ASSETS_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumideck-storage-test-'))
  process.env.LUMIDECK_ASSETS_DIR = tmpDir
})

afterEach(async () => {
  if (prevEnv === undefined) delete process.env.LUMIDECK_ASSETS_DIR
  else process.env.LUMIDECK_ASSETS_DIR = prevEnv
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('storage', () => {
  it('putAssetBytes 写文件 + 自动建 parent dir + 返相对路径', async () => {
    const userId = 42
    const assetId = randomUUID()
    const bytes = Buffer.from('hello lumideck')

    const relPath = await putAssetBytes(userId, assetId, bytes)

    expect(relPath).toBe(path.join(String(userId), assetId))
    const abs = path.join(tmpDir, String(userId), assetId)
    const stat = await fs.stat(abs)
    expect(stat.isFile()).toBe(true)
    expect(await fs.readFile(abs)).toEqual(bytes)
  })

  it('getAssetBytes 读回的字节与写入一致', async () => {
    const userId = 7
    const assetId = randomUUID()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // PNG magic
    await putAssetBytes(userId, assetId, bytes)

    const got = await getAssetBytes(userId, assetId)
    expect(got).toEqual(bytes)
  })

  it('deleteAssetBytes 移除文件', async () => {
    const userId = 1
    const assetId = randomUUID()
    await putAssetBytes(userId, assetId, Buffer.from('x'))
    const abs = path.join(tmpDir, String(userId), assetId)
    expect((await fs.stat(abs)).isFile()).toBe(true)

    await deleteAssetBytes(userId, assetId)
    await expect(fs.stat(abs)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deleteAssetBytes 对不存在文件不抛错(ENOENT 幂等)', async () => {
    const userId = 999
    const assetId = randomUUID()
    await expect(deleteAssetBytes(userId, assetId)).resolves.toBeUndefined()
  })

  it('非 uuid 格式的 assetId 被拒绝(path traversal 防御)', async () => {
    const userId = 1
    // 试图通过 `../` 跳出 user dir
    await expect(putAssetBytes(userId, '../etc/passwd', Buffer.from('x'))).rejects.toThrow(
      /invalid assetId/,
    )
    await expect(getAssetBytes(userId, '../../../secret')).rejects.toThrow(/invalid assetId/)
    await expect(deleteAssetBytes(userId, 'not-a-uuid')).rejects.toThrow(/invalid assetId/)
  })
})
