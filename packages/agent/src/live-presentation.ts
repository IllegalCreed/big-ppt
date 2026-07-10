import { randomBytes } from 'node:crypto'
import type {
  LivePresentationEndReason,
  LivePresentationEvent,
  LivePresentationInfo,
  PresentationPayload,
  PresentationSnapshot,
  PublicLiveErrorCode,
} from '@big-ppt/shared'
import { z } from 'zod'
import { logServerEvent } from './logger/server-log.js'

const LIVE_SESSION_TTL_MS = 8 * 60 * 60 * 1000
const TOMBSTONE_TTL_MS = 60 * 60 * 1000
const MAX_DRAWING_PAGES = 500
const MAX_TOTAL_STROKES = 5_000
const MAX_TOTAL_POINTS = 100_000

type LiveListener = (event: LivePresentationEvent) => void

interface LiveSession {
  token: string
  userId: number
  deckId: number
  presentation: PresentationPayload
  state: PresentationSnapshot
  revision: number
  createdAt: Date
  expiresAt: Date
  listeners: Set<LiveListener>
  expiryTimer: ReturnType<typeof setTimeout>
}

export interface LivePresentationRecord {
  token: string
  userId: number
  deckId: number
  presentation: PresentationPayload
  state: PresentationSnapshot
  revision: number
  createdAt: Date
  expiresAt: Date
}

const sessionsByToken = new Map<string, LiveSession>()
const tokensByOwnerDeck = new Map<string, string>()
const tombstones = new Map<
  string,
  { code: Exclude<PublicLiveErrorCode, 'not-found'>; purgeAt: number }
>()

const pointSchema = z
  .object({
    x: z.number().finite().min(0).max(1000),
    y: z.number().finite().min(0).max(562.5),
  })
  .strict()

const strokeSchema = z
  .object({
    id: z.string().min(1).max(100),
    tool: z.enum(['pen', 'highlighter']),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    width: z.number().finite().min(1).max(100),
    points: z.array(pointSchema).min(1).max(2_000),
  })
  .strict()

const snapshotSchema = z
  .object({
    page: z.number().int().min(1).max(10_000),
    blackout: z.enum(['none', 'black', 'white']),
    drawings: z.record(
      z.string().regex(/^(?:[1-9]\d{0,3}|10000)$/),
      z.array(strokeSchema).max(500),
    ),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const pages = Object.values(snapshot.drawings)
    if (pages.length > MAX_DRAWING_PAGES) {
      context.addIssue({ code: 'custom', message: 'drawings 页数过多', path: ['drawings'] })
      return
    }
    const totalStrokes = pages.reduce((total, strokes) => total + strokes.length, 0)
    if (totalStrokes > MAX_TOTAL_STROKES) {
      context.addIssue({ code: 'custom', message: 'drawings 笔迹过多', path: ['drawings'] })
      return
    }
    const totalPoints = pages.reduce(
      (total, strokes) =>
        total + strokes.reduce((strokeTotal, stroke) => strokeTotal + stroke.points.length, 0),
      0,
    )
    if (totalPoints > MAX_TOTAL_POINTS) {
      context.addIssue({ code: 'custom', message: 'drawings 点数过多', path: ['drawings'] })
    }
  })

function ownerDeckKey(userId: number, deckId: number): string {
  return `${userId}:${deckId}`
}

function cloneSnapshot(snapshot: PresentationSnapshot): PresentationSnapshot {
  return {
    page: snapshot.page,
    blackout: snapshot.blackout,
    drawings: Object.fromEntries(
      Object.entries(snapshot.drawings).map(([page, strokes]) => [
        page,
        strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({ ...point })),
        })),
      ]),
    ),
  }
}

function toRecord(session: LiveSession): LivePresentationRecord {
  return {
    token: session.token,
    userId: session.userId,
    deckId: session.deckId,
    presentation: { ...session.presentation },
    state: cloneSnapshot(session.state),
    revision: session.revision,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
  }
}

function toInfo(session: LiveSession): LivePresentationInfo {
  return {
    token: session.token,
    path: `/live/${session.token}`,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  }
}

function purgeTombstones(now = Date.now()): void {
  for (const [token, tombstone] of tombstones) {
    if (tombstone.purgeAt <= now) tombstones.delete(token)
  }
}

function emitToListeners(session: LiveSession, event: LivePresentationEvent): void {
  for (const listener of session.listeners) {
    try {
      listener(event)
    } catch {
      session.listeners.delete(listener)
    }
  }
}

function closeSession(session: LiveSession, reason: LivePresentationEndReason): void {
  if (!sessionsByToken.delete(session.token)) return
  const key = ownerDeckKey(session.userId, session.deckId)
  if (tokensByOwnerDeck.get(key) === session.token) tokensByOwnerDeck.delete(key)
  clearTimeout(session.expiryTimer)

  const event: LivePresentationEvent = { type: 'ended', reason }
  emitToListeners(session, event)
  session.listeners.clear()
  tombstones.set(session.token, {
    code: reason === 'expired' ? 'expired' : 'ended',
    purgeAt: Date.now() + TOMBSTONE_TTL_MS,
  })
  logServerEvent({
    category: 'live-presentation',
    event: reason,
    deckId: session.deckId,
    userId: session.userId,
  })
}

function getSession(token: string): LiveSession | null {
  const session = sessionsByToken.get(token)
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    closeSession(session, 'expired')
    return null
  }
  return session
}

export function parseLivePresentationSnapshot(value: unknown): PresentationSnapshot | null {
  const result = snapshotSchema.safeParse(value)
  return result.success ? cloneSnapshot(result.data as PresentationSnapshot) : null
}

export function createLivePresentation(input: {
  userId: number
  presentation: PresentationPayload
  state: PresentationSnapshot
}): { info: LivePresentationInfo; replaced: boolean } {
  purgeTombstones()
  const key = ownerDeckKey(input.userId, input.presentation.deckId)
  const existingToken = tokensByOwnerDeck.get(key)
  const existing = existingToken ? getSession(existingToken) : null
  if (existing) closeSession(existing, 'replaced')

  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + LIVE_SESSION_TTL_MS)
  const session: LiveSession = {
    token,
    userId: input.userId,
    deckId: input.presentation.deckId,
    presentation: { ...input.presentation },
    state: cloneSnapshot(input.state),
    revision: 1,
    createdAt,
    expiresAt,
    listeners: new Set(),
    expiryTimer: setTimeout(() => closeSession(session, 'expired'), LIVE_SESSION_TTL_MS),
  }
  session.expiryTimer.unref?.()
  sessionsByToken.set(token, session)
  tokensByOwnerDeck.set(key, token)
  logServerEvent({
    category: 'live-presentation',
    event: 'started',
    deckId: session.deckId,
    userId: session.userId,
    replaced: Boolean(existing),
  })
  return { info: toInfo(session), replaced: Boolean(existing) }
}

export function getOwnerLivePresentation(
  userId: number,
  deckId: number,
): LivePresentationInfo | null {
  const token = tokensByOwnerDeck.get(ownerDeckKey(userId, deckId))
  const session = token ? getSession(token) : null
  return session ? toInfo(session) : null
}

export function updateLivePresentation(
  userId: number,
  deckId: number,
  token: string,
  state: PresentationSnapshot,
): number | null {
  if (tokensByOwnerDeck.get(ownerDeckKey(userId, deckId)) !== token) return null
  const session = getSession(token)
  if (!session) return null
  session.state = cloneSnapshot(state)
  session.revision++
  const event: LivePresentationEvent = {
    type: 'state',
    state: cloneSnapshot(session.state),
    revision: session.revision,
  }
  emitToListeners(session, event)
  return session.revision
}

export function endLivePresentation(userId: number, deckId: number, token: string): boolean {
  if (tokensByOwnerDeck.get(ownerDeckKey(userId, deckId)) !== token) return false
  const session = getSession(token)
  if (!session) return false
  closeSession(session, 'ended')
  return true
}

export function endOwnerDeckLivePresentation(userId: number, deckId: number): boolean {
  const token = tokensByOwnerDeck.get(ownerDeckKey(userId, deckId))
  const session = token ? getSession(token) : null
  if (!session) return false
  closeSession(session, 'ended')
  return true
}

export function getPublicLivePresentation(token: string): LivePresentationRecord | null {
  const session = getSession(token)
  return session ? toRecord(session) : null
}

export function getPublicLiveDeckId(token: string): number | null {
  return getSession(token)?.deckId ?? null
}

export function getPublicLiveErrorCode(token: string): PublicLiveErrorCode {
  purgeTombstones()
  return tombstones.get(token)?.code ?? 'not-found'
}

export function subscribeToLivePresentation(
  token: string,
  listener: LiveListener,
): (() => void) | null {
  const session = getSession(token)
  if (!session) return null
  session.listeners.add(listener)
  try {
    listener({ type: 'state', state: cloneSnapshot(session.state), revision: session.revision })
  } catch {
    session.listeners.delete(listener)
    return null
  }
  return () => session.listeners.delete(listener)
}

export function __resetLivePresentationsForTesting(): void {
  for (const session of sessionsByToken.values()) {
    clearTimeout(session.expiryTimer)
    emitToListeners(session, { type: 'ended', reason: 'ended' })
    session.listeners.clear()
  }
  sessionsByToken.clear()
  tokensByOwnerDeck.clear()
  tombstones.clear()
}
