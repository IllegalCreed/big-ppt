<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import {
  ArrowLeft,
  Download,
  FolderOpen,
  History,
  Layers,
  LogOut,
  Palette,
  Settings,
  Sparkles,
} from 'lucide-vue-next'
import ChatPanel from './ChatPanel.vue'
import SlidePreview from './SlidePreview.vue'
import SettingsModal from './SettingsModal.vue'
import TemplatePickerModal from './TemplatePickerModal.vue'
import UndoToast from './UndoToast.vue'
import VersionTimeline from './VersionTimeline.vue'
import AssetManagerPanel from './AssetManagerPanel.vue'
import ExportModal from './ExportModal.vue'
import AnchorPickerModal from './AnchorPickerModal.vue'
import { useMoodBoardPicker } from '../composables/useMoodBoardPicker'
import { api } from '../api/client'
import {
  useDecks,
  type Deck,
  type DeckChat,
  type DeckVersion,
} from '../composables/useDecks'
import { DECK_CHAT_CONTEXT, type DeckChatContext } from '../composables/useAIChat'
// Phase 12.7：persistChat 删了 —— backend agent loop 写 deck_chats，listChats 由
// useAIChat 内部 refresh。这里仍 listChats prefill 初始历史给 ChatPanel 挂载用。
import { useSlideStore } from '../composables/useSlideStore'
import { useAuth } from '../composables/useAuth'
import { ApiError } from '../api/client'

const props = defineProps<{
  deck: Deck
  currentVersion: DeckVersion | null
}>()
const emit = defineEmits<{
  'exit-to-list': []
  'template-switched': []
  'title-updated': [payload: { title: string }]
}>()

const { currentUser, logout } = useAuth()
const { listChats, updateDeck } = useDecks()
const slideStore = useSlideStore()

// ── 标题 inline 编辑 ───────────────────────────────────────────────────────
const displayTitle = ref(props.deck.title)
const isEditingTitle = ref(false)
const editingTitle = ref('')
const savingTitle = ref(false)
const titleError = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

watch(
  () => props.deck.title,
  (v) => {
    if (!isEditingTitle.value) displayTitle.value = v
  },
)

function startEditTitle() {
  if (isEditingTitle.value) return
  editingTitle.value = displayTitle.value
  titleError.value = ''
  isEditingTitle.value = true
  void nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

async function commitTitle() {
  if (!isEditingTitle.value || savingTitle.value) return
  const next = editingTitle.value.trim()
  if (!next) {
    titleError.value = '标题不能为空'
    void nextTick(() => titleInputRef.value?.focus())
    return
  }
  if (next.length > 200) {
    titleError.value = '标题最长 200 字'
    void nextTick(() => titleInputRef.value?.focus())
    return
  }
  if (next === displayTitle.value) {
    isEditingTitle.value = false
    titleError.value = ''
    return
  }
  savingTitle.value = true
  try {
    const updated = await updateDeck(props.deck.id, { title: next })
    displayTitle.value = updated.title
    // emit 给父组件让其更新自己的 state.deck.title（不直接 mutate prop，
    // 否则违反 vue/no-mutating-props）
    emit('title-updated', { title: updated.title })
    isEditingTitle.value = false
    titleError.value = ''
  } catch (err) {
    titleError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
    void nextTick(() => titleInputRef.value?.focus())
  } finally {
    savingTitle.value = false
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false
  titleError.value = ''
  editingTitle.value = displayTitle.value
}

// ── Chat 上下文：provide 时先给空数组，等 listChats 返回后就地 mutate。
//    ChatPanel 由 v-if="historyLoaded" 延迟挂载，inject 时一定能看到填好的数组。
const chatCtx: DeckChatContext = {
  deckId: props.deck.id,
  templateId: props.deck.templateId,
  initialHistory: [],
  onWriteSlidesCompleted: () => {
    // Phase 11.8 trigger-timing fix:write_slides 成功 → 此刻 deck 内容已被主 LLM
    // 写成真实业务大纲,适合喂给 mood-board prompt。仅在「image LLM 已配 + 没选过
    // anchor + 没主动跳过」时弹一次,避免每轮 write_slides 都骚扰。
    if (!hasImageLlm.value) return
    if (props.deck.anchorAssetId) return
    if (props.deck.anchorSkipped) return
    if (moodBoardPicker.open.value) return
    void moodBoardPicker.openPicker(props.deck.id)
  },
}
provide(DECK_CHAT_CONTEXT, chatCtx)

const historyLoaded = ref(false)

async function loadInitialChats() {
  try {
    const chats = await listChats(props.deck.id)
    chatCtx.initialHistory = chats
      .filter((c): c is DeckChat & { role: 'user' | 'assistant' } => c.role === 'user' || c.role === 'assistant')
      .map((c) => ({ role: c.role, content: c.content }))
  } finally {
    historyLoaded.value = true
  }
}

// ── 左右分栏拖拽 ───────────────────────────────────────────────────────────
const leftWidth = ref(40)
const isDragging = ref(false)
const mainRef = ref<HTMLElement | null>(null)

function onMouseDown(e: MouseEvent) {
  isDragging.value = true
  e.preventDefault()
  const startX = e.clientX
  const startWidth = leftWidth.value
  const containerWidth = mainRef.value!.offsetWidth

  function onMouseMove(e: MouseEvent) {
    const delta = ((e.clientX - startX) / containerWidth) * 100
    leftWidth.value = Math.min(70, Math.max(20, startWidth + delta))
  }

  function onMouseUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// ── 顶栏按钮 ───────────────────────────────────────────────────────────────
const showSettings = ref(false)
const showTimeline = ref(false)
const showTemplatePicker = ref(false)
const showAssetsPanel = ref(false)
const showExport = ref(false)

// Phase 14:Export 弹窗 payload。用 computed 包,避免 template inline 对象
// 每次 render 重建的反模式;ExportModal 内 onConfirm 点击时读到的就是当下最新的
// slideStore.content / totalPages(slideStore 是模块作用域单例,响应式自然透传)。
const exportDeckPayload = computed(() => ({
  id: props.deck.id,
  title: props.deck.title,
  markdown: slideStore.content.value,
  templateId: props.deck.templateId,
  totalPages: slideStore.totalPages.value,
}))

// ── UndoToast + VersionTimeline 高亮 ──────────────────────────────────────
const undoToast = ref<{ visible: boolean; templateName: string; snapshotVersionId: number | null }>({
  visible: false,
  templateName: '',
  snapshotVersionId: null,
})
const highlightVersionId = ref<number | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | null = null

function onTemplateSwitched(payload: {
  snapshotVersionId: number | null
  newTemplateId: string
  newTemplateName: string
}) {
  // 通知父组件 refetch deck + currentVersion，新 templateId 会随 deck 一起回流
  emit('template-switched')

  // 不主动调 slideStore.refresh()：backend 已 mirrorSlidesContent 写入新 slides.md，
  // dev Slidev 的 vite HMR 自己会把新内容推到 iframe，前端再 refresh 等于让 iframe
  // 整体 reload 一次，撞 Slidev 自身 reload 窗口反而 502/闪烁。

  undoToast.value = {
    visible: true,
    templateName: payload.newTemplateName,
    snapshotVersionId: payload.snapshotVersionId,
  }
}

function onUndoFromToast(snapshotVersionId: number) {
  undoToast.value.visible = false
  showTimeline.value = true
  // 清除旧 timer 避免泄漏
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightVersionId.value = snapshotVersionId
  highlightTimer = setTimeout(() => {
    highlightVersionId.value = null
    highlightTimer = null
  }, 2500)
}

function onTimelineRestored() {
  // 回滚成功后强制 iframe 重载，Slidev 会读到新的 slides.md
  slideStore.refresh()
}

async function onLogout() {
  emit('exit-to-list') // 先释放锁再跳 login
  setTimeout(() => {
    void logout().then(() => {
      window.location.href = '/login'
    })
  }, 100)
}

// Phase 11.8: 重选风格按钮 + 自动弹 modal。
// 设计抉择(实施期偏离 plan 32 抉择 6):**不**自动阻塞 SSE 流,因为 backend
// agent loop 在 backend,frontend 无法真"暂停 LLM 派发"。改成:
//   (a) 顶栏总是显示"选风格"按钮(image LLM 已配时);用户主动触发
//   (b) onMounted 检测 anchor=null + image LLM 已配 → 自动 open 一次
// 让用户在第一次发 prompt 之前就选好 anchor;modal 弹出与 LLM 调 generate_slide_image
// 的时序竞赛中,用户选完 anchor 的 30-60s 区间内大部分图都能拿到 anchor。
const moodBoardPicker = useMoodBoardPicker()
const hasImageLlm = ref(false)
const hasMainLlm = ref(false)

async function probeLlmSettings(): Promise<void> {
  try {
    const [img, main] = await Promise.all([
      api.get<{ hasApiKey: boolean }>('/api/image-llm-settings').catch(() => ({ hasApiKey: false })),
      api.get<{ hasApiKey: boolean }>('/api/auth/llm-settings').catch(() => ({ hasApiKey: false })),
    ])
    hasImageLlm.value = !!img.hasApiKey
    hasMainLlm.value = !!main.hasApiKey
  } catch {
    // 静默 — 没探到就不显示按钮
  }
}

const canPickAnchor = computed(() => hasImageLlm.value && hasMainLlm.value)

async function openAnchorPicker(): Promise<void> {
  await moodBoardPicker.openPicker(props.deck.id)
}

// anchor 选定后 → 让父刷一下 deck 元数据(同 template-switched 套路),并清空 picker state
watch(
  () => moodBoardPicker.selectedAssetId.value,
  (assetId) => {
    if (assetId) {
      // 触发父 refetch:Deck.anchorAssetId 字段会更新,顶栏按钮 label / 自动弹判断都跟着变
      emit('template-switched')
    }
  },
)

onMounted(async () => {
  void loadInitialChats()
  await probeLlmSettings()
  // 注意:**不**在 onMounted 自动弹 anchor picker —— 进编辑器时 deck 只有 starter
  // 骨架(几句占位文字),主 LLM 看不到真实业务大纲,出的 mood-board prompt 全是
  // 泛泛废话。真正触发时机由 useAIChat 监听 write_slides tool_execution.end 后
  // emit 'anchor-picker-needed' 事件,DeckEditorCanvas 接到后才弹 modal。
})

onUnmounted(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
})
</script>

<template>
  <div class="editor-root">
    <header class="toolbar">
      <div class="brand-block">
        <button
          type="button"
          class="icon-btn"
          title="返回列表"
          aria-label="返回列表"
          @click="emit('exit-to-list')"
        >
          <ArrowLeft :size="18" :stroke-width="1.8" />
        </button>
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <Sparkles :size="18" :stroke-width="1.8" />
          </div>
          <div class="brand-text">
            <input
              v-if="isEditingTitle"
              ref="titleInputRef"
              v-model="editingTitle"
              type="text"
              class="deck-title-input"
              :class="{ 'is-saving': savingTitle, 'is-error': !!titleError }"
              :disabled="savingTitle"
              maxlength="200"
              @keydown.enter.prevent="commitTitle"
              @keydown.esc.prevent="cancelEditTitle"
              @blur="commitTitle"
            />
            <div
              v-else
              class="deck-title"
              :title="`${displayTitle} · 双击重命名`"
              @dblclick="startEditTitle"
            >
              {{ displayTitle }}
            </div>
            <div class="deck-subtitle">
              <template v-if="titleError">
                <span class="title-error">{{ titleError }}</span>
              </template>
              <template v-else>Lumideck · 编辑中</template>
            </div>
          </div>
        </div>
      </div>

      <div class="toolbar-actions">
        <span v-if="currentUser" class="user-email">{{ currentUser.email }}</span>
        <button
          type="button"
          class="icon-btn"
          title="版本历史"
          aria-label="版本历史"
          @click="showTimeline = !showTimeline"
        >
          <History :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="切换模板"
          aria-label="切换模板"
          @click="showTemplatePicker = true"
        >
          <Layers :size="18" :stroke-width="1.8" />
        </button>
        <button
          v-if="canPickAnchor"
          type="button"
          class="icon-btn"
          :title="deck.anchorAssetId ? '重选 AI 生图风格' : '选 AI 生图风格(让 22 页风格统一)'"
          :aria-label="deck.anchorAssetId ? '重选风格' : '选风格'"
          data-anchor-picker-btn
          @click="openAnchorPicker"
        >
          <Palette :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="我的素材"
          aria-label="我的素材"
          @click="showAssetsPanel = true"
        >
          <FolderOpen :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="导出"
          aria-label="导出"
          @click="showExport = true"
        >
          <Download :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="设置"
          aria-label="设置"
          @click="showSettings = true"
        >
          <Settings :size="18" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="退出登录（释放占用）"
          aria-label="退出登录"
          @click="onLogout"
        >
          <LogOut :size="18" :stroke-width="1.8" />
        </button>
      </div>
    </header>

    <main class="main-content" ref="mainRef">
      <div class="panel-left" :style="{ width: leftWidth + '%' }">
        <!-- 等历史加载完再挂 ChatPanel，避免 useAIChat 初始化时 initialHistory 还是空数组 -->
        <ChatPanel v-if="historyLoaded" />
        <div v-else class="loading-inline">加载对话历史...</div>
      </div>
      <div class="divider" :class="{ active: isDragging }" @mousedown="onMouseDown" />
      <div class="panel-right">
        <SlidePreview
          :deck-id="deck.id"
          :template-id="deck.templateId"
          :initial-content="currentVersion?.content ?? ''"
        />
      </div>
      <div v-if="isDragging" class="drag-overlay" />
    </main>

    <SettingsModal v-model:open="showSettings" />
    <AssetManagerPanel v-model:open="showAssetsPanel" />
    <ExportModal v-model:open="showExport" :deck="exportDeckPayload" />
    <TemplatePickerModal
      v-model:open="showTemplatePicker"
      mode="switch"
      :deck-id="deck.id"
      :current-template-id="deck.templateId"
      @switched="onTemplateSwitched"
    />
    <UndoToast
      :visible="undoToast.visible"
      :template-name="undoToast.templateName"
      :snapshot-version-id="undoToast.snapshotVersionId"
      @close="undoToast.visible = false"
      @undo="onUndoFromToast"
    />
    <VersionTimeline
      :deck-id="deck.id"
      :current-version-id="currentVersion?.id ?? null"
      :highlight-version-id="highlightVersionId"
      :open="showTimeline"
      @close="showTimeline = false"
      @restored="onTimelineRestored"
    />
    <AnchorPickerModal />
  </div>
</template>

<style scoped>
.editor-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 56px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgba(193, 95, 60, 0.12);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: var(--lh-tight);
  padding-top: 1px;
  min-width: 0;
}

.deck-title {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  letter-spacing: 0.01em;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
}

.deck-title:hover {
  background: var(--color-bg-subtle);
}

.deck-title-input {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  letter-spacing: 0.01em;
  width: 260px;
  max-width: 100%;
  padding: 2px 8px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-soft);
  transition: opacity var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.deck-title-input.is-saving {
  opacity: 0.55;
  cursor: wait;
}

.deck-title-input.is-error {
  border-color: #B4472C;
  box-shadow: 0 0 0 3px rgba(180, 71, 44, 0.14);
}

.title-error {
  color: #B4472C;
}

.brand-text .deck-subtitle {
  margin-top: 2px;
}

.deck-subtitle {
  font-size: 11px;
  font-weight: var(--fw-medium);
  color: var(--color-fg-tertiary);
  letter-spacing: 0.08em;
  margin-top: 2px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.user-email {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  padding: 0 var(--space-2);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.icon-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.icon-btn:active {
  background: var(--color-accent-soft);
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.panel-left {
  min-width: 320px;
  display: flex;
  flex-direction: column;
}

.loading-inline {
  padding: var(--space-6);
  color: var(--color-fg-tertiary);
  font-size: var(--fs-sm);
}

.divider {
  width: 6px;
  cursor: col-resize;
  background: var(--color-border-strong);
  transition: background var(--dur-base) var(--ease-out);
  flex-shrink: 0;
  position: relative;
}

.divider::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 24px;
  background-image: radial-gradient(circle, var(--color-fg-muted) 1px, transparent 1.5px);
  background-size: 2px 8px;
  background-repeat: repeat-y;
  transition: background-image var(--dur-base) var(--ease-out);
  pointer-events: none;
}

.divider:hover,
.divider.active {
  background: var(--color-accent);
}

.divider:hover::before,
.divider.active::before {
  background-image: radial-gradient(circle, var(--color-accent-fg) 1px, transparent 1.5px);
}

.panel-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 320px;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  cursor: col-resize;
}
</style>
