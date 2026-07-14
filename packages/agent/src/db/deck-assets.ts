/**
 * Phase 11.5：deck_assets 表的查询封装。
 *
 * Asset 字节存 MEDIUMBLOB,跟 deck/user 是 ON DELETE CASCADE。
 * 删 slide / 替换 imageSrc 时刻意不清旧 asset(为支持 deck_versions restore 回旧版本)。
 * 整 deck 删除时 cascade 自动清(但因为 decks 是 soft delete,需在路由层显式调 deleteAssetsByDeck)。
 */
import { randomUUID } from 'node:crypto'
import { eq, and, inArray, notInArray } from 'drizzle-orm'
import type { ImageStylePalettePolicy } from '@big-ppt/shared'
import { getDb } from './client.js'
import { deckAssets, decks } from './schema.js'

/**
 * Phase 11.8: asset 用途枚举(schema 上是 nullable varchar(32),为类型安全在 TS 层窄化)。
 * - null/undefined: 默认/历史/普通 generate_slide_image 产物
 * - 'anchor': 当前选定锚图(被 decks.anchor_asset_id 引用)
 * - 'mood-board-candidate': 候选未选中
 * - 'mood-board-discarded': 历史"换一批"丢弃 / 未中选
 */
export type AssetPurpose =
  | 'anchor'
  | 'mood-board-candidate'
  | 'mood-board-discarded'
  | 'mood-board-staging'
  | 'style-preset-anchor'

export type AssetStyleSource = 'system' | 'user' | 'explore'

export interface CreateAssetArgs {
  deckId: number
  userId: number
  mimeType: string
  data: Buffer
  prompt?: string
  model?: string
  /** Phase 11.8: 默认 null(普通生图产物);mood-board / anchor 用法显式传 */
  purpose?: AssetPurpose
  /** Phase 11.8 dogfood:mood-board candidate 的短风格标签(picker UI 展示用) */
  style?: string
  /** Phase 17: materialized preset / explore provenance。 */
  styleSource?: AssetStyleSource
  styleSourceId?: string
  stylePalettePolicy?: ImageStylePalettePolicy
  /** 与业务主题 prompt 分离的纯视觉技法提示。 */
  stylePrompt?: string
  imageWidth?: number
  imageHeight?: number
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
  purpose: string | null
  style: string | null
  styleSource: string | null
  styleSourceId: string | null
  stylePalettePolicy: string | null
  stylePrompt: string | null
  imageWidth: number | null
  imageHeight: number | null
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
    purpose: args.purpose,
    style: args.style,
    styleSource: args.styleSource,
    // explore candidate 的稳定 source id 就是自己的 deck asset id。
    styleSourceId: args.styleSourceId ?? (args.styleSource === 'explore' ? id : undefined),
    stylePalettePolicy: args.stylePalettePolicy,
    stylePrompt: args.stylePrompt,
    imageWidth: args.imageWidth,
    imageHeight: args.imageHeight,
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

/** 取 asset 行(包含 BLOB),把 userId ownership guard 推进 SQL WHERE。 */
export async function getAssetForUser(id: string, userId: number): Promise<AssetRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(deckAssets)
    .where(and(eq(deckAssets.id, id), eq(deckAssets.userId, userId)))
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

/**
 * Phase 11.8: 列出某 deck 的 mood-board 候选(purpose='mood-board-candidate')。
 * 给前端 modal 加载缩略图用,不返 BLOB(轻查询)。
 */
export async function listMoodBoardCandidates(
  deckId: number,
): Promise<Array<Pick<AssetRow, 'id' | 'mimeType' | 'prompt' | 'style' | 'createdAt'>>> {
  const db = getDb()
  return db
    .select({
      id: deckAssets.id,
      mimeType: deckAssets.mimeType,
      prompt: deckAssets.prompt,
      style: deckAssets.style,
      createdAt: deckAssets.createdAt,
    })
    .from(deckAssets)
    .where(and(eq(deckAssets.deckId, deckId), eq(deckAssets.purpose, 'mood-board-candidate')))
}

/**
 * Phase 11.8 dogfood:列出某 deck **当前展示的 anchor + 同批 candidate**(picker
 * 重开时用)。
 *
 * 返回 purpose IN ('mood-board-candidate', 'anchor') 的全部行 + style + prompt,
 * 不返 BLOB。前端展示时通过 deck.anchorAssetId 反查哪张是 selected。
 *
 * 一般情况下返 3 行(同批),最多场景:用户已选 anchor 后再次"换一批"前的旧批
 * 也是 3 行(其中 1 行 purpose='anchor',另 2 行 'mood-board-candidate')。
 */
export async function listAnchorAndCandidates(
  deckId: number,
): Promise<
  Array<
    Pick<
      AssetRow,
      | 'id'
      | 'mimeType'
      | 'prompt'
      | 'style'
      | 'purpose'
      | 'styleSource'
      | 'styleSourceId'
      | 'stylePalettePolicy'
      | 'stylePrompt'
      | 'imageWidth'
      | 'imageHeight'
      | 'createdAt'
    >
  >
> {
  const db = getDb()
  return db
    .select({
      id: deckAssets.id,
      mimeType: deckAssets.mimeType,
      prompt: deckAssets.prompt,
      style: deckAssets.style,
      purpose: deckAssets.purpose,
      styleSource: deckAssets.styleSource,
      styleSourceId: deckAssets.styleSourceId,
      stylePalettePolicy: deckAssets.stylePalettePolicy,
      stylePrompt: deckAssets.stylePrompt,
      imageWidth: deckAssets.imageWidth,
      imageHeight: deckAssets.imageHeight,
      createdAt: deckAssets.createdAt,
    })
    .from(deckAssets)
    .where(
      and(
        eq(deckAssets.deckId, deckId),
        inArray(deckAssets.purpose, ['mood-board-candidate', 'anchor']),
      ),
    )
    .orderBy(deckAssets.createdAt)
}

/**
 * Phase 17 compatibility path for the legacy synchronous mood-board endpoint.
 * Replace only old, non-active candidates after the new batch has fully succeeded.
 * The current anchor is intentionally untouched.
 */
export async function replaceMoodBoardCandidatesAfterSuccess(
  deckId: number,
  userId: number,
  newAssetIds: string[],
): Promise<void> {
  if (newAssetIds.length === 0) return
  await getDb()
    .update(deckAssets)
    .set({ purpose: 'mood-board-discarded' })
    .where(
      and(
        eq(deckAssets.deckId, deckId),
        eq(deckAssets.userId, userId),
        eq(deckAssets.purpose, 'mood-board-candidate'),
        notInArray(deckAssets.id, newAssetIds),
      ),
    )
}

/**
 * Phase 11.8: 选定某个 candidate 作为 anchor。
 * - 把目标 asset.purpose 从 candidate 改 anchor
 * - 同 deck 其它 candidate 改 discarded
 * - decks.anchor_asset_id 写入(若 deck 已有旧 anchor,旧 asset.purpose 也改 discarded)
 *
 * IDOR guard 由 caller 在 routes 层保证(asset.deckId === deckId + asset.userId === user.id)。
 * 本函数只做事务一致性,不重复校验。
 */
export async function markAsAnchor(deckId: number, assetId: string): Promise<void> {
  const db = getDb()
  // 1) 读现 deck.anchor_asset_id(若存在,旧 anchor 降级回 candidate 让用户能重选)
  const [deck] = await db
    .select({ anchorAssetId: decks.anchorAssetId })
    .from(decks)
    .where(eq(decks.id, deckId))
    .limit(1)
  const prevAnchorId = deck?.anchorAssetId ?? null

  // 2) Phase 11.8 dogfood 调整:**不**把同批其他 candidate 标 discarded。
  //    设计语义:已选 anchor 后用户重开 modal,应看到原 3 张 + 选中态高亮,而非只剩 1 张。
  //    其他 candidate 保持 'mood-board-candidate' 状态;同批堆积由 POST /generate 路由
  //    在「换一批」时主动 discard 旧批解决,避免 N 批堆。

  // 3) 旧 anchor 降级回 candidate(不是 discarded;让重选语义可逆)
  if (prevAnchorId && prevAnchorId !== assetId) {
    await db
      .update(deckAssets)
      .set({ purpose: 'mood-board-candidate' })
      .where(and(eq(deckAssets.id, prevAnchorId), eq(deckAssets.deckId, deckId)))
  }

  // 4) 目标 asset 设为 anchor
  await db
    .update(deckAssets)
    .set({ purpose: 'anchor' })
    .where(and(eq(deckAssets.id, assetId), eq(deckAssets.deckId, deckId)))

  // 5) decks.anchor_asset_id 写入
  await db.update(decks).set({ anchorAssetId: assetId }).where(eq(decks.id, deckId))
}

/**
 * Phase 11.8 dogfood 新增:用户点「取消风格限制」按钮触发。
 * - 把当前 anchor asset 降级回 'mood-board-candidate'(保留在历史候选里,可被重新选中)
 * - decks.anchor_asset_id 置 NULL
 * - decks.anchor_skipped 设 true(语义=用户已决策"自由发挥",polling block 不再触发)
 *
 * 跟 clearDeckAnchor 的区别:那个是切模板用的破坏性操作(把 anchor 标 discarded);
 * 本函数让 anchor 状态可逆,用户随时能重选。
 */
export async function clearAnchorKeepCandidates(deckId: number): Promise<void> {
  const db = getDb()
  const [deck] = await db
    .select({ anchorAssetId: decks.anchorAssetId })
    .from(decks)
    .where(eq(decks.id, deckId))
    .limit(1)
  const prevAnchorId = deck?.anchorAssetId ?? null
  if (prevAnchorId) {
    await db
      .update(deckAssets)
      .set({ purpose: 'mood-board-candidate' })
      .where(and(eq(deckAssets.id, prevAnchorId), eq(deckAssets.deckId, deckId)))
  }
  await db
    .update(decks)
    .set({ anchorAssetId: null, anchorSkipped: true })
    .where(eq(decks.id, deckId))
}

/**
 * Phase 11.8: 清空 deck 的 anchor(切模板时调用)。
 * - decks.anchor_asset_id 置 NULL
 * - 当前 anchor asset 改 discarded
 * - candidate 不动(理论不存在;defensive)
 */
export async function clearDeckAnchor(deckId: number): Promise<void> {
  const db = getDb()
  const [deck] = await db
    .select({ anchorAssetId: decks.anchorAssetId })
    .from(decks)
    .where(eq(decks.id, deckId))
    .limit(1)
  const prevAnchorId = deck?.anchorAssetId ?? null
  if (prevAnchorId) {
    await db
      .update(deckAssets)
      .set({ purpose: 'mood-board-discarded' })
      .where(and(eq(deckAssets.id, prevAnchorId), eq(deckAssets.deckId, deckId)))
  }
  await db.update(decks).set({ anchorAssetId: null }).where(eq(decks.id, deckId))
}

/**
 * Phase 11.8: 在 restore 切模板版本时,把 deck 的 anchor 恢复到指定 asset id(或 null)。
 * 跟 setAnchor 不同:本函数不动 purpose 状态机(避免乱了 candidate/discarded 流转),
 * 只写 decks.anchor_asset_id;asset.purpose='anchor' 由 markAsAnchor 时保证,restore 视为
 * 重新指向某个历史 asset。
 *
 * 校验:若 anchorAssetId 非 null,必须确实属于该 deck(防 cross-deck 注入)。
 */
export async function restoreDeckAnchor(
  deckId: number,
  anchorAssetId: string | null,
): Promise<void> {
  const db = getDb()
  if (anchorAssetId) {
    const [asset] = await db
      .select({ id: deckAssets.id })
      .from(deckAssets)
      .where(and(eq(deckAssets.id, anchorAssetId), eq(deckAssets.deckId, deckId)))
      .limit(1)
    if (!asset) {
      // 历史 anchor 已不存在(被 GC / 跨 deck 错乱),静默清空避免脏指针
      await db.update(decks).set({ anchorAssetId: null }).where(eq(decks.id, deckId))
      return
    }
  }
  await db.update(decks).set({ anchorAssetId }).where(eq(decks.id, deckId))
}

/**
 * Phase 11.8 debug helper: 强制把多个 asset 改 discarded(失败兜底时用)。
 * caller 必须自己保证 ownership。
 */
export async function discardAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = getDb()
  await db
    .update(deckAssets)
    .set({ purpose: 'mood-board-discarded' })
    .where(inArray(deckAssets.id, ids))
}
