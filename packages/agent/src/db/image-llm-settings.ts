/**
 * Phase 11.5：生图模型配置加密读写。
 *
 * 与 users.llm_settings 完全独立的字段 users.image_llm_settings；同套 AES-256-GCM 机制，
 * 但模型 / provider 集合独立。NULL → 用户未配置，工具应显式拒绝。
 */
import { eq } from 'drizzle-orm'
import type { ImageLlmSettings } from '@big-ppt/shared'
import { getDb } from './client.js'
import { users } from './schema.js'
import { encryptApiKey, decryptApiKey } from '../crypto/apikey.js'

export async function getImageLlmSettings(userId: number): Promise<ImageLlmSettings | null> {
  const db = getDb()
  const [u] = await db
    .select({ imageLlmSettings: users.imageLlmSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u || !u.imageLlmSettings) return null
  const json = decryptApiKey(u.imageLlmSettings)
  return JSON.parse(json) as ImageLlmSettings
}

export async function setImageLlmSettings(
  userId: number,
  settings: ImageLlmSettings,
): Promise<void> {
  const payload = JSON.stringify(settings)
  const encrypted = encryptApiKey(payload)
  const db = getDb()
  await db.update(users).set({ imageLlmSettings: encrypted }).where(eq(users.id, userId))
}

export async function clearImageLlmSettings(userId: number): Promise<void> {
  const db = getDb()
  await db.update(users).set({ imageLlmSettings: null }).where(eq(users.id, userId))
}
