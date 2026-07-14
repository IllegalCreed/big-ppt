import { computed, readonly, ref, shallowRef } from 'vue'
import type { ImageStyleLibraryResponse } from '@big-ppt/shared'
import {
  applyImageStyle,
  deleteImageStylePreset,
  exploreImageStyles,
  fetchImageStyleLibrary,
  renameImageStylePreset,
  saveImageStyle,
  useFreeImageStyle,
  type ImageStyleSource,
} from '../api/image-styles'
import { ApiError } from '../api/client'

type OpenLibraryOptions = {
  /** write_slides 后首次强制决策；GET 返回前先让聊天区进入等待态。 */
  decisionPending?: boolean
}

const open = ref(false)
const deckId = ref<number | null>(null)
const library = shallowRef<ImageStyleLibraryResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const applyingKey = ref<string | null>(null)
const savingAssetIds = shallowRef<Set<string>>(new Set())
const renamingPresetId = ref<string | null>(null)
const deletingPresetId = ref<string | null>(null)
const mutationRevision = ref(0)
const pendingHint = ref(false)

let loadSequence = 0
let contextEpoch = 0
const explorationPromises = new Map<number, Promise<void>>()
const exploringDeckIds = shallowRef<Set<number>>(new Set())
const EXPLORATION_POLL_INTERVAL_MS = 1_500

const systemPresets = computed(() => library.value?.presets.system ?? [])
const userPresets = computed(() => library.value?.presets.user ?? [])
const generatedCandidates = computed(() => library.value?.generatedCandidates ?? [])
const active = computed(() => library.value?.active ?? null)
const draw = computed(() => library.value?.draw ?? null)
const remainingExplorations = computed(() => library.value?.remainingExplorations ?? 0)
const decisionPending = computed(() => pendingHint.value)
const exploring = computed(() => {
  const id = deckId.value
  if (id !== null && exploringDeckIds.value.has(id)) return true
  return draw.value?.state === 'running'
})
const canExplore = computed(() => !exploring.value && remainingExplorations.value > 0)

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function setExploring(targetDeckId: number, value: boolean): void {
  const next = new Set(exploringDeckIds.value)
  if (value) next.add(targetDeckId)
  else next.delete(targetDeckId)
  exploringDeckIds.value = next
}

function waitForNextExplorationPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, EXPLORATION_POLL_INTERVAL_MS))
}

function isCurrentContext(targetDeckId: number, epoch: number): boolean {
  return deckId.value === targetDeckId && contextEpoch === epoch
}

function acceptLibraryResponse(response: ImageStyleLibraryResponse): void {
  library.value = response
  // decisionPending 是一次显式的首次决策提示，但服务端才是最终事实来源。
  // 另一标签页已经选中预设/自由模式时，不能继续锁住聊天，更不能在关闭时覆盖它。
  if (pendingHint.value && response.active.mode !== 'undecided') {
    pendingHint.value = false
  }
}

function resetMutationState(): void {
  applyingKey.value = null
  savingAssetIds.value = new Set()
  renamingPresetId.value = null
  deletingPresetId.value = null
}

async function refreshForDeck(targetDeckId: number): Promise<void> {
  if (deckId.value !== targetDeckId) return
  const epoch = contextEpoch
  const sequence = ++loadSequence
  loading.value = true
  error.value = null
  try {
    const response = await fetchImageStyleLibrary(targetDeckId)
    if (!isCurrentContext(targetDeckId, epoch) || sequence !== loadSequence) return
    acceptLibraryResponse(response)
    if (response.draw.state === 'running') {
      void ensureExplorationPolling(targetDeckId)
    } else if (response.draw.state === 'failed') {
      error.value = response.draw.error || 'AI 探索失败，请重试'
    }
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch) && sequence === loadSequence) {
      error.value = messageOf(err)
    }
  } finally {
    if (isCurrentContext(targetDeckId, epoch) && sequence === loadSequence) {
      loading.value = false
    }
  }
}

/** 打开只读取风格库；这里永远不调用任何模型。 */
async function openLibrary(targetDeckId: number, options: OpenLibraryOptions = {}): Promise<void> {
  if (deckId.value !== targetDeckId) {
    contextEpoch += 1
    loadSequence += 1
    library.value = null
    error.value = null
    loading.value = false
    resetMutationState()
    deckId.value = targetDeckId
    pendingHint.value = options.decisionPending ?? false
  } else if (options.decisionPending) {
    pendingHint.value = true
  }
  open.value = true
  await refreshForDeck(targetDeckId)
}

function closeLibrary(): void {
  open.value = false
}

function leaveDeck(targetDeckId: number): void {
  if (deckId.value !== targetDeckId) return
  contextEpoch += 1
  loadSequence += 1
  open.value = false
  deckId.value = null
  library.value = null
  loading.value = false
  error.value = null
  pendingHint.value = false
  resetMutationState()
}

async function applyStyle(source: ImageStyleSource, id: string): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null || applyingKey.value) return
  const epoch = contextEpoch
  const operationKey = `${source}:${id}`
  applyingKey.value = operationKey
  error.value = null
  try {
    await applyImageStyle(targetDeckId, { source, id })
    if (!isCurrentContext(targetDeckId, epoch)) return
    pendingHint.value = false
    mutationRevision.value += 1
    open.value = false
    await refreshForDeck(targetDeckId)
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch)) error.value = messageOf(err)
  } finally {
    if (isCurrentContext(targetDeckId, epoch) && applyingKey.value === operationKey) {
      applyingKey.value = null
    }
  }
}

async function chooseFreeStyle(): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null || applyingKey.value) return
  const epoch = contextEpoch
  applyingKey.value = 'free'
  error.value = null
  try {
    await useFreeImageStyle(targetDeckId)
    if (!isCurrentContext(targetDeckId, epoch)) return
    pendingHint.value = false
    mutationRevision.value += 1
    open.value = false
    await refreshForDeck(targetDeckId)
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch)) error.value = messageOf(err)
  } finally {
    if (isCurrentContext(targetDeckId, epoch) && applyingKey.value === 'free') {
      applyingKey.value = null
    }
  }
}

/**
 * 关闭首次决策前先跟服务端对齐一次。若其他窗口已经选好风格，只关闭 UI；
 * 仍是 undecided 时才把“关闭”解释为显式自由生成。
 */
async function dismissLibrary(): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null) return
  if (!pendingHint.value) {
    closeLibrary()
    return
  }
  await refreshForDeck(targetDeckId)
  if (deckId.value !== targetDeckId) return
  if (!pendingHint.value) {
    closeLibrary()
    return
  }
  await chooseFreeStyle()
}

/** 恢复或启动某个 deck 的探索轮询；同 deck 始终只有一条 promise。 */
function ensureExplorationPolling(
  targetDeckId: number,
  options: { start?: boolean } = {},
): Promise<void> {
  const existing = explorationPromises.get(targetDeckId)
  if (existing) return existing

  setExploring(targetDeckId, true)
  if (deckId.value === targetDeckId) error.value = null
  const promise = (async () => {
    try {
      if (options.start) {
        try {
          await exploreImageStyles(targetDeckId)
        } catch (err) {
          // 另一个标签页已启动同 deck 探索时，直接接管 GET 轮询即可。
          if (!(err instanceof ApiError && err.status === 409)) throw err
        }
      } else {
        await waitForNextExplorationPoll()
      }
      while (deckId.value === targetDeckId) {
        let response: ImageStyleLibraryResponse
        try {
          response = await fetchImageStyleLibrary(targetDeckId)
        } catch (err) {
          // 后台任务可持续数分钟；一次网络抖动不应让前端永远停在 running。
          if (deckId.value === targetDeckId) error.value = messageOf(err)
          await waitForNextExplorationPoll()
          continue
        }
        if (deckId.value !== targetDeckId) break
        acceptLibraryResponse(response)
        error.value = null
        if (response.draw.state !== 'running') {
          if (response.draw.state === 'failed') {
            error.value = response.draw.error || 'AI 探索失败，请重试'
          }
          break
        }
        await waitForNextExplorationPoll()
      }
    } catch (err) {
      if (deckId.value === targetDeckId) error.value = messageOf(err)
    } finally {
      explorationPromises.delete(targetDeckId)
      setExploring(targetDeckId, false)
    }
  })()
  explorationPromises.set(targetDeckId, promise)
  return promise
}

/** 显式 AI 探索。打开风格库本身永远不会走到这里。 */
function explore(): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null) return Promise.resolve()
  const existing = explorationPromises.get(targetDeckId)
  if (existing) return existing
  if (!canExplore.value) return Promise.resolve()
  return ensureExplorationPolling(targetDeckId, { start: true })
}

async function saveCandidate(assetId: string, name?: string): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null || savingAssetIds.value.has(assetId)) return
  const epoch = contextEpoch
  savingAssetIds.value = new Set(savingAssetIds.value).add(assetId)
  error.value = null
  try {
    await saveImageStyle(targetDeckId, { assetId, ...(name?.trim() ? { name: name.trim() } : {}) })
    if (!isCurrentContext(targetDeckId, epoch)) return
    await refreshForDeck(targetDeckId)
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch)) error.value = messageOf(err)
  } finally {
    if (isCurrentContext(targetDeckId, epoch)) {
      const next = new Set(savingAssetIds.value)
      next.delete(assetId)
      savingAssetIds.value = next
    }
  }
}

async function renamePreset(presetId: string, name: string): Promise<void> {
  const targetDeckId = deckId.value
  const trimmed = name.trim()
  if (targetDeckId === null || !trimmed || renamingPresetId.value) return
  const epoch = contextEpoch
  renamingPresetId.value = presetId
  error.value = null
  try {
    await renameImageStylePreset(presetId, trimmed)
    if (!isCurrentContext(targetDeckId, epoch)) return
    await refreshForDeck(targetDeckId)
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch)) error.value = messageOf(err)
  } finally {
    if (isCurrentContext(targetDeckId, epoch) && renamingPresetId.value === presetId) {
      renamingPresetId.value = null
    }
  }
}

async function deletePreset(presetId: string): Promise<void> {
  const targetDeckId = deckId.value
  if (targetDeckId === null || deletingPresetId.value) return
  const epoch = contextEpoch
  deletingPresetId.value = presetId
  error.value = null
  try {
    await deleteImageStylePreset(presetId)
    if (!isCurrentContext(targetDeckId, epoch)) return
    await refreshForDeck(targetDeckId)
  } catch (err) {
    if (isCurrentContext(targetDeckId, epoch)) error.value = messageOf(err)
  } finally {
    if (isCurrentContext(targetDeckId, epoch) && deletingPresetId.value === presetId) {
      deletingPresetId.value = null
    }
  }
}

function __resetForTesting(): void {
  contextEpoch += 1
  loadSequence += 1
  open.value = false
  deckId.value = null
  library.value = null
  loading.value = false
  error.value = null
  resetMutationState()
  mutationRevision.value = 0
  pendingHint.value = false
  explorationPromises.clear()
  exploringDeckIds.value = new Set()
}

function __setDecisionPendingForTesting(value: boolean): void {
  pendingHint.value = value
}

export function useImageStyleLibrary() {
  return {
    open: readonly(open),
    deckId: readonly(deckId),
    library: readonly(library),
    loading: readonly(loading),
    error: readonly(error),
    applyingKey: readonly(applyingKey),
    savingAssetIds: readonly(savingAssetIds),
    renamingPresetId: readonly(renamingPresetId),
    deletingPresetId: readonly(deletingPresetId),
    mutationRevision: readonly(mutationRevision),
    systemPresets,
    userPresets,
    generatedCandidates,
    active,
    draw,
    remainingExplorations,
    decisionPending,
    exploring,
    canExplore,
    openLibrary,
    closeLibrary,
    dismissLibrary,
    leaveDeck,
    applyStyle,
    chooseFreeStyle,
    explore,
    saveCandidate,
    renamePreset,
    deletePreset,
    __resetForTesting,
    __setDecisionPendingForTesting,
  }
}
