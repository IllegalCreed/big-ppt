/** Phase 13 Task A: per-user storage quota check. */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { userAssets } from '../db/schema.js'

const DEFAULT_PER_USER = 100 * 1024 * 1024 // 100MB
const DEFAULT_PER_FILE = 10 * 1024 * 1024 // 10MB

export function getQuotaLimits(): { perUser: number; perFile: number } {
  return {
    perUser: Number(process.env.LUMIDECK_QUOTA_PER_USER_BYTES ?? DEFAULT_PER_USER),
    perFile: Number(process.env.LUMIDECK_QUOTA_PER_FILE_BYTES ?? DEFAULT_PER_FILE),
  }
}

export async function getUsedBytes(userId: number): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${userAssets.sizeBytes}), 0)` })
    .from(userAssets)
    .where(eq(userAssets.userId, userId))
  return Number(rows[0]?.total ?? 0)
}

export type QuotaCheck =
  | { ok: true; usedBytes: number; limitBytes: number }
  | { ok: false; reason: 'file-too-large' | 'quota-exceeded'; usedBytes: number; limitBytes: number }

export async function canUpload(userId: number, newFileSize: number): Promise<QuotaCheck> {
  const { perUser, perFile } = getQuotaLimits()
  if (newFileSize > perFile) {
    return { ok: false, reason: 'file-too-large', usedBytes: 0, limitBytes: perUser }
  }
  const usedBytes = await getUsedBytes(userId)
  if (usedBytes + newFileSize > perUser) {
    return { ok: false, reason: 'quota-exceeded', usedBytes, limitBytes: perUser }
  }
  return { ok: true, usedBytes, limitBytes: perUser }
}
