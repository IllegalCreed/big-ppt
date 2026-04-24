/**
 * Deck 域 API 封装：列表 / CRUD / 版本 / 回滚 / 锁状态 / 聊天历史。
 *
 * 状态故意不做全局单例——每个页面自己 ref 数据，避免隐式共享的惊讶。
 * 要跨组件共享时通过 props / provide-inject，不共享 module-level state。
 */
import { api } from '../api/client'

export type DeckStatus = 'active' | 'archived' | 'deleted'

export type Deck = {
  id: number
  userId: number
  title: string
  themeId: string
  /** 模板 id，对应 templates/<templateId>/manifest.json；新建 deck 时继承 starter.md */
  templateId: string
  currentVersionId: number | null
  status: DeckStatus
  createdAt: string
  updatedAt: string
}

export type DeckVersion = {
  id: number
  deckId: number
  content: string
  message: string | null
  turnId: string | null
  authorId: number | null
  createdAt: string
}

export type DeckVersionSummary = Omit<DeckVersion, 'content' | 'deckId'> & { deckId?: number }

export type DeckChat = {
  id: number
  deckId: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId: string | null
  createdAt: string
}

export type LockHolderWire = {
  sessionId: string
  userId: number | null
  email: string | null
  deckId: number | null
  deckTitle: string | null
  lockedAt: string | Date
  lastHeartbeatAt: string | Date
}

export type LockStatus =
  | { locked: false }
  | { locked: true; holder: LockHolderWire; isMe: boolean }

/** occupied 冲突时后端返回的 body */
export type ActivateConflict = {
  error: 'occupied'
  holder: LockHolderWire
}

export function useDecks() {
  async function listDecks() {
    const res = await api.get<{ decks: Deck[] }>('/api/decks')
    return res.decks
  }

  async function getDeck(id: number) {
    return api.get<{ deck: Deck; currentVersion: DeckVersion | null; versions: DeckVersionSummary[] }>(
      `/api/decks/${id}`,
    )
  }

  async function createDeck(input: { title?: string; initialContent?: string; templateId?: string }) {
    const res = await api.post<{ deck: Deck }>('/api/decks', input)
    return res.deck
  }

  async function updateDeck(id: number, patch: { title?: string; status?: 'active' | 'archived' }) {
    const res = await api.put<{ deck: Deck }>(`/api/decks/${id}`, patch)
    return res.deck
  }

  async function deleteDeck(id: number) {
    await api.delete(`/api/decks/${id}`)
  }

  async function listVersions(id: number) {
    const res = await api.get<{ versions: DeckVersionSummary[] }>(`/api/decks/${id}/versions`)
    return res.versions
  }

  async function restoreVersion(deckId: number, versionId: number) {
    const res = await api.post<{ version: DeckVersion }>(`/api/decks/${deckId}/restore/${versionId}`)
    return res.version
  }

  async function listChats(id: number) {
    const res = await api.get<{ chats: DeckChat[] }>(`/api/decks/${id}/chats`)
    return res.chats
  }

  async function appendChat(
    id: number,
    payload: { role: DeckChat['role']; content: string; toolCallId?: string },
  ) {
    await api.post(`/api/decks/${id}/chats`, payload)
  }

  return {
    listDecks,
    getDeck,
    createDeck,
    updateDeck,
    deleteDeck,
    listVersions,
    restoreVersion,
    listChats,
    appendChat,
  }
}

export function useDeckLock() {
  async function activate(id: number) {
    try {
      const res = await api.post<{ ok: true; deckId: number }>(`/api/activate-deck/${id}`)
      return { ok: true as const, deckId: res.deckId }
    } catch (err) {
      const body = (err as { body?: unknown }).body as { error?: string; holder?: LockHolderWire } | undefined
      if (body?.error === 'occupied' && body.holder) {
        return { ok: false as const, reason: 'occupied' as const, holder: body.holder }
      }
      throw err
    }
  }

  async function release() {
    await api.post('/api/release-deck')
  }

  async function heartbeat() {
    return api.post<{ ok: true; heldByMe: boolean }>('/api/heartbeat')
  }

  async function status() {
    return api.get<LockStatus>('/api/lock-status')
  }

  return { activate, release, heartbeat, status }
}
