/** Phase 17: optional AI style exploration background job (single-flight per user+deck). */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ImageStyleDrawState } from '@big-ppt/shared'
import { getDb } from '../db/client.js'
import { discardAssets } from '../db/deck-assets.js'
import { deckAssets, decks, deckVersions } from '../db/schema.js'
import { logServerEvent } from '../logger/server-log.js'
import { generateMoodBoard } from '../mood-board/index.js'

export const MAX_STYLE_EXPLORATIONS_PER_DECK = 3

export class StyleExploreRunningError extends Error {
  constructor() {
    super('当前 deck 已有 AI 风格探索在运行')
    this.name = 'StyleExploreRunningError'
  }
}

export class StyleExploreLimitError extends Error {
  constructor() {
    super(`本 deck 已达到 ${MAX_STYLE_EXPLORATIONS_PER_DECK} 次 AI 探索上限`)
    this.name = 'StyleExploreLimitError'
  }
}

export class StyleExploreDeckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StyleExploreDeckError'
  }
}

interface StyleExploreJob {
  id: string
  userId: number
  deckId: number
  state: 'running' | 'failed' | 'done'
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  controller: AbortController
}

const jobsByDeck = new Map<string, StyleExploreJob>()
const explorationCountByDeck = new Map<string, number>()
const startingKeys = new Set<string>()

function deckKey(userId: number, deckId: number): string {
  return `${userId}:${deckId}`
}

export function getStyleExploreDrawState(userId: number, deckId: number): ImageStyleDrawState {
  const job = jobsByDeck.get(deckKey(userId, deckId))
  if (!job) {
    return { state: 'idle', jobId: null, startedAt: null, finishedAt: null, error: null }
  }
  return {
    state: job.state,
    jobId: job.id,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
  }
}

export function getRemainingStyleExplorations(userId: number, deckId: number): number {
  const used = explorationCountByDeck.get(deckKey(userId, deckId)) ?? 0
  return Math.max(0, MAX_STYLE_EXPLORATIONS_PER_DECK - used)
}

async function promoteCompletedBatch(args: {
  userId: number
  deckId: number
  assetIds: string[]
}): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    // Serialize with apply/free. Existing active anchor is deliberately not discarded.
    await tx.execute(
      sql`SELECT ${decks.id} FROM ${decks} WHERE ${decks.id} = ${args.deckId} AND ${decks.userId} = ${args.userId} FOR UPDATE`,
    )
    const [deck] = await tx
      .select({ status: decks.status })
      .from(decks)
      .where(and(eq(decks.id, args.deckId), eq(decks.userId, args.userId)))
      .limit(1)
    if (!deck || deck.status === 'deleted') {
      throw new StyleExploreDeckError('deck 已删除')
    }

    // Two-phase replacement: only after all three images succeeded do old, non-active
    // candidates disappear. A failed exploration therefore never destroys usable choices.
    await tx
      .update(deckAssets)
      .set({ purpose: 'mood-board-discarded' })
      .where(
        and(
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
          eq(deckAssets.purpose, 'mood-board-candidate'),
        ),
      )
    await tx
      .update(deckAssets)
      .set({ purpose: 'mood-board-candidate' })
      .where(
        and(
          eq(deckAssets.deckId, args.deckId),
          eq(deckAssets.userId, args.userId),
          eq(deckAssets.purpose, 'mood-board-staging'),
          inArray(deckAssets.id, args.assetIds),
        ),
      )
  })
}

async function runStyleExploreJob(
  job: StyleExploreJob,
  input: { content: string; templateId: string },
): Promise<void> {
  logServerEvent({
    category: 'style-library',
    event: 'explore-running',
    jobId: job.id,
    deckId: job.deckId,
    userId: job.userId,
  })

  let stagedIds: string[] = []
  try {
    const result = await generateMoodBoard({
      deckId: job.deckId,
      userId: job.userId,
      deckContent: input.content,
      templateId: input.templateId,
      staging: true,
      signal: job.controller.signal,
    })
    stagedIds = result.candidates.map((candidate) => candidate.assetId)
    if (job.controller.signal.aborted) throw new Error('探索已取消')
    await promoteCompletedBatch({ userId: job.userId, deckId: job.deckId, assetIds: stagedIds })

    job.state = 'done'
    job.finishedAt = new Date()
    logServerEvent({
      category: 'style-library',
      event: 'explore-done',
      jobId: job.id,
      deckId: job.deckId,
      userId: job.userId,
      assetIds: stagedIds,
    })
  } catch (err) {
    if (stagedIds.length > 0) await discardAssets(stagedIds).catch(() => {})
    job.state = 'failed'
    job.error = (err as Error).message
    job.finishedAt = new Date()
    logServerEvent({
      category: 'style-library',
      event: 'explore-failed',
      jobId: job.id,
      deckId: job.deckId,
      userId: job.userId,
      errorMsg: job.error,
    })
  }
}

export async function startStyleExploreJob(
  userId: number,
  deckId: number,
): Promise<{ jobId: string; state: 'running' }> {
  const key = deckKey(userId, deckId)
  const existing = jobsByDeck.get(key)
  if (startingKeys.has(key) || existing?.state === 'running') {
    throw new StyleExploreRunningError()
  }
  if (getRemainingStyleExplorations(userId, deckId) <= 0) {
    throw new StyleExploreLimitError()
  }

  startingKeys.add(key)
  try {
    const db = getDb()
    const [deck] = await db
      .select({
        status: decks.status,
        templateId: decks.templateId,
        currentVersionId: decks.currentVersionId,
      })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1)
    if (!deck || deck.status === 'deleted') throw new StyleExploreDeckError('deck 不存在')
    if (!deck.currentVersionId) throw new StyleExploreDeckError('deck 内容为空')
    const [version] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(and(eq(deckVersions.id, deck.currentVersionId), eq(deckVersions.deckId, deckId)))
      .limit(1)
    if (!version?.content.trim()) throw new StyleExploreDeckError('deck 内容为空')

    // Recheck after DB awaits; startingKeys kept concurrent requests out meanwhile.
    const current = jobsByDeck.get(key)
    if (current?.state === 'running') throw new StyleExploreRunningError()

    const job: StyleExploreJob = {
      id: randomUUID(),
      userId,
      deckId,
      state: 'running',
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      controller: new AbortController(),
    }
    jobsByDeck.set(key, job)
    explorationCountByDeck.set(key, (explorationCountByDeck.get(key) ?? 0) + 1)
    logServerEvent({
      category: 'style-library',
      event: 'explore-enqueued',
      jobId: job.id,
      deckId,
      userId,
      attempt: explorationCountByDeck.get(key),
    })
    void runStyleExploreJob(job, { content: version.content, templateId: deck.templateId })
    return { jobId: job.id, state: 'running' }
  } finally {
    startingKeys.delete(key)
  }
}

export function cancelStyleExploreForDeck(userId: number, deckId: number): void {
  const key = deckKey(userId, deckId)
  const job = jobsByDeck.get(key)
  if (!job || job.state !== 'running') return
  job.controller.abort()
  job.state = 'failed'
  job.error = 'deck 已删除，探索已取消'
  job.finishedAt = new Date()
  logServerEvent({
    category: 'style-library',
    event: 'explore-cancelled',
    jobId: job.id,
    deckId,
    userId,
  })
}

export function __resetStyleExploreJobsForTesting(): void {
  for (const job of jobsByDeck.values()) job.controller.abort()
  jobsByDeck.clear()
  explorationCountByDeck.clear()
  startingKeys.clear()
}
