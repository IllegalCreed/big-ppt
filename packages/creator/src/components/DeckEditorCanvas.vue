<script setup lang="ts">
import { nextTick, onMounted, provide, ref, watch } from 'vue'
import { ArrowLeft, History, Layers, LogOut, Settings, Sparkles } from 'lucide-vue-next'
import ChatPanel from './ChatPanel.vue'
import SlidePreview from './SlidePreview.vue'
import SettingsModal from './SettingsModal.vue'
import TemplatePickerModal from './TemplatePickerModal.vue'
import VersionTimeline from './VersionTimeline.vue'
import {
  useDecks,
  type Deck,
  type DeckChat,
  type DeckVersion,
} from '../composables/useDecks'
import { DECK_CHAT_CONTEXT, type DeckChatContext } from '../composables/useAIChat'
import { useSlideStore } from '../composables/useSlideStore'
import { useAuth } from '../composables/useAuth'
import { ApiError } from '../api/client'

const props = defineProps<{
  deck: Deck
  currentVersion: DeckVersion | null
}>()
const emit = defineEmits<{ 'exit-to-list': [] }>()

const { currentUser, logout } = useAuth()
const { listChats, appendChat, updateDeck } = useDecks()
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
    // 同步 props.deck.title，父组件 state 引用同一对象，返回列表时拿到新标题
    props.deck.title = updated.title
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
  templateId: props.deck.templateId,
  initialHistory: [],
  persistChat: async (role, content, toolCallId) => {
    await appendChat(props.deck.id, { role, content, toolCallId })
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

onMounted(() => {
  void loadInitialChats()
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
          title="切换模板（AI 重写）"
          aria-label="切换模板"
          @click="showTemplatePicker = true"
        >
          <Layers :size="18" :stroke-width="1.8" />
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
        <SlidePreview />
      </div>
      <div v-if="isDragging" class="drag-overlay" />
    </main>

    <SettingsModal v-model:open="showSettings" />
    <TemplatePickerModal
      v-model:open="showTemplatePicker"
      mode="switch"
      :deck-id="deck.id"
      :current-template-id="deck.templateId"
    />
    <VersionTimeline
      :deck-id="deck.id"
      :current-version-id="currentVersion?.id ?? null"
      :open="showTimeline"
      @close="showTimeline = false"
      @restored="onTimelineRestored"
    />
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
