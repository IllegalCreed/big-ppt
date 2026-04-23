import { describe, expect, it } from 'vitest'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import { useDeckLock, useDecks, type Deck } from '../src/composables/useDecks'
import { ApiError } from '../src/api/client'

useMsw()

function mockDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 1,
    userId: 1,
    title: 'T',
    themeId: 'default',
    currentVersionId: 10,
    status: 'active',
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    ...overrides,
  }
}

describe('composables/useDecks', () => {
  it('listDecks 返回后端 decks 数组', async () => {
    server.use(
      http.get('/api/decks', () =>
        HttpResponse.json({
          decks: [mockDeck({ id: 1, title: 'A' }), mockDeck({ id: 2, title: 'B' })],
        }),
      ),
    )
    const list = await useDecks().listDecks()
    expect(list.map((d) => d.title)).toEqual(['A', 'B'])
  })

  it('createDeck 返回新建的 deck', async () => {
    server.use(
      http.post('/api/decks', async ({ request }) => {
        const body = (await request.json()) as { title?: string }
        return HttpResponse.json({ deck: mockDeck({ id: 42, title: body.title ?? '未命名' }) }, { status: 201 })
      }),
    )
    const deck = await useDecks().createDeck({ title: '新 Deck' })
    expect(deck.id).toBe(42)
    expect(deck.title).toBe('新 Deck')
  })

  it('deleteDeck 不抛即算成功', async () => {
    server.use(http.delete('/api/decks/5', () => HttpResponse.json({ ok: true })))
    await expect(useDecks().deleteDeck(5)).resolves.toBeUndefined()
  })

  it('activate 冲突（409 + holder）→ 返回 { ok: false, reason, holder }，不抛 ApiError', async () => {
    const holder = {
      sessionId: 'other-sid',
      userId: 99,
      email: 'other@a.com',
      deckId: 1,
      deckTitle: 'Other',
      lockedAt: '2026-04-23T00:00:00Z',
      lastHeartbeatAt: '2026-04-23T00:00:00Z',
    }
    server.use(
      http.post('/api/activate-deck/1', () =>
        HttpResponse.json({ error: 'occupied', holder }, { status: 409 }),
      ),
    )
    const result = await useDeckLock().activate(1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('occupied')
      expect(result.holder.email).toBe('other@a.com')
      expect(result.holder.deckTitle).toBe('Other')
    }

    // 非 occupied 的错误仍然抛
    server.use(
      http.post('/api/activate-deck/2', () =>
        HttpResponse.json({ error: 'deck 不存在' }, { status: 404 }),
      ),
    )
    await expect(useDeckLock().activate(2)).rejects.toBeInstanceOf(ApiError)
  })
})
