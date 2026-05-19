/**
 * Phase 11.8 Task F-1:mood-board 选风格流程 composable。
 * Phase 11.8 dogfood(2026-05-19)重写:
 *   - openPicker 改成「先 GET 历史候选,有就回填 + 高亮已选,没有再 regenerate」
 *   - 加 clearAnchor() 对应右上角「取消风格限制」按钮
 *   - 加 selectedAssetId 反映当前 deck.anchorAssetId
 *   - 按钮文案 / 行为根据是否已选 anchor 动态切换
 *   - 「换一批」在已选状态下 disabled(用户必须先 clearAnchor 才能换)
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

interface GetCandidatesResponse {
  candidates: MoodBoardCandidate[]
  selectedAssetId: string | null
  anchorSkipped: boolean
  remaining: number
}

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
/**
 * 当前已选的 anchor asset id(来自后端 deck.anchorAssetId)。
 * null 表示用户没选 anchor(可能没决策过 / 已 clear / 主动 skip)。
 * UI 用它做 candidate 选中态高亮 + 决定底部按钮文案。
 */
const selectedAssetId = ref<string | null>(null)
/** "用户跳过本次"标记(后端 anchor_skipped 字段),仅 backend polling block 用,UI 不参与 */
const anchorSkipped = ref(false)

const canRegenerate = computed(() => {
  if (loading.value) return false
  if (remainingGenerations.value === 0) return false
  // Phase 11.8 dogfood:已选 anchor 时禁用换一批,强迫用户先 clearAnchor(避免误丢)
  if (selectedAssetId.value !== null) return false
  return true
})

/**
 * Phase 11.8 dogfood:底部主按钮的语义/文案根据是否已选 anchor 切换。
 *   - 已选 anchor(selectedAssetId !== null)→ 点按钮 = clearAnchor
 *   - 未选 anchor → 点按钮 = skip(标记自由发挥)
 * 文案见 UI 组件 computed,这里只暴露 mode。
 */
const primaryActionMode = computed<'clear' | 'skip'>(() =>
  selectedAssetId.value !== null ? 'clear' : 'skip',
)

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
  anchorSkipped.value = false
}

/**
 * 打开 picker。
 *  - 已 open 同 deck:no-op
 *  - open 别的 deck:先 reset 状态再切
 *  - 先调 GET /candidates,有历史就回填;没有(空数组)再 regenerate
 */
async function openPicker(targetDeckId: number): Promise<void> {
  if (open.value && deckId.value === targetDeckId) return
  __resetForTesting()
  deckId.value = targetDeckId
  open.value = true
  await loadFromBackend()
  // 没历史候选 → 自动调一次 generate(等价老 auto 行为)
  if (candidates.value.length === 0 && !error.value) {
    await regenerate()
  }
}

/** 拉历史候选 + 当前已选状态 + 剩余配额 */
async function loadFromBackend(): Promise<void> {
  if (!deckId.value) return
  loading.value = true
  error.value = null
  try {
    const res = await api.get<GetCandidatesResponse>(
      `/api/decks/${deckId.value}/mood-board/candidates`,
    )
    candidates.value = res.candidates
    selectedAssetId.value = res.selectedAssetId
    anchorSkipped.value = res.anchorSkipped
    remainingGenerations.value = res.remaining
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

/** 调 POST /api/decks/:id/mood-board/generate */
async function regenerate(): Promise<void> {
  if (!deckId.value) return
  if (loading.value) return
  // Phase 11.8 dogfood:已选状态下不允许 regenerate(用户必须先 clearAnchor)
  if (selectedAssetId.value !== null) return
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
    // 新批生成 → 之前可能存在的 selectedAssetId 也已被 backend discard(discardCurrentMoodBoard)
    selectedAssetId.value = null
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

/**
 * 用户跳过本次(还没选过 anchor 的语境),modal 关闭 + 后端 set anchor_skipped=true。
 * 这步是 Phase 11.8 真阻塞的关键:不写 backend,generate_slide_image 工具入口
 * 会一直 polling 等 anchor/skip 决策,LLM 卡在 tool result 等待中。
 */
async function skip(): Promise<void> {
  // 先 close modal 让 UI 不挂,backend 调用即使失败也不阻塞用户
  anchorSkipped.value = true
  open.value = false
  if (!deckId.value) return
  try {
    await api.post(`/api/decks/${deckId.value}/anchor/skip`)
  } catch (err) {
    // 失败时 modal 已关,但 backend 仍 polling — 提示 error 让用户重试
    error.value = `跳过失败:${err instanceof Error ? err.message : String(err)}。LLM 可能仍在等待,请重试。`
  }
}

/**
 * Phase 11.8 dogfood:用户点「取消风格限制」(已选状态下的右上角操作)。
 * - 后端 clearAnchorKeepCandidates:anchor 降回 candidate + decks.anchorAssetId=null +
 *   anchorSkipped=true(polling 仍解锁)
 * - 前端 selectedAssetId=null + modal 保持开(用户可继续选 candidate / 换一批 / 暂不)
 */
async function clearAnchor(): Promise<void> {
  if (!deckId.value) return
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    await api.post(`/api/decks/${deckId.value}/anchor/clear`)
    selectedAssetId.value = null
    anchorSkipped.value = true
    // modal 保持开:用户可再选某张 candidate / 换一批 / 暂不指定风格
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

/**
 * Phase 11.8 dogfood:统一的主按钮 handler,根据 primaryActionMode 派发 clear / skip。
 * UI 只绑这一个 handler 不需关心当前 mode。
 */
async function triggerPrimaryAction(): Promise<void> {
  if (primaryActionMode.value === 'clear') {
    await clearAnchor()
  } else {
    await skip()
  }
}

/** 强制关闭 modal(ESC / 点遮罩):等价 skip(标记自由发挥) */
async function closePicker(): Promise<void> {
  // 已选 anchor 状态下关 modal 应等于"保留当前 anchor",不能误触发 clear/skip
  if (selectedAssetId.value !== null) {
    open.value = false
    return
  }
  await skip()
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
    anchorSkipped,
    canRegenerate,
    primaryActionMode,
    // actions
    openPicker,
    regenerate,
    selectAnchor,
    skip,
    clearAnchor,
    triggerPrimaryAction,
    closePicker,
    __resetForTesting,
  }
}
