/**
 * Phase 11.5：deck_assets 表的查询封装。
 *
 * Asset 字节存 MEDIUMBLOB,跟 deck/user 是 ON DELETE CASCADE。
 * 删 slide / 替换 imageSrc 时刻意不清旧 asset(为支持 deck_versions restore 回旧版本)。
 * 整 deck 删除时 cascade 自动清(但因为 decks 是 soft delete,需在路由层显式调 deleteAssetsByDeck)。
 */
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { getDb } from './client.js'
import { deckAssets } from './schema.js'

export interface CreateAssetArgs {
  deckId: number
  userId: number
  mimeType: string
  data: Buffer
  prompt?: string
  model?: string
}

export interface AssetRow {
  id: string
  deckId: number
  userId: number
  mimeType: string
  bytesSize: number
  data: Buffer
  prompt: string | null
  model: string | null
  createdAt: Date
}

export async function createAsset(args: CreateAssetArgs): Promise<{ id: string }> {
  const id = randomUUID()
  const db = getDb()
  await db.insert(deckAssets).values({
    id,
    deckId: args.deckId,
    userId: args.userId,
    mimeType: args.mimeType,
    bytesSize: args.data.length,
    data: args.data,
    prompt: args.prompt,
    model: args.model,
  })
  return { id }
}

/**
 * 取 asset 行(包含 BLOB)。
 *
 * `ownership` 可选:传入则把 `deckId` / `userId` 推进 SQL `WHERE` 复合条件,
 * 不匹配直接 SELECT 空 → 返 null,**BLOB 永远不会被 load 进进程内存**。
 *
 * 不传 ownership 沿用单条件 `WHERE id = ?`,call site 必须自己 object-level 检查
 * 归属(老 caller / 读 prompt 字段不暴露 BLOB 的场景 OK,但凡是要把 BLOB 喂给
 * 外部 API 的链路应当显式传 ownership 让 SQL guard 先于内存 load 拒掉)。
 */
export async function getAsset(
  id: string,
  ownership?: { deckId: number; userId: number },
): Promise<AssetRow | null> {
  const db = getDb()
  const conds = [eq(deckAssets.id, id)]
  if (ownership) {
    conds.push(eq(deckAssets.deckId, ownership.deckId), eq(deckAssets.userId, ownership.userId))
  }
  const [row] = await db
    .select()
    .from(deckAssets)
    .where(conds.length === 1 ? conds[0]! : and(...conds))
    .limit(1)
  return row ?? null
}

/**
 * 删除指定 deck 的所有 asset 行。
 * 配合 routes/decks.ts 的 soft delete:soft delete 不触发 cascade,需显式调本函数。
 */
export async function deleteAssetsByDeck(deckId: number): Promise<number> {
  const db = getDb()
  const result = await db.delete(deckAssets).where(eq(deckAssets.deckId, deckId))
  // mysql2 driver 返 ResultSetHeader,affectedRows 在 [0].affectedRows
  // drizzle 返回 OkPacket-like;用 any 兜底,只用于日志
  return (result as unknown as { affectedRows?: number }[])[0]?.affectedRows ?? 0
}

/** 测试 / 数据迁移用:列出某 deck 的所有 asset id(不包含 BLOB,轻查询) */
export async function listAssetIdsByDeck(deckId: number): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ id: deckAssets.id })
    .from(deckAssets)
    .where(eq(deckAssets.deckId, deckId))
  return rows.map((r) => r.id)
}

/** 删除单个 asset(取消 job 时可能用到) */
export async function deleteAsset(id: string, userId: number): Promise<boolean> {
  const db = getDb()
  await db.delete(deckAssets).where(and(eq(deckAssets.id, id), eq(deckAssets.userId, userId)))
  return true
}
