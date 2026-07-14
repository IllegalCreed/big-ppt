/** Phase 17: deck-scoped image-style library orchestration and atomic apply/free. */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type {
  ActiveImageStyle,
  ApplyImageStyleRequest,
  ApplyImageStyleResponse,
  GeneratedImageStyleCandidate,
  ImageStyleLibraryPreset,
  ImageStyleLibraryResponse,
  ImageStylePalettePolicy,
  SaveImageStylePresetResponse,
} from '@big-ppt/shared'
import { getDb } from '../db/client.js'
import {
  getUserStylePreset,
  listUserStylePresets,
  saveUserStylePresetFromAsset,
} from '../db/user-style-presets.js'
import { deckAssets, decks } from '../db/schema.js'
import { getRemainingStyleExplorations, getStyleExploreDrawState } from './job.js'
import {
  getImageStyle,
  listImageStylePresetSummaries,
  listImageStyles,
  readImageStyleReference,
} from '../image-styles/registry.js'
import { SIZE_AR_TOLERANCE } from '../llm/image-dimensions.js'
import { logServerEvent } from '../logger/server-log.js'
import { getManifest } from '../templates/registry.js'

const FALLBACK_IMAGE_SIZE = { width: 1536, height: 720 } as const

export class StyleLibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500,
    readonly code: string,
  ) {
    super(message)
    this.name = 'StyleLibraryError'
  }
}

interface TargetSize {
  width: number
  height: number
}

interface ResolvedPreset {
  source: 'system' | 'user'
  sourceId: string
  name: string
  style: string
  prompt: string | null
  stylePrompt: string
  palettePolicy: ImageStylePalettePolicy
  mimeType: string
  data: Buffer
  bytesSize: number
  width: number
  height: number
}

function normalizePalettePolicy(value: string | null | undefined): ImageStylePalettePolicy {
  return value === 'template' ? 'template' : 'reference'
}

export function getTemplateImageSize(templateId: string): TargetSize {
  const manifest = getManifest(templateId)
  if (!manifest) {
    throw new StyleLibraryError(`模板 ${templateId} 未注册`, 500, 'template-not-found')
  }
  return manifest.imageGenSize ?? FALLBACK_IMAGE_SIZE
}

export function isImageStyleDimensionCompatible(
  image: { width: number | null; height: number | null },
  target: TargetSize,
): boolean {
  if (!image.width || !image.height || image.height <= 0 || target.height <= 0) return false
  const imageRatio = image.width / image.height
  const targetRatio = target.width / target.height
  return Math.abs(imageRatio - targetRatio) / targetRatio <= SIZE_AR_TOLERANCE
}

async function getOwnedDeck(userId: number, deckId: number) {
  const [deck] = await getDb()
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1)
  if (!deck || deck.status === 'deleted') {
    throw new StyleLibraryError('deck 不存在', 404, 'deck-not-found')
  }
  return deck
}

function systemPresetsForTarget(target: TargetSize): ImageStyleLibraryPreset[] {
  const summaries = new Map(listImageStylePresetSummaries().map((summary) => [summary.id, summary]))
  return listImageStyles().map((loaded) => {
    const summary = summaries.get(loaded.manifest.id)!
    return {
      ...summary,
      source: 'system' as const,
      compatible: loaded.references.some((reference) =>
        isImageStyleDimensionCompatible(reference, target),
      ),
    }
  })
}

async function userPresetsForTarget(
  userId: number,
  target: TargetSize,
): Promise<ImageStyleLibraryPreset[]> {
  const rows = await listUserStylePresets(userId)
  return rows.map((row, index) => ({
    id: row.id,
    source: 'user' as const,
    name: row.name,
    description: `我的风格 · ${row.style}`,
    category: 'saved',
    tags: [row.style],
    order: index,
    palettePolicy: normalizePalettePolicy(row.palettePolicy),
    previewUrl: `/api/style-presets/${encodeURIComponent(row.id)}/image`,
    compatible: isImageStyleDimensionCompatible(row, target),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }))
}

async function generatedCandidatesForDeck(
  userId: number,
  deckId: number,
  target: TargetSize,
): Promise<GeneratedImageStyleCandidate[]> {
  const rows = await getDb()
    .select({
      id: deckAssets.id,
      style: deckAssets.style,
      prompt: deckAssets.prompt,
      styleSource: deckAssets.styleSource,
      styleSourceId: deckAssets.styleSourceId,
      stylePalettePolicy: deckAssets.stylePalettePolicy,
      imageWidth: deckAssets.imageWidth,
      imageHeight: deckAssets.imageHeight,
    })
    .from(deckAssets)
    .where(
      and(
        eq(deckAssets.deckId, deckId),
        eq(deckAssets.userId, userId),
        or(
          inArray(deckAssets.purpose, ['mood-board-candidate', 'anchor']),
          and(eq(deckAssets.purpose, 'style-preset-anchor'), eq(deckAssets.styleSource, 'explore')),
        ),
      ),
    )
    // 三张并发落库常共享同一秒 timestamp；加 id tie-breaker，避免保存/刷新后卡片乱序。
    .orderBy(asc(deckAssets.createdAt), asc(deckAssets.id))

  return rows.map((row) => ({
    assetId: row.id,
    source: 'explore',
    style: row.style ?? '自定义风格',
    prompt: row.prompt ?? '',
    palettePolicy: normalizePalettePolicy(row.stylePalettePolicy),
    previewUrl: `/api/assets/${row.id}`,
    // Legacy Phase 11.8 candidates did not persist dimensions, but were generated with the
    // current template size. Preserve their usability instead of hiding existing data.
    compatible:
      row.imageWidth && row.imageHeight
        ? isImageStyleDimensionCompatible(
            { width: row.imageWidth, height: row.imageHeight },
            target,
          )
        : true,
    ...(row.styleSource === 'user' && row.styleSourceId
      ? { savedPresetId: row.styleSourceId }
      : {}),
  }))
}

async function resolveActiveStyle(
  userId: number,
  deck: { id: number; anchorAssetId: string | null; anchorSkipped: boolean | null },
): Promise<ActiveImageStyle> {
  if (!deck.anchorAssetId) return deck.anchorSkipped ? { mode: 'free' } : { mode: 'undecided' }
  const [asset] = await getDb()
    .select({
      id: deckAssets.id,
      styleSource: deckAssets.styleSource,
      styleSourceId: deckAssets.styleSourceId,
      stylePalettePolicy: deckAssets.stylePalettePolicy,
    })
    .from(deckAssets)
    .where(
      and(
        eq(deckAssets.id, deck.anchorAssetId),
        eq(deckAssets.deckId, deck.id),
        eq(deckAssets.userId, userId),
      ),
    )
    .limit(1)
  if (!asset) return deck.anchorSkipped ? { mode: 'free' } : { mode: 'undecided' }
  const stylePalettePolicy = normalizePalettePolicy(asset.stylePalettePolicy)
  if ((asset.styleSource === 'system' || asset.styleSource === 'user') && asset.styleSourceId) {
    return {
      mode: 'preset',
      styleSource: asset.styleSource,
      styleSourceId: asset.styleSourceId,
      anchorAssetId: asset.id,
      stylePalettePolicy,
    }
  }
  return {
    mode: 'generated',
    styleSource: 'explore',
    styleSourceId: asset.styleSourceId ?? asset.id,
    anchorAssetId: asset.id,
    stylePalettePolicy,
  }
}

export async function getImageStyleLibrary(
  userId: number,
  deckId: number,
): Promise<ImageStyleLibraryResponse> {
  const deck = await getOwnedDeck(userId, deckId)
  const target = getTemplateImageSize(deck.templateId)
  const [userPresets, generatedCandidates, active] = await Promise.all([
    userPresetsForTarget(userId, target),
    generatedCandidatesForDeck(userId, deckId, target),
    resolveActiveStyle(userId, deck),
  ])
  return {
    presets: { system: systemPresetsForTarget(target), user: userPresets },
    generatedCandidates,
    active,
    draw: getStyleExploreDrawState(userId, deckId),
    remainingExplorations: getRemainingStyleExplorations(userId, deckId),
  }
}

async function resolveSystemPreset(id: string, target: TargetSize): Promise<ResolvedPreset> {
  const loaded = getImageStyle(id)
  if (!loaded) throw new StyleLibraryError('系统风格不存在', 404, 'preset-not-found')
  const referenceIndex = loaded.references.findIndex((reference) =>
    isImageStyleDimensionCompatible(reference, target),
  )
  if (referenceIndex < 0) {
    throw new StyleLibraryError(
      '该风格参考图与当前模板图幅不兼容',
      409,
      'style-aspect-ratio-incompatible',
    )
  }
  const reference = readImageStyleReference(id, referenceIndex)
  if (!reference) throw new StyleLibraryError('系统风格参考图缺失', 500, 'reference-missing')
  return {
    source: 'system',
    sourceId: id,
    name: loaded.manifest.name,
    style: loaded.manifest.name,
    prompt: null,
    stylePrompt: loaded.manifest.stylePrompt,
    palettePolicy: loaded.manifest.palettePolicy,
    mimeType: reference.mimeType,
    data: reference.data,
    bytesSize: reference.data.length,
    width: reference.width,
    height: reference.height,
  }
}

async function resolveUserPreset(
  userId: number,
  id: string,
  target: TargetSize,
): Promise<ResolvedPreset> {
  const row = await getUserStylePreset(userId, id)
  if (!row) throw new StyleLibraryError('我的风格不存在', 404, 'preset-not-found')
  if (!isImageStyleDimensionCompatible(row, target)) {
    throw new StyleLibraryError(
      '该风格参考图与当前模板图幅不兼容',
      409,
      'style-aspect-ratio-incompatible',
    )
  }
  return {
    source: 'user',
    sourceId: row.id,
    name: row.name,
    style: row.style,
    prompt: row.prompt,
    stylePrompt: row.stylePrompt,
    palettePolicy: normalizePalettePolicy(row.palettePolicy),
    mimeType: row.mimeType,
    data: Buffer.from(row.data),
    bytesSize: row.bytesSize,
    width: row.width!,
    height: row.height!,
  }
}

async function applyResolvedPreset(args: {
  userId: number
  deckId: number
  preset: ResolvedPreset
}): Promise<ApplyImageStyleResponse> {
  const db = getDb()
  const anchorAssetId = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${decks.id} FROM ${decks} WHERE ${decks.id} = ${args.deckId} AND ${decks.userId} = ${args.userId} FOR UPDATE`,
    )
    const [deck] = await tx
      .select({
        status: decks.status,
        templateId: decks.templateId,
        anchorAssetId: decks.anchorAssetId,
      })
      .from(decks)
      .where(and(eq(decks.id, args.deckId), eq(decks.userId, args.userId)))
      .limit(1)
    if (!deck || deck.status === 'deleted') {
      throw new StyleLibraryError('deck 不存在', 404, 'deck-not-found')
    }
    if (!isImageStyleDimensionCompatible(args.preset, getTemplateImageSize(deck.templateId))) {
      throw new StyleLibraryError(
        '该风格参考图与当前模板图幅不兼容',
        409,
        'style-aspect-ratio-incompatible',
      )
    }

    const [materialized] = await tx
      .select({ id: deckAssets.id })
      .from(deckAssets)
      .where(
        and(
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
          eq(deckAssets.styleSource, args.preset.source),
          eq(deckAssets.styleSourceId, args.preset.sourceId),
        ),
      )
      .limit(1)
    const nextId = materialized?.id ?? randomUUID()
    if (!materialized) {
      await tx.insert(deckAssets).values({
        id: nextId,
        deckId: args.deckId,
        userId: args.userId,
        mimeType: args.preset.mimeType,
        bytesSize: args.preset.bytesSize,
        data: args.preset.data,
        prompt: args.preset.prompt,
        style: args.preset.style,
        purpose: 'style-preset-anchor',
        styleSource: args.preset.source,
        styleSourceId: args.preset.sourceId,
        stylePalettePolicy: args.preset.palettePolicy,
        stylePrompt: args.preset.stylePrompt,
        imageWidth: args.preset.width,
        imageHeight: args.preset.height,
      })
    }

    if (deck.anchorAssetId && deck.anchorAssetId !== nextId) {
      const [previous] = await tx
        .select({ styleSource: deckAssets.styleSource, purpose: deckAssets.purpose })
        .from(deckAssets)
        .where(
          and(
            eq(deckAssets.id, deck.anchorAssetId),
            eq(deckAssets.deckId, args.deckId),
            eq(deckAssets.userId, args.userId),
          ),
        )
        .limit(1)
      if (previous) {
        const previousPurpose =
          previous.styleSource === 'system' || previous.styleSource === 'user'
            ? 'mood-board-discarded'
            : 'mood-board-candidate'
        await tx
          .update(deckAssets)
          .set({ purpose: previousPurpose })
          .where(and(eq(deckAssets.id, deck.anchorAssetId), eq(deckAssets.deckId, args.deckId)))
      }
    }
    await tx
      .update(deckAssets)
      .set({ purpose: 'style-preset-anchor' })
      .where(and(eq(deckAssets.id, nextId), eq(deckAssets.deckId, args.deckId)))
    await tx
      .update(decks)
      .set({ anchorAssetId: nextId, anchorSkipped: true })
      .where(and(eq(decks.id, args.deckId), eq(decks.userId, args.userId)))
    return nextId
  })

  logServerEvent({
    category: 'style-library',
    event: 'preset-applied',
    userId: args.userId,
    deckId: args.deckId,
    source: args.preset.source,
    sourceId: args.preset.sourceId,
    anchorAssetId,
  })
  return {
    active: {
      mode: 'preset',
      styleSource: args.preset.source,
      styleSourceId: args.preset.sourceId,
      anchorAssetId,
      stylePalettePolicy: args.preset.palettePolicy,
    },
  }
}

async function applyExploreCandidate(args: {
  userId: number
  deckId: number
  assetId: string
}): Promise<ApplyImageStyleResponse> {
  const db = getDb()
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${decks.id} FROM ${decks} WHERE ${decks.id} = ${args.deckId} AND ${decks.userId} = ${args.userId} FOR UPDATE`,
    )
    const [deck] = await tx
      .select({
        status: decks.status,
        templateId: decks.templateId,
        anchorAssetId: decks.anchorAssetId,
      })
      .from(decks)
      .where(and(eq(decks.id, args.deckId), eq(decks.userId, args.userId)))
      .limit(1)
    if (!deck || deck.status === 'deleted') {
      throw new StyleLibraryError('deck 不存在', 404, 'deck-not-found')
    }
    const [target] = await tx
      .select({
        id: deckAssets.id,
        purpose: deckAssets.purpose,
        styleSource: deckAssets.styleSource,
        styleSourceId: deckAssets.styleSourceId,
        stylePalettePolicy: deckAssets.stylePalettePolicy,
        imageWidth: deckAssets.imageWidth,
        imageHeight: deckAssets.imageHeight,
      })
      .from(deckAssets)
      .where(
        and(
          eq(deckAssets.id, args.assetId),
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
          inArray(deckAssets.purpose, ['mood-board-candidate', 'anchor']),
        ),
      )
      .limit(1)
    if (!target) {
      throw new StyleLibraryError('AI 探索候选不存在', 404, 'candidate-not-found')
    }
    if (
      target.imageWidth &&
      target.imageHeight &&
      !isImageStyleDimensionCompatible(
        { width: target.imageWidth, height: target.imageHeight },
        getTemplateImageSize(deck.templateId),
      )
    ) {
      throw new StyleLibraryError(
        '该候选与当前模板图幅不兼容',
        409,
        'style-aspect-ratio-incompatible',
      )
    }

    if (deck.anchorAssetId && deck.anchorAssetId !== target.id) {
      const [previous] = await tx
        .select({ styleSource: deckAssets.styleSource })
        .from(deckAssets)
        .where(
          and(
            eq(deckAssets.id, deck.anchorAssetId),
            eq(deckAssets.deckId, args.deckId),
            eq(deckAssets.userId, args.userId),
          ),
        )
        .limit(1)
      if (previous) {
        await tx
          .update(deckAssets)
          .set({
            purpose:
              previous.styleSource === 'system' || previous.styleSource === 'user'
                ? 'mood-board-discarded'
                : 'mood-board-candidate',
          })
          .where(and(eq(deckAssets.id, deck.anchorAssetId), eq(deckAssets.deckId, args.deckId)))
      }
    }
    await tx
      .update(deckAssets)
      .set({ purpose: 'anchor' })
      .where(and(eq(deckAssets.id, target.id), eq(deckAssets.deckId, args.deckId)))
    await tx
      .update(decks)
      .set({ anchorAssetId: target.id, anchorSkipped: true })
      .where(and(eq(decks.id, args.deckId), eq(decks.userId, args.userId)))
    return {
      source:
        target.styleSource === 'system' || target.styleSource === 'user'
          ? target.styleSource
          : ('explore' as const),
      sourceId: target.styleSourceId ?? target.id,
      palettePolicy: normalizePalettePolicy(target.stylePalettePolicy),
    }
  })

  logServerEvent({
    category: 'style-library',
    event: 'explore-applied',
    userId: args.userId,
    deckId: args.deckId,
    assetId: args.assetId,
  })
  if (result.source === 'system' || result.source === 'user') {
    return {
      active: {
        mode: 'preset',
        styleSource: result.source,
        styleSourceId: result.sourceId,
        anchorAssetId: args.assetId,
        stylePalettePolicy: result.palettePolicy,
      },
    }
  }
  return {
    active: {
      mode: 'generated',
      styleSource: 'explore',
      styleSourceId: result.sourceId,
      anchorAssetId: args.assetId,
      stylePalettePolicy: result.palettePolicy,
    },
  }
}

export async function applyImageStyle(
  userId: number,
  deckId: number,
  input: ApplyImageStyleRequest,
): Promise<ApplyImageStyleResponse> {
  const deck = await getOwnedDeck(userId, deckId)
  const target = getTemplateImageSize(deck.templateId)
  if (input.source === 'explore') {
    return applyExploreCandidate({ userId, deckId, assetId: input.id })
  }
  const preset =
    input.source === 'system'
      ? await resolveSystemPreset(input.id, target)
      : await resolveUserPreset(userId, input.id, target)
  const response = await applyResolvedPreset({ userId, deckId, preset })
  if (preset.source === 'user') {
    const { touchUserStylePreset } = await import('../db/user-style-presets.js')
    await touchUserStylePreset(userId, preset.sourceId)
  }
  return response
}

export async function selectFreeImageStyle(userId: number, deckId: number): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${decks.id} FROM ${decks} WHERE ${decks.id} = ${deckId} AND ${decks.userId} = ${userId} FOR UPDATE`,
    )
    const [deck] = await tx
      .select({ status: decks.status, anchorAssetId: decks.anchorAssetId })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1)
    if (!deck || deck.status === 'deleted') {
      throw new StyleLibraryError('deck 不存在', 404, 'deck-not-found')
    }
    if (deck.anchorAssetId) {
      const [asset] = await tx
        .select({ styleSource: deckAssets.styleSource })
        .from(deckAssets)
        .where(
          and(
            eq(deckAssets.id, deck.anchorAssetId),
            eq(deckAssets.deckId, deckId),
            eq(deckAssets.userId, userId),
          ),
        )
        .limit(1)
      if (asset) {
        await tx
          .update(deckAssets)
          .set({
            purpose:
              asset.styleSource === 'system' || asset.styleSource === 'user'
                ? 'mood-board-discarded'
                : 'mood-board-candidate',
          })
          .where(and(eq(deckAssets.id, deck.anchorAssetId), eq(deckAssets.deckId, deckId)))
      }
    }
    await tx
      .update(decks)
      .set({ anchorAssetId: null, anchorSkipped: true })
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
  })
  logServerEvent({
    category: 'style-library',
    event: 'free-selected',
    userId,
    deckId,
  })
}

export async function saveImageStylePreset(args: {
  userId: number
  deckId: number
  assetId: string
  name?: string
}): Promise<SaveImageStylePresetResponse> {
  const row = await saveUserStylePresetFromAsset(args)
  logServerEvent({
    category: 'style-library',
    event: 'preset-saved',
    userId: args.userId,
    deckId: args.deckId,
    assetId: args.assetId,
    presetId: row.id,
    bytesSize: row.bytesSize,
  })
  return {
    preset: {
      id: row.id,
      source: 'user',
      name: row.name,
      description: `我的风格 · ${row.style}`,
      category: 'saved',
      tags: [row.style],
      order: 0,
      palettePolicy: normalizePalettePolicy(row.palettePolicy),
      previewUrl: `/api/style-presets/${encodeURIComponent(row.id)}/image`,
      compatible: true,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    },
  }
}
