import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PresentationSnapshot } from '@big-ppt/shared'
import { describe, expect, it } from 'vitest'
import { createAsset } from '../src/db/deck-assets.js'
import { decks, deckVersions, getDb, shareLinks } from '../src/db/index.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { presentationRoute } from '../src/routes/presentation.js'
import { createDeckDirect, createLoggedInUser } from './_setup/factories.js'
import { useTestDb } from './_setup/test-db.js'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', presentationRoute)
  return app
}

function jsonRequest(method: string, body?: unknown, cookie?: string): RequestInit {
  return {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function createShare(
  app: Hono,
  deckId: number,
  cookie: string,
  expiresInDays: number | null = 7,
) {
  const res = await app.request(
    `/api/decks/${deckId}/share`,
    jsonRequest('POST', { expiresInDays }, cookie),
  )
  expect([200, 201]).toContain(res.status)
  return (await res.json()).share as { slug: string; path: string; status: string }
}

function liveState(page = 1): PresentationSnapshot {
  return { page, blackout: 'none', drawings: {} }
}

async function createLive(app: Hono, deckId: number, cookie: string, state = liveState()) {
  const res = await app.request(`/api/decks/${deckId}/live`, jsonRequest('POST', { state }, cookie))
  expect(res.status).toBe(201)
  return (await res.json()).live as { token: string; path: string; expiresAt: string }
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error(`SSE 在 ${eventName} 事件前结束`)
    buffer += decoder.decode(chunk.value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const lines = frame.split('\n')
      if (lines.find((line) => line === `event: ${eventName}`)) {
        const data = lines.find((line) => line.startsWith('data: '))
        if (!data) throw new Error(`SSE ${eventName} 缺少 data`)
        return JSON.parse(data.slice(6)) as Record<string, unknown>
      }
    }
  }
}

describe('presentation routes', () => {
  it('owner presentation/share 管理端点未登录均返回 401', async () => {
    const app = makeApp()
    const results = await Promise.all([
      app.request('/api/decks/1/presentation'),
      app.request('/api/decks/1/share'),
      app.request('/api/decks/1/share', jsonRequest('POST', { expiresInDays: 7 })),
      app.request('/api/decks/1/share', jsonRequest('DELETE')),
      app.request('/api/decks/1/live'),
      app.request('/api/decks/1/live', jsonRequest('POST', { state: liveState() })),
      app.request('/api/decks/1/live/token/state', jsonRequest('PUT', { state: liveState() })),
      app.request('/api/decks/1/live/token', jsonRequest('DELETE')),
    ])
    expect(results.map((res) => res.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401])
  })

  it('owner presentation 返回当前版本稳定契约', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const markdown = '---\nlayout: beitou-cover\nmainTitle: Phase 16\n---\n'
    const { deck } = await createDeckDirect(owner.user.id, 'Presentation Deck', markdown)

    const res = await app.request(`/api/decks/${deck.id}/presentation`, {
      headers: { Cookie: owner.cookie },
    })
    expect(res.status).toBe(200)
    const { presentation } = await res.json()
    expect(presentation).toMatchObject({
      deckId: deck.id,
      title: 'Presentation Deck',
      templateId: 'beitou-standard',
      markdown,
    })
    expect(new Date(presentation.updatedAt).toString()).not.toBe('Invalid Date')
  })

  it('owner presentation/share 管理均以 userId + deckId 隔离', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('owner-a@example.com')
    const b = await createLoggedInUser('owner-b@example.com')
    const { deck } = await createDeckDirect(a.user.id, 'A')

    const attempts = await Promise.all([
      app.request(`/api/decks/${deck.id}/presentation`, { headers: { Cookie: b.cookie } }),
      app.request(`/api/decks/${deck.id}/share`, { headers: { Cookie: b.cookie } }),
      app.request(
        `/api/decks/${deck.id}/share`,
        jsonRequest('POST', { expiresInDays: 7 }, b.cookie),
      ),
      app.request(`/api/decks/${deck.id}/share`, jsonRequest('DELETE', undefined, b.cookie)),
    ])
    expect(attempts.map((res) => res.status)).toEqual([404, 404, 404, 404])

    const links = await getDb().select().from(shareLinks)
    expect(links).toEqual([])
  })

  it('创建、查询、旋转和撤销分享链接保持单行生命周期', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const { deck } = await createDeckDirect(owner.user.id)

    const first = await createShare(app, deck.id, owner.cookie, 7)
    expect(first.path).toBe(`/share/${first.slug}`)
    expect(first.status).toBe('active')

    const listed = await app.request(`/api/decks/${deck.id}/share`, {
      headers: { Cookie: owner.cookie },
    })
    expect((await listed.json()).share.slug).toBe(first.slug)

    const second = await createShare(app, deck.id, owner.cookie, null)
    expect(second.slug).not.toBe(first.slug)
    expect(await getDb().select().from(shareLinks)).toHaveLength(1)
    expect((await app.request(`/api/share/${first.slug}/presentation`)).status).toBe(404)

    const revoked = await app.request(
      `/api/decks/${deck.id}/share`,
      jsonRequest('DELETE', undefined, owner.cookie),
    )
    expect(revoked.status).toBe(200)
    const publicAfterRevoke = await app.request(`/api/share/${second.slug}/presentation`)
    expect(publicAfterRevoke.status).toBe(410)
    expect(await publicAfterRevoke.json()).toMatchObject({ code: 'revoked' })
  })

  it('拒绝非法 expiresInDays 且不落库', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const { deck } = await createDeckDirect(owner.user.id)

    for (const value of [0, 366, 1.5, '7']) {
      const res = await app.request(
        `/api/decks/${deck.id}/share`,
        jsonRequest('POST', { expiresInDays: value }, owner.cookie),
      )
      expect(res.status).toBe(400)
    }
    expect(await getDb().select().from(shareLinks)).toEqual([])
  })

  it('公开 presentation 无需登录、改写 asset URL 并累计访问次数', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(owner.user.id)
    const asset = await createAsset({
      deckId: deck.id,
      userId: owner.user.id,
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3]),
    })
    const markdown = `---\nlayout: beitou-image-content\nimageSrc: /api/assets/${asset.id}\n---\n`
    const db = getDb()
    await db
      .update(deckVersions)
      .set({ content: markdown })
      .where(eq(deckVersions.id, initialVersionId))

    const share = await createShare(app, deck.id, owner.cookie)
    const res = await app.request(`/api/share/${share.slug}/presentation`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const payload = (await res.json()).presentation
    expect(payload.markdown).toContain(`/api/share/${share.slug}/assets/${asset.id}`)
    expect(payload.markdown).not.toContain(`/api/assets/${asset.id}`)

    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.slug, share.slug))
    expect(row?.accessCount).toBe(1)
    expect(row?.lastAccessedAt).toBeInstanceOf(Date)
  })

  it('公开链接准确区分不存在、过期、撤销和已删除 deck', async () => {
    const app = makeApp()
    expect(await (await app.request('/api/share/missing/presentation')).json()).toMatchObject({
      code: 'not-found',
    })

    const owner = await createLoggedInUser()
    const { deck } = await createDeckDirect(owner.user.id)
    const expired = await createShare(app, deck.id, owner.cookie)
    await getDb()
      .update(shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(shareLinks.slug, expired.slug))
    const expiredRes = await app.request(`/api/share/${expired.slug}/presentation`)
    expect(expiredRes.status).toBe(410)
    expect(await expiredRes.json()).toMatchObject({ code: 'expired' })

    const active = await createShare(app, deck.id, owner.cookie)
    await getDb().update(decks).set({ status: 'deleted' }).where(eq(decks.id, deck.id))
    const deletedRes = await app.request(`/api/share/${active.slug}/presentation`)
    expect(deletedRes.status).toBe(404)
    expect(await deletedRes.json()).toMatchObject({ code: 'not-found' })
  })

  it('公开 asset 只允许当前分享 deck 的字节，撤销后立即失效且禁止缓存', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const { deck: sharedDeck } = await createDeckDirect(owner.user.id, 'Shared')
    const { deck: otherDeck } = await createDeckDirect(owner.user.id, 'Other')
    const ownAsset = await createAsset({
      deckId: sharedDeck.id,
      userId: owner.user.id,
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3, 4]),
    })
    const otherAsset = await createAsset({
      deckId: otherDeck.id,
      userId: owner.user.id,
      mimeType: 'image/png',
      data: Buffer.from([9, 9, 9]),
    })
    const share = await createShare(app, sharedDeck.id, owner.cookie)

    const own = await app.request(`/api/share/${share.slug}/assets/${ownAsset.id}`)
    expect(own.status).toBe(200)
    expect(own.headers.get('cache-control')).toBe('private, no-store')
    expect([...new Uint8Array(await own.arrayBuffer())]).toEqual([1, 2, 3, 4])

    const crossDeck = await app.request(`/api/share/${share.slug}/assets/${otherAsset.id}`)
    expect(crossDeck.status).toBe(404)

    await getDb()
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLinks.slug, share.slug), eq(shareLinks.deckId, sharedDeck.id)))
    const revoked = await app.request(`/api/share/${share.slug}/assets/${ownAsset.id}`)
    expect(revoked.status).toBe(410)
    expect(await revoked.json()).toMatchObject({ code: 'revoked' })
  })

  it('直播链接公开只读，SSE 同步状态并在演讲者结束后立即关闭', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const outsider = await createLoggedInUser('live-outsider@example.com')
    const { deck, initialVersionId } = await createDeckDirect(owner.user.id, 'Live Deck')
    const asset = await createAsset({
      deckId: deck.id,
      userId: owner.user.id,
      mimeType: 'image/png',
      data: Buffer.from([4, 3, 2, 1]),
    })
    await getDb()
      .update(deckVersions)
      .set({
        content: `---\nlayout: beitou-image-content\nimageSrc: /api/assets/${asset.id}\n---\n`,
      })
      .where(eq(deckVersions.id, initialVersionId))

    const live = await createLive(app, deck.id, owner.cookie)
    expect(live.path).toBe(`/live/${live.token}`)
    expect(new Date(live.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const publicPresentation = await app.request(`/api/live/${live.token}/presentation`)
    expect(publicPresentation.status).toBe(200)
    expect(publicPresentation.headers.get('cache-control')).toBe('private, no-store')
    const publicPayload = (await publicPresentation.json()).live
    expect(publicPayload.presentation.markdown).toContain(
      `/api/live/${live.token}/assets/${asset.id}`,
    )
    expect(publicPayload.state).toEqual(liveState())

    const publicAsset = await app.request(`/api/live/${live.token}/assets/${asset.id}`)
    expect(publicAsset.status).toBe(200)
    expect([...new Uint8Array(await publicAsset.arrayBuffer())]).toEqual([4, 3, 2, 1])

    const events = await app.request(`/api/live/${live.token}/events`)
    expect(events.status).toBe(200)
    expect(events.headers.get('content-type')).toContain('text/event-stream')
    expect(events.headers.get('x-accel-buffering')).toBe('no')
    const reader = events.body!.getReader()
    const initialEvent = await readSseEvent(reader, 'state')
    expect(initialEvent).toMatchObject({ type: 'state', revision: 1, state: liveState() })

    const outsiderUpdate = await app.request(
      `/api/decks/${deck.id}/live/${live.token}/state`,
      jsonRequest('PUT', { state: liveState(2) }, outsider.cookie),
    )
    expect(outsiderUpdate.status).toBe(409)

    const ownerUpdate = await app.request(
      `/api/decks/${deck.id}/live/${live.token}/state`,
      jsonRequest(
        'PUT',
        {
          state: {
            page: 2,
            blackout: 'black',
            drawings: {
              2: [
                {
                  id: 'stroke-1',
                  tool: 'pen',
                  color: '#ef4444',
                  width: 4,
                  points: [
                    { x: 10, y: 20 },
                    { x: 30, y: 40 },
                  ],
                },
              ],
            },
          },
        },
        owner.cookie,
      ),
    )
    expect(ownerUpdate.status).toBe(200)
    const updateEvent = await readSseEvent(reader, 'state')
    expect(updateEvent).toMatchObject({
      type: 'state',
      revision: 2,
      state: { page: 2, blackout: 'black' },
    })

    const ended = await app.request(
      `/api/decks/${deck.id}/live/${live.token}`,
      jsonRequest('DELETE', undefined, owner.cookie),
    )
    expect(ended.status).toBe(200)
    expect(await ended.json()).toMatchObject({ ok: true, ended: true })
    expect(await readSseEvent(reader, 'ended')).toMatchObject({ type: 'ended', reason: 'ended' })
    await reader.cancel()

    const afterEnd = await app.request(`/api/live/${live.token}/presentation`)
    expect(afterEnd.status).toBe(410)
    expect(await afterEnd.json()).toMatchObject({ code: 'ended' })
  })

  it('直播会话校验状态、隔离 deck 资源，并使被替换的旧链接失效', async () => {
    const app = makeApp()
    const owner = await createLoggedInUser()
    const { deck } = await createDeckDirect(owner.user.id, 'Live A')
    const { deck: otherDeck } = await createDeckDirect(owner.user.id, 'Live B')
    const otherAsset = await createAsset({
      deckId: otherDeck.id,
      userId: owner.user.id,
      mimeType: 'image/png',
      data: Buffer.from([9]),
    })

    const invalid = await app.request(
      `/api/decks/${deck.id}/live`,
      jsonRequest('POST', { state: { page: 0, blackout: 'none', drawings: {} } }, owner.cookie),
    )
    expect(invalid.status).toBe(400)

    const first = await createLive(app, deck.id, owner.cookie)
    const crossDeckAsset = await app.request(`/api/live/${first.token}/assets/${otherAsset.id}`)
    expect(crossDeckAsset.status).toBe(404)

    const second = await createLive(app, deck.id, owner.cookie, liveState(2))
    expect(second.token).not.toBe(first.token)
    const oldLink = await app.request(`/api/live/${first.token}/presentation`)
    expect(oldLink.status).toBe(410)
    expect(await oldLink.json()).toMatchObject({ code: 'ended' })

    const staleUpdate = await app.request(
      `/api/decks/${deck.id}/live/${first.token}/state`,
      jsonRequest('PUT', { state: liveState(1) }, owner.cookie),
    )
    expect(staleUpdate.status).toBe(409)
    const staleEnd = await app.request(
      `/api/decks/${deck.id}/live/${first.token}`,
      jsonRequest('DELETE', undefined, owner.cookie),
    )
    expect(await staleEnd.json()).toMatchObject({ ended: false })

    const listed = await app.request(`/api/decks/${deck.id}/live`, {
      headers: { Cookie: owner.cookie },
    })
    expect((await listed.json()).live.token).toBe(second.token)
  })
})
