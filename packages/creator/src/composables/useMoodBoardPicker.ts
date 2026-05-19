/**
 * Phase 11.8 Task F-1:mood-board 选风格流程 composable。
 *
 * 提供 open / regenerate / selectAnchor / skip 四个动作 + 各种 reactive 状态,
 * 由组件树共享(顶栏"重选风格"按钮 + 自动触发都调同一个实例)。
 *
 * 跟 useGenerateImageJob 同款单例套路:模块作用域 state,首次 import 唯一实例;
 * 单测每个 case 调 __resetForTesting 复位。
 */
import { ref, shallowRef, computed } from 'vue'
import { api, ApiError } from '../api/client'
import type {
  MoodBoardCandidate,
  GenerateMoodBoardResponse,
  SetAnchorResponse,
} from '@big-ppt/shared'

// === 模块级 state(单例) ===
const open = ref(false)
const loading = ref(false)
const candidates = shallowRef<MoodBoardCandidate[]>([])
const error = ref<string | null>(null)
/** 当前 picker 对应的 deckId,关闭后清空 */
const deckId = ref<number | null>(null)
/** 是否曾 retry(LLM 第一轮 style 雷同) */
const retried = ref(false)
/** retry 后仍雷同(降级接受) — 给前端可选展示提示 */
const diversityDegraded = ref(false)
/** 后端返的剩余次数,客户端 mirror。-1 = 还没调过(unknown) */
const remainingGenerations = ref(-1)
/** 用户主动选定后置为 true,modal 关闭 + 触发外部监听 */
const selectedAssetId = ref<string | null>(null)
/** "用户跳过本次"标记,modal 关闭 + 触发外部监听(跟 selectedAssetId 互斥) */
const skipped = ref(false)

const canRegenerate = computed(() => {
  if (loading.value) return false
  if (remainingGenerations.value === 0) return false
  return true
})

function __resetForTesting(): void {
  open.value = false
  loading.value = false
  candidates.value = []
  error.value = null
  deckId.value = null
  retried.value = false
  diversityDegraded.value = false
  remainingGenerations.value = -1
  selectedAssetId.value = null
  skipped.value = false
}

/**
 * 打开 picker 并触发首次生成。
 * - 已 open 同 deck:no-op
 * - open 别的 deck:先 reset 状态再切
 */
async function openPicker(targetDeckId: number): Promise<void> {
  if (open.value && deckId.value === targetDeckId) return
  __resetForTesting()
  deckId.value = targetDeckId
  open.value = true
  await regenerate()
}

/** 调 POST /api/decks/:id/mood-board/generate */
async function regenerate(): Promise<void> {
  if (!deckId.value) return
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const res = await api.post<GenerateMoodBoardResponse>(
      `/api/decks/${deckId.value}/mood-board/generate`,
    )
    candidates.value = res.candidates
    retried.value = res.retried
    diversityDegraded.value = res.diversityDegraded
    remainingGenerations.value = res.remaining
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      remainingGenerations.value = 0
      error.value =
        '本 deck 已达 3 次样张生成上限。3 次还不满意建议跳过用 text-only 模式继续。'
    } else {
      error.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    loading.value = false
  }
}

/** 选定某张候选作为 anchor,触发 close + 外部监听 */
async function selectAnchor(assetId: string): Promise<void> {
  if (!deckId.value) return
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const res = await api.post<SetAnchorResponse>(
      `/api/decks/${deckId.value}/anchor`,
      { assetId },
    )
    selectedAssetId.value = res.anchorAssetId
    open.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

/** 用户跳过本次,modal 关闭 + 外部 useAIChat 继续(不写 anchor) */
function skip(): void {
  skipped.value = true
  open.value = false
}

/** 强制关闭 modal(ESC / 点遮罩,跟 skip 语义一致) */
function closePicker(): void {
  skip()
}

export function useMoodBoardPicker() {
  return {
    // state
    open,
    loading,
    candidates,
    error,
    deckId,
    retried,
    diversityDegraded,
    remainingGenerations,
    selectedAssetId,
    skipped,
    canRegenerate,
    // actions
    openPicker,
    regenerate,
    selectAnchor,
    skip,
    closePicker,
    __resetForTesting,
  }
}
