/**
 * Deck 域 API 封装：列表 / CRUD / 版本 / 回滚 / 锁状态 / 聊天历史。
 *
 * 状态故意不做全局单例——每个页面自己 ref 数据，避免隐式共享的惊讶。
 * 要跨组件共享时通过 props / provide-inject，不共享 module-level state。
 */
import type { Block } from '@big-ppt/shared'
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
  /** Phase 11.8: 选定的视觉锚图 asset id;null = 未选/已跳过/切模板被清空 */
  anchorAssetId: string | null
  /** Phase 11.8: 用户对锚图选样的"已决策"标记;true = 已选 or 已显式跳过;false = 还没决策 */
  anchorSkipped: boolean
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

export type SwitchJobState =
  | 'pending'
  | 'snapshotting'
  | 'migrating'
  | 'success'
  | 'failed'

// Phase 11.5：generate_slide_image job 类型(后端 ImageJob 字段镜像)
// Phase 11.6:扩 fallback-rewrote / fallback-failed 两个状态(graceful-degradation)
export type ImageJobState =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'fallback-rewrote'
  | 'fallback-failed'

export type ImageJobInfo = {
  id: string
  deckId: number
  userId: number
  slideIndex: number
  prompt: string
  caption?: string
  size: string
  state: ImageJobState
  pathTaken?: 'A' | 'B'
  assetId?: string
  modelUsed?: string
  errorMsg?: string
  startedAt: string
  finishedAt?: string
}

export type SwitchJobInfo = {
  id: string
  deckId: number
  userId: number
  from: string
  to: string
  state: SwitchJobState
  error?: string
  startedAt: string
  finishedAt?: string
  snapshotVersionId?: number
  newVersionId?: number
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
    payload: {
      role: DeckChat['role']
      content: string
      toolCallId?: string
      /** Phase 12 Task I：canonical Block[]，后端 routes/decks.ts 优先使用；老字段 content / toolCallId 作 fallback */
      canonical?: Block[]
    },
  ) {
    await api.post(`/api/decks/${id}/chats`, payload)
  }

  async function switchTemplate(
    deckId: number,
    targetTemplateId: string,
    options?: { regenerateImages?: boolean },
  ) {
    return api.post<{ jobId: string; state: SwitchJobState }>(
      `/api/decks/${deckId}/switch-template`,
      {
        targetTemplateId,
        confirmed: true,
        regenerateImages: options?.regenerateImages === true,
      },
    )
  }

  async function getSwitchTemplateJob(jobId: string) {
    return api.get<{ job: SwitchJobInfo }>(`/api/switch-template-jobs/${jobId}`)
  }

  // Phase 11.5：image-gen-job 配套 API
  async function getImageJob(jobId: string) {
    return api.get<{ job: ImageJobInfo }>(`/api/image-jobs/${jobId}`)
  }

  async function cancelImageJob(jobId: string) {
    return api.delete<{ ok: true }>(`/api/image-jobs/${jobId}`)
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
    switchTemplate,
    getSwitchTemplateJob,
    getImageJob,
    cancelImageJob,
  }
}

/**
 * Phase 10.5 起编辑器不再抢 Slidev 锁，本 composable 仅给「全屏放映」流程兜底。
 * activate-deck 路由已删（D-2），仅保留 release / heartbeat / lock-status：
 *   - release：放映 tab 关闭 / 用户主动停止放映时调
 *   - heartbeat：放映期保持心跳延长 5min 超时（当前未接入，留待优化）
 *   - status：查锁状态（OccupiedWaitingPage 等待页轮询用）
 */
export function useDeckLock() {
  async function release() {
    await api.post('/api/release-deck')
  }

  async function heartbeat() {
    return api.post<{ ok: true; heldByMe: boolean }>('/api/heartbeat')
  }

  async function status() {
    return api.get<LockStatus>('/api/lock-status')
  }

  return { release, heartbeat, status }
}
