/** Phase 17: user-owned reusable image-style preset persistence. */
import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, sql, sum } from 'drizzle-orm'
import type { ImageStylePalettePolicy } from '@big-ppt/shared'
import { readImageDimensions } from '../llm/image-dimensions.js'
import { getDb } from './client.js'
import { deckAssets, decks, userStylePresets, users } from './schema.js'

export const USER_STYLE_PRESET_MAX_COUNT = 30
export const USER_STYLE_PRESET_MAX_BYTES = 100 * 1024 * 1024
export const USER_STYLE_PRESET_MAX_SINGLE_BYTES = 10 * 1024 * 1024

export type UserStylePresetQuotaCode =
  | 'preset-count-exceeded'
  | 'preset-storage-exceeded'
  | 'preset-too-large'

export class UserStylePresetQuotaError extends Error {
  constructor(readonly code: UserStylePresetQuotaCode) {
    super(
      code === 'preset-count-exceeded'
        ? `我的风格最多保存 ${USER_STYLE_PRESET_MAX_COUNT} 个`
        : code === 'preset-too-large'
          ? '单个风格图片超过 10MB 上限'
          : '我的风格已达到 100MB 容量上限',
    )
    this.name = 'UserStylePresetQuotaError'
  }
}

export class UserStylePresetSourceError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid-style-source',
  ) {
    super(message)
    this.name = 'UserStylePresetSourceError'
  }
}

export interface UserStylePresetListRow {
  id: string
  name: string
  style: string
  palettePolicy: string
  mimeType: string
  bytesSize: number
  width: number | null
  height: number | null
  lastUsedAt: Date | null
  createdAt: Date
}

export interface UserStylePresetBlobRow extends UserStylePresetListRow {
  userId: number
  sourceTemplateId: string | null
  sourceAssetId: string | null
  prompt: string | null
  stylePrompt: string
  data: Buffer
}

export interface UserStylePresetQuota {
  usedCount: number
  maxCount: number
  usedBytes: number
  maxBytes: number
}

function normalizePalettePolicy(value: string | null): ImageStylePalettePolicy {
  return value === 'template' ? 'template' : 'reference'
}

export async function listUserStylePresets(userId: number): Promise<UserStylePresetListRow[]> {
  return getDb()
    .select({
      id: userStylePresets.id,
      name: userStylePresets.name,
      style: userStylePresets.style,
      palettePolicy: userStylePresets.palettePolicy,
      mimeType: userStylePresets.mimeType,
      bytesSize: userStylePresets.bytesSize,
      width: userStylePresets.width,
      height: userStylePresets.height,
      lastUsedAt: userStylePresets.lastUsedAt,
      createdAt: userStylePresets.createdAt,
    })
    .from(userStylePresets)
    .where(eq(userStylePresets.userId, userId))
    .orderBy(
      desc(userStylePresets.lastUsedAt),
      desc(userStylePresets.createdAt),
      desc(userStylePresets.id),
    )
}

export async function getUserStylePreset(
  userId: number,
  presetId: string,
): Promise<UserStylePresetBlobRow | null> {
  const [row] = await getDb()
    .select()
    .from(userStylePresets)
    .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function getUserStylePresetQuota(userId: number): Promise<UserStylePresetQuota> {
  const [row] = await getDb()
    .select({
      usedCount: count(),
      usedBytes: sum(userStylePresets.bytesSize),
    })
    .from(userStylePresets)
    .where(eq(userStylePresets.userId, userId))
  return {
    usedCount: Number(row?.usedCount ?? 0),
    maxCount: USER_STYLE_PRESET_MAX_COUNT,
    usedBytes: Number(row?.usedBytes ?? 0),
    maxBytes: USER_STYLE_PRESET_MAX_BYTES,
  }
}

export async function saveUserStylePresetFromAsset(args: {
  userId: number
  deckId: number
  assetId: string
  name?: string
}): Promise<UserStylePresetBlobRow> {
  const db = getDb()
  return db.transaction(async (tx) => {
    // Serialize quota checks across concurrent saves (and across future PM2 workers).
    await tx.execute(
      sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${args.userId} FOR UPDATE`,
    )

    const [deck] = await tx
      .select({ id: decks.id, templateId: decks.templateId })
      .from(decks)
      .where(
        and(
          eq(decks.id, args.deckId),
          eq(decks.userId, args.userId),
          inArray(decks.status, ['active', 'archived']),
        ),
      )
      .limit(1)
    if (!deck) throw new UserStylePresetSourceError('deck 不存在或无权访问', 'deck-not-found')

    const [asset] = await tx
      .select()
      .from(deckAssets)
      .where(
        and(
          eq(deckAssets.id, args.assetId),
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
          inArray(deckAssets.purpose, ['mood-board-candidate', 'anchor', 'style-preset-anchor']),
        ),
      )
      .limit(1)
    if (!asset) {
      throw new UserStylePresetSourceError('只能保存当前 deck 的 AI 探索候选或已选探索风格')
    }

    // Repeated clicks are idempotent. Do this before quota checks.
    const [existing] = await tx
      .select()
      .from(userStylePresets)
      .where(
        and(
          eq(userStylePresets.userId, args.userId),
          eq(userStylePresets.sourceAssetId, args.assetId),
        ),
      )
      .limit(1)
    if (existing) return existing

    if (asset.bytesSize > USER_STYLE_PRESET_MAX_SINGLE_BYTES) {
      throw new UserStylePresetQuotaError('preset-too-large')
    }
    const [quota] = await tx
      .select({ usedCount: count(), usedBytes: sum(userStylePresets.bytesSize) })
      .from(userStylePresets)
      .where(eq(userStylePresets.userId, args.userId))
    const usedCount = Number(quota?.usedCount ?? 0)
    const usedBytes = Number(quota?.usedBytes ?? 0)
    if (usedCount >= USER_STYLE_PRESET_MAX_COUNT) {
      throw new UserStylePresetQuotaError('preset-count-exceeded')
    }
    if (usedBytes + asset.bytesSize > USER_STYLE_PRESET_MAX_BYTES) {
      throw new UserStylePresetQuotaError('preset-storage-exceeded')
    }

    const dimensions =
      asset.imageWidth && asset.imageHeight
        ? { width: asset.imageWidth, height: asset.imageHeight }
        : readImageDimensions(Buffer.from(asset.data))
    if (!dimensions) {
      throw new UserStylePresetSourceError('无法识别风格图片尺寸', 'invalid-image')
    }

    const id = randomUUID()
    const style = asset.style?.trim() || '自定义风格'
    const name = args.name?.trim() || style
    if (name.length > 80) {
      throw new UserStylePresetSourceError('风格名称最多 80 个字符', 'invalid-name')
    }
    const palettePolicy = normalizePalettePolicy(asset.stylePalettePolicy)
    await tx.insert(userStylePresets).values({
      id,
      userId: args.userId,
      sourceTemplateId: deck.templateId,
      sourceAssetId: asset.id,
      name,
      style,
      prompt: asset.prompt,
      stylePrompt: asset.stylePrompt?.trim() || style,
      palettePolicy,
      mimeType: asset.mimeType,
      bytesSize: asset.bytesSize,
      data: asset.data,
      width: dimensions.width,
      height: dimensions.height,
    })

    // The active/candidate deck asset now has stable user-preset provenance, so reopening
    // the library highlights it as a saved preset without copying another deck asset.
    await tx
      .update(deckAssets)
      .set({
        styleSource: 'user',
        styleSourceId: id,
        stylePalettePolicy: palettePolicy,
        stylePrompt: asset.stylePrompt?.trim() || style,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
      })
      .where(
        and(
          eq(deckAssets.id, asset.id),
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
        ),
      )

    const [created] = await tx
      .select()
      .from(userStylePresets)
      .where(and(eq(userStylePresets.id, id), eq(userStylePresets.userId, args.userId)))
      .limit(1)
    if (!created) throw new Error('风格保存后回查失败')
    return created
  })
}

export async function renameUserStylePreset(
  userId: number,
  presetId: string,
  name: string,
): Promise<boolean> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) {
    throw new UserStylePresetSourceError('风格名称必须是 1-80 个字符', 'invalid-name')
  }
  const [row] = await getDb()
    .select({ id: userStylePresets.id })
    .from(userStylePresets)
    .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
    .limit(1)
  if (!row) return false
  await getDb()
    .update(userStylePresets)
    .set({ name: trimmed })
    .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
  return true
}

export async function deleteUserStylePreset(userId: number, presetId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: userStylePresets.id })
      .from(userStylePresets)
      .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
      .limit(1)
    if (!row) return false

    // Materialized deck assets keep their BLOB/purpose and therefore keep generating.
    // Their library provenance becomes an explore asset so a deleted preset is no longer
    // highlighted as saved, and the user may save it again later.
    await tx
      .update(deckAssets)
      .set({
        styleSource: 'explore',
        styleSourceId: sql`${deckAssets.id}`,
      })
      .where(
        and(
          eq(deckAssets.userId, userId),
          eq(deckAssets.styleSource, 'user'),
          eq(deckAssets.styleSourceId, presetId),
        ),
      )
    await tx
      .delete(userStylePresets)
      .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
    return true
  })
}

export async function touchUserStylePreset(userId: number, presetId: string): Promise<void> {
  await getDb()
    .update(userStylePresets)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(userStylePresets.id, presetId), eq(userStylePresets.userId, userId)))
}
