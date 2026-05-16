/** Phase 13 Task A: quota 单测 — lumideck_test 真 DB,env 收紧 cap 让数学好算. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getDb, userAssets } from '../src/db/index.js'
import { canUpload } from '../src/uploads/quota.js'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser } from './_setup/factories.js'

const PER_USER = 10 * 1024 * 1024 // 10MB
const PER_FILE = 5 * 1024 * 1024 // 5MB

let prevUser: string | undefined
let prevFile: string | undefined

beforeAll(() => {
  prevUser = process.env.LUMIDECK_QUOTA_PER_USER_BYTES
  prevFile = process.env.LUMIDECK_QUOTA_PER_FILE_BYTES
  process.env.LUMIDECK_QUOTA_PER_USER_BYTES = String(PER_USER)
  process.env.LUMIDECK_QUOTA_PER_FILE_BYTES = String(PER_FILE)
})

afterAll(() => {
  if (prevUser === undefined) delete process.env.LUMIDECK_QUOTA_PER_USER_BYTES
  else process.env.LUMIDECK_QUOTA_PER_USER_BYTES = prevUser
  if (prevFile === undefined) delete process.env.LUMIDECK_QUOTA_PER_FILE_BYTES
  else process.env.LUMIDECK_QUOTA_PER_FILE_BYTES = prevFile
})

useTestDb()

async function insertAssetRow(userId: number, sizeBytes: number): Promise<void> {
  const db = getDb()
  const id = randomUUID()
  await db.insert(userAssets).values({
    id,
    userId,
    filename: 'x.bin',
    mime: 'application/octet-stream',
    sizeBytes,
    sha256: 'a'.repeat(64),
    storagePath: `${userId}/${id}`,
    extractStatus: 'skipped',
  })
}

describe('canUpload', () => {
  it('empty pool + 小文件 → ok,usedBytes=0', async () => {
    const { user } = await createTestUser('q1@a.com')
    const res = await canUpload(user.id, 1024)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.usedBytes).toBe(0)
      expect(res.limitBytes).toBe(PER_USER)
    }
  })

  it('单文件 > per-file cap → file-too-large(不查 DB)', async () => {
    const { user } = await createTestUser('q2@a.com')
    const res = await canUpload(user.id, PER_FILE + 1)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('file-too-large')
      expect(res.limitBytes).toBe(PER_USER)
    }
  })

  it('累积已用 + 新增超 per-user cap → quota-exceeded', async () => {
    const { user } = await createTestUser('q3@a.com')
    // 塞两行各 4MB 共 8MB,再传 3MB 会超 10MB cap
    await insertAssetRow(user.id, 4 * 1024 * 1024)
    await insertAssetRow(user.id, 4 * 1024 * 1024)
    const res = await canUpload(user.id, 3 * 1024 * 1024)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('quota-exceeded')
      expect(res.usedBytes).toBe(8 * 1024 * 1024)
      expect(res.limitBytes).toBe(PER_USER)
    }
  })

  it('边界:已用 5MB + 新增 5MB 正好等于 cap → ok', async () => {
    const { user } = await createTestUser('q4@a.com')
    await insertAssetRow(user.id, 5 * 1024 * 1024)
    const res = await canUpload(user.id, 5 * 1024 * 1024)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.usedBytes).toBe(5 * 1024 * 1024)
      expect(res.limitBytes).toBe(PER_USER)
    }
  })
})
