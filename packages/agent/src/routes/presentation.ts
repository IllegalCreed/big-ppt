import { randomBytes } from 'node:crypto'
import type {
  LivePresentationEvent,
  LivePresentationViewPayload,
  PresentationPayload,
  PublicLiveErrorCode,
  PublicShareErrorCode,
  ShareLinkInfo,
  ShareLinkStatus,
} from '@big-ppt/shared'
import { and, eq, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { deckAssets, decks, deckVersions, getDb, shareLinks } from '../db/index.js'
import {
  createLivePresentation,
  endLivePresentation,
  getOwnerLivePresentation,
  getPublicLiveDeckId,
  getPublicLiveErrorCode,
  getPublicLivePresentation,
  parseLivePresentationSnapshot,
  subscribeToLivePresentation,
  updateLivePresentation,
} from '../live-presentation.js'
import { logServerEvent } from '../logger/server-log.js'
import type { AuthVars } from '../middleware/auth.js'

export const presentationRoute = new Hono<{ Variables: AuthVars }>()

type PresentationRow = {
  deckId: number
  title: string
  templateId: string
  markdown: string | null
  updatedAt: Date
}

function toPresentation(row: PresentationRow): PresentationPayload {
  return {
    deckId: row.deckId,
    title: row.title,
    templateId: row.templateId,
    markdown: row.markdown ?? '',
    updatedAt: row.updatedAt.toISOString(),
  }
}

function shareStatus(row: { revokedAt: Date | null; expiresAt: Date | null }): ShareLinkStatus {
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'active'
}

function toShareInfo(row: {
  slug: string
  expiresAt: Date | null
  revokedAt: Date | null
  accessCount: number
  lastAccessedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): ShareLinkInfo {
  return {
    slug: row.slug,
    path: `/share/${row.slug}`,
    status: shareStatus(row),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function publicError(code: PublicShareErrorCode): { code: PublicShareErrorCode; error: string } {
  const messages: Record<PublicShareErrorCode, string> = {
    'not-found': '分享链接不存在',
    expired: '分享链接已过期',
    revoked: '分享链接已撤销',
  }
  return { code, error: messages[code] }
}

async function getOwnedPresentation(
  userId: number,
  deckId: number,
): Promise<PresentationRow | null> {
  const [row] = await getDb()
    .select({
      deckId: decks.id,
      title: decks.title,
      templateId: decks.templateId,
      markdown: deckVersions.content,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .leftJoin(
      deckVersions,
      and(eq(deckVersions.id, decks.currentVersionId), eq(deckVersions.deckId, decks.id)),
    )
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId), ne(decks.status, 'deleted')))
    .limit(1)
  return row ?? null
}

async function getPublicShare(slug: string) {
  const [row] = await getDb()
    .select({
      id: shareLinks.id,
      slug: shareLinks.slug,
      deckId: shareLinks.deckId,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      deckStatus: decks.status,
      title: decks.title,
      templateId: decks.templateId,
      markdown: deckVersions.content,
      updatedAt: decks.updatedAt,
    })
    .from(shareLinks)
    .innerJoin(decks, eq(decks.id, shareLinks.deckId))
    .leftJoin(
      deckVersions,
      and(eq(deckVersions.id, decks.currentVersionId), eq(deckVersions.deckId, decks.id)),
    )
    .where(eq(shareLinks.slug, slug))
    .limit(1)
  return row ?? null
}

function rewritePublicAssetUrls(markdown: string, publicAssetPrefix: string): string {
  return markdown.replace(
    /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    `${publicAssetPrefix}/$1`,
  )
}

function livePublicError(code: PublicLiveErrorCode): { code: PublicLiveErrorCode; error: string } {
  const messages: Record<PublicLiveErrorCode, string> = {
    'not-found': '直播链接不存在',
    ended: '直播已结束',
    expired: '直播已过期',
  }
  return { code, error: messages[code] }
}

function livePublicErrorResponse(token: string): Response {
  const code = getPublicLiveErrorCode(token)
  return Response.json(livePublicError(code), { status: code === 'not-found' ? 404 : 410 })
}

function encodeSseEvent(event: LivePresentationEvent): Uint8Array {
  const encoder = new TextEncoder()
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

presentationRoute.get('/decks/:id{[0-9]+}/presentation', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const row = await getOwnedPresentation(user.id, Number(c.req.param('id')))
  if (!row) return c.json({ error: 'deck 不存在或无权访问' }, 404)
  return c.json({ presentation: toPresentation(row) })
})

presentationRoute.get('/decks/:id{[0-9]+}/live', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  if (!(await getOwnedPresentation(user.id, deckId))) {
    return c.json({ error: 'deck 不存在或无权访问' }, 404)
  }
  return c.json({ live: getOwnerLivePresentation(user.id, deckId) })
})

presentationRoute.post('/decks/:id{[0-9]+}/live', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  const presentation = await getOwnedPresentation(user.id, deckId)
  if (!presentation) return c.json({ error: 'deck 不存在或无权访问' }, 404)

  const body = await c.req.json<{ state?: unknown }>().catch(() => null)
  const state = parseLivePresentationSnapshot(body?.state)
  if (!state) return c.json({ error: '直播状态格式不合法' }, 400)

  const created = createLivePresentation({
    userId: user.id,
    presentation: toPresentation(presentation),
    state,
  })
  return c.json({ live: created.info, replaced: created.replaced }, 201)
})

presentationRoute.put('/decks/:id{[0-9]+}/live/:token/state', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  const body = await c.req.json<{ state?: unknown }>().catch(() => null)
  const state = parseLivePresentationSnapshot(body?.state)
  if (!state) return c.json({ error: '直播状态格式不合法' }, 400)

  const revision = updateLivePresentation(user.id, deckId, c.req.param('token'), state)
  if (revision === null) return c.json({ error: '直播未开始或已结束' }, 409)
  return c.json({ ok: true, revision })
})

presentationRoute.delete('/decks/:id{[0-9]+}/live/:token', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  return c.json({
    ok: true,
    ended: endLivePresentation(user.id, Number(c.req.param('id')), c.req.param('token')),
  })
})

presentationRoute.get('/decks/:id{[0-9]+}/share', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  if (!(await getOwnedPresentation(user.id, deckId))) {
    return c.json({ error: 'deck 不存在或无权访问' }, 404)
  }

  const [link] = await getDb()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.deckId, deckId), eq(shareLinks.userId, user.id)))
    .limit(1)
  return c.json({ share: link ? toShareInfo(link) : null })
})

presentationRoute.post('/decks/:id{[0-9]+}/share', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  const presentation = await getOwnedPresentation(user.id, deckId)
  if (!presentation) return c.json({ error: 'deck 不存在或无权访问' }, 404)

  type Body = { expiresInDays?: number | null }
  const body = await c.req.json<Body>().catch((): Body => ({}))
  const days = body.expiresInDays ?? null
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
    return c.json({ error: 'expiresInDays 必须是 1..365 的整数或 null' }, 400)
  }

  const now = new Date()
  const expiresAt = days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const slug = randomBytes(24).toString('base64url')
  const db = getDb()
  const [existing] = await db
    .select({ id: shareLinks.id })
    .from(shareLinks)
    .where(and(eq(shareLinks.deckId, deckId), eq(shareLinks.userId, user.id)))
    .limit(1)

  if (existing) {
    await db
      .update(shareLinks)
      .set({ slug, expiresAt, revokedAt: null, accessCount: 0, lastAccessedAt: null })
      .where(and(eq(shareLinks.id, existing.id), eq(shareLinks.userId, user.id)))
  } else {
    await db.insert(shareLinks).values({ slug, deckId, userId: user.id, expiresAt })
  }

  const [created] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.deckId, deckId), eq(shareLinks.userId, user.id)))
    .limit(1)
  if (!created) return c.json({ error: '分享链接创建失败' }, 500)

  logServerEvent({
    category: 'share-link',
    event: existing ? 'rotated' : 'created',
    deckId,
    userId: user.id,
  })
  return c.json({ share: toShareInfo(created) }, existing ? 200 : 201)
})

presentationRoute.delete('/decks/:id{[0-9]+}/share', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  if (!(await getOwnedPresentation(user.id, deckId))) {
    return c.json({ error: 'deck 不存在或无权访问' }, 404)
  }

  await getDb()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.deckId, deckId), eq(shareLinks.userId, user.id)))
  logServerEvent({ category: 'share-link', event: 'revoked', deckId, userId: user.id })
  return c.json({ ok: true })
})

presentationRoute.get('/share/:slug/presentation', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  const slug = c.req.param('slug')
  const row = await getPublicShare(slug)
  if (!row || row.deckStatus === 'deleted') return c.json(publicError('not-found'), 404)

  const status = shareStatus(row)
  if (status !== 'active') return c.json(publicError(status), 410)

  const now = new Date()
  await getDb()
    .update(shareLinks)
    .set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: now })
    .where(eq(shareLinks.id, row.id))

  return c.json({
    presentation: {
      ...toPresentation(row),
      markdown: rewritePublicAssetUrls(row.markdown ?? '', `/api/share/${slug}/assets`),
    },
  })
})

presentationRoute.get('/share/:slug/assets/:assetId', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  const row = await getPublicShare(c.req.param('slug'))
  if (!row || row.deckStatus === 'deleted') return c.json(publicError('not-found'), 404)
  const status = shareStatus(row)
  if (status !== 'active') return c.json(publicError(status), 410)

  const [asset] = await getDb()
    .select({
      data: deckAssets.data,
      mimeType: deckAssets.mimeType,
      bytesSize: deckAssets.bytesSize,
    })
    .from(deckAssets)
    .where(and(eq(deckAssets.id, c.req.param('assetId')), eq(deckAssets.deckId, row.deckId)))
    .limit(1)
  if (!asset) return c.json({ error: 'not found' }, 404)

  const body = new Uint8Array(asset.data.byteLength)
  body.set(asset.data)
  return new Response(body, {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.bytesSize),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

presentationRoute.get('/live/:token/presentation', (c) => {
  c.header('Cache-Control', 'private, no-store')
  const token = c.req.param('token')
  const session = getPublicLivePresentation(token)
  if (!session) return livePublicErrorResponse(token)

  const live: LivePresentationViewPayload = {
    presentation: {
      ...session.presentation,
      markdown: rewritePublicAssetUrls(session.presentation.markdown, `/api/live/${token}/assets`),
    },
    state: session.state,
    revision: session.revision,
    expiresAt: session.expiresAt.toISOString(),
  }
  return c.json({ live })
})

presentationRoute.get('/live/:token/events', (c) => {
  const token = c.req.param('token')
  if (getPublicLiveDeckId(token) === null) return livePublicErrorResponse(token)

  const signal = c.req.raw.signal
  let cleanup = (): void => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | null = null
      let unsubscribe: (() => void) | null = null

      const onAbort = () => cleanup()
      cleanup = () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe?.()
        signal.removeEventListener('abort', onAbort)
      }
      const send = (event: LivePresentationEvent) => {
        if (closed) return
        try {
          controller.enqueue(encodeSseEvent(event))
          if (event.type === 'ended') {
            controller.close()
            cleanup()
          }
        } catch {
          cleanup()
        }
      }

      controller.enqueue(new TextEncoder().encode('retry: 2000\n\n'))
      unsubscribe = subscribeToLivePresentation(token, send)
      if (!unsubscribe) {
        controller.close()
        cleanup()
        return
      }
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'))
      }, 15_000)
      heartbeat.unref?.()
      signal.addEventListener('abort', onAbort, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    },
  })
})

presentationRoute.get('/live/:token/assets/:assetId', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  const token = c.req.param('token')
  const deckId = getPublicLiveDeckId(token)
  if (deckId === null) return livePublicErrorResponse(token)

  const [asset] = await getDb()
    .select({
      data: deckAssets.data,
      mimeType: deckAssets.mimeType,
      bytesSize: deckAssets.bytesSize,
    })
    .from(deckAssets)
    .where(and(eq(deckAssets.id, c.req.param('assetId')), eq(deckAssets.deckId, deckId)))
    .limit(1)
  if (!asset) return c.json({ error: 'not found' }, 404)

  const body = new Uint8Array(asset.data.byteLength)
  body.set(asset.data)
  return new Response(body, {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.bytesSize),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
