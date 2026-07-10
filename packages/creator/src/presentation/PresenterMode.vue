<script setup lang="ts">
import type { PresentationPayload } from '@big-ppt/shared'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  Highlighter,
  MousePointer2,
  Moon,
  Pause,
  Pencil,
  Play,
  Radio,
  RotateCcw,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'
import { parseDeck } from '../deck-renderer/parse-deck'
import DrawingLayer from './DrawingLayer.vue'
import LiveShareModal from './LiveShareModal.vue'
import type { DrawingMode, DrawingStroke, PresentationUiTheme } from './types'
import { usePresentationSession } from './usePresentationSession'

const props = withDefaults(
  defineProps<{
    presentation: PresentationPayload
    channelId: string
    initialPage?: number
  }>(),
  { initialPage: 1 },
)

const emit = defineEmits<{
  exit: []
  'open-audience': [page: number]
}>()

const parsed = computed(() => parseDeck(props.presentation.markdown))
const totalPages = computed(() => parsed.value.slides.length)
const session = usePresentationSession({
  deckId: props.presentation.deckId,
  channelId: props.channelId,
  initialPage: props.initialPage,
  totalPages: () => totalPages.value,
})

const elapsedSeconds = ref(0)
const timerRunning = ref(true)
const uiTheme = ref<PresentationUiTheme>('dark')
const drawingEnabled = ref(false)
const drawingTool = ref<DrawingMode>('pen')
const drawingColor = ref('#ef4444')
const liveShareOpen = ref(false)
const liveActive = ref(false)
const currentSlide = computed(() => parsed.value.slides[session.currentPage.value - 1] ?? null)
const nextPage = computed(() => Math.min(totalPages.value, session.currentPage.value + 1))
const hasNext = computed(() => session.currentPage.value < totalPages.value)
const currentStrokes = computed(() => session.drawings.value[session.currentPage.value] ?? [])
const liveSnapshot = computed(() => session.snapshot())
const formattedTime = computed(() => {
  const hours = Math.floor(elapsedSeconds.value / 3600)
  const minutes = Math.floor((elapsedSeconds.value % 3600) / 60)
  const seconds = elapsedSeconds.value % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
})

let timer: ReturnType<typeof setInterval> | null = null

function previous(): void {
  session.setPage(session.currentPage.value - 1)
}

function next(): void {
  session.setPage(session.currentPage.value + 1)
}

function updateStrokes(strokes: DrawingStroke[]): void {
  session.setStrokes(session.currentPage.value, strokes)
}

function resetTimer(): void {
  elapsedSeconds.value = 0
}

function activateDrawingTool(tool: DrawingMode): void {
  drawingEnabled.value = true
  drawingTool.value = tool
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') previous()
  else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') next()
  else if (event.key.toLowerCase() === 'b') {
    session.setBlackout(session.blackout.value === 'black' ? 'none' : 'black')
  } else if (event.key.toLowerCase() === 'w') {
    session.setBlackout(session.blackout.value === 'white' ? 'none' : 'white')
  } else return
  event.preventDefault()
}

onMounted(() => {
  timer = setInterval(() => {
    if (timerRunning.value) elapsedSeconds.value++
  }, 1000)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="presenter-mode" :class="`ui-theme-${uiTheme}`" data-presenter-mode>
    <header class="presenter-header">
      <div class="header-group">
        <button
          type="button"
          class="icon-btn"
          title="退出演讲者视图"
          aria-label="退出演讲者视图"
          @click="emit('exit')"
        >
          <ArrowLeft :size="18" />
        </button>
        <span class="deck-title">{{ presentation.title }}</span>
      </div>
      <div class="timer" aria-label="演讲计时">{{ formattedTime }}</div>
      <div class="header-group header-actions">
        <button
          type="button"
          class="icon-btn"
          :title="timerRunning ? '暂停计时' : '继续计时'"
          :aria-label="timerRunning ? '暂停计时' : '继续计时'"
          @click="timerRunning = !timerRunning"
        >
          <Pause v-if="timerRunning" :size="17" />
          <Play v-else :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="重置计时"
          aria-label="重置计时"
          @click="resetTimer"
        >
          <RotateCcw :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ 'is-live': liveActive }"
          :title="liveActive ? '管理直播观看' : '直播观看'"
          :aria-label="liveActive ? '管理直播观看' : '直播观看'"
          :aria-pressed="liveActive"
          @click="liveShareOpen = true"
        >
          <Radio :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="打开观众窗口"
          aria-label="打开观众窗口"
          @click="emit('open-audience', session.currentPage.value)"
        >
          <ExternalLink :size="17" />
        </button>
      </div>
    </header>

    <main class="presenter-content">
      <section class="current-pane">
        <div class="pane-label">当前页</div>
        <div class="current-stage">
          <DeckRenderer
            :markdown="presentation.markdown"
            :template-id="presentation.templateId"
            :current-page="session.currentPage.value"
            allow-upscale
          />
          <DrawingLayer
            :strokes="currentStrokes"
            :enabled="drawingEnabled"
            :tool="drawingTool"
            :color="drawingColor"
            :width="drawingTool === 'highlighter' ? 24 : 4"
            @update:strokes="updateStrokes"
          />
        </div>
      </section>

      <aside class="side-pane">
        <section class="next-pane">
          <div class="pane-label">下一页</div>
          <div class="next-stage" :class="{ empty: !hasNext }">
            <DeckRenderer
              v-if="hasNext"
              :markdown="presentation.markdown"
              :template-id="presentation.templateId"
              :current-page="nextPage"
            />
            <span v-else>结束</span>
          </div>
        </section>
        <section class="notes-pane">
          <div class="pane-label">备注</div>
          <div class="notes-content">{{ currentSlide?.notes || '本页暂无备注' }}</div>
        </section>
      </aside>
    </main>

    <footer class="presenter-controls">
      <div class="control-group">
        <button
          type="button"
          class="icon-btn"
          title="上一页"
          aria-label="上一页"
          :disabled="session.currentPage.value <= 1"
          @click="previous"
        >
          <ChevronLeft :size="19" />
        </button>
        <span class="page-counter">{{ session.currentPage.value }} / {{ totalPages }}</span>
        <button
          type="button"
          class="icon-btn"
          title="下一页"
          aria-label="下一页"
          :disabled="session.currentPage.value >= totalPages"
          @click="next"
        >
          <ChevronRight :size="19" />
        </button>
      </div>
      <div class="control-group">
        <button
          type="button"
          class="icon-btn"
          :class="{ active: drawingEnabled && drawingTool === 'pen' }"
          title="画笔"
          aria-label="画笔"
          @click="activateDrawingTool('pen')"
        >
          <Pencil :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: drawingEnabled && drawingTool === 'highlighter' }"
          title="高亮"
          aria-label="高亮"
          @click="activateDrawingTool('highlighter')"
        >
          <Highlighter :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: drawingEnabled && drawingTool === 'eraser' }"
          title="橡皮擦"
          aria-label="橡皮擦"
          @click="activateDrawingTool('eraser')"
        >
          <Eraser :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: !drawingEnabled }"
          title="指针（停止标注）"
          aria-label="指针"
          @click="drawingEnabled = false"
        >
          <MousePointer2 :size="17" />
        </button>
        <button
          v-for="color in ['#ef4444', '#facc15', '#22c55e', '#38bdf8']"
          :key="color"
          type="button"
          class="color-swatch"
          :class="{ active: drawingColor === color }"
          :style="{ background: color }"
          :title="`选择 ${color}`"
          :aria-label="`选择画笔颜色 ${color}`"
          :disabled="drawingTool === 'eraser'"
          @click="drawingColor = color"
        />
        <button
          type="button"
          class="icon-btn"
          title="撤销笔迹"
          aria-label="撤销笔迹"
          :disabled="currentStrokes.length === 0"
          @click="updateStrokes(currentStrokes.slice(0, -1))"
        >
          <Undo2 :size="17" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="清空本页笔迹"
          aria-label="清空本页笔迹"
          :disabled="currentStrokes.length === 0"
          @click="updateStrokes([])"
        >
          <Trash2 :size="17" />
        </button>
        <span class="theme-toggle" role="group" aria-label="界面主题">
          <button
            type="button"
            class="icon-btn"
            :class="{ active: uiTheme === 'dark' }"
            title="深色界面"
            aria-label="深色界面"
            :aria-pressed="uiTheme === 'dark'"
            @click="uiTheme = 'dark'"
          >
            <Moon :size="17" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: uiTheme === 'light' }"
            title="浅色界面"
            aria-label="浅色界面"
            :aria-pressed="uiTheme === 'light'"
            @click="uiTheme = 'light'"
          >
            <Sun :size="17" />
          </button>
        </span>
      </div>
    </footer>
  </div>
  <LiveShareModal
    v-model:open="liveShareOpen"
    :deck-id="presentation.deckId"
    :deck-title="presentation.title"
    :snapshot="liveSnapshot"
    :ui-theme="uiTheme"
    @update:active="liveActive = $event"
  />
</template>

<style scoped>
.presenter-mode {
  --presentation-bg: #121416;
  --presentation-surface: #1b1e21;
  --presentation-fg: #f4f4f2;
  --presentation-muted: rgba(255, 255, 255, 0.72);
  --presentation-subtle: rgba(255, 255, 255, 0.55);
  --presentation-border: rgba(255, 255, 255, 0.1);
  --presentation-hover: rgba(255, 255, 255, 0.13);
  --presentation-empty-bg: #24272b;
  --presentation-notes-fg: rgba(255, 255, 255, 0.82);

  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--presentation-bg);
  color: var(--presentation-fg);
  font-family: var(--font-sans);
  transition:
    background-color 120ms ease-out,
    color 120ms ease-out;
}

.presenter-mode.ui-theme-light {
  --presentation-bg: #eef0f2;
  --presentation-surface: #ffffff;
  --presentation-fg: #202326;
  --presentation-muted: rgba(32, 35, 38, 0.68);
  --presentation-subtle: rgba(32, 35, 38, 0.5);
  --presentation-border: rgba(32, 35, 38, 0.14);
  --presentation-hover: rgba(32, 35, 38, 0.08);
  --presentation-empty-bg: #dde1e4;
  --presentation-notes-fg: rgba(32, 35, 38, 0.84);
}

.presenter-header,
.presenter-controls {
  flex: 0 0 52px;
  min-height: 52px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  padding: 0 16px;
  background: var(--presentation-surface);
  border-color: var(--presentation-border);
}

.presenter-header {
  border-bottom-style: solid;
  border-bottom-width: 1px;
}

.presenter-controls {
  grid-template-columns: auto 1fr;
  gap: 20px;
  border-top-style: solid;
  border-top-width: 1px;
}

.header-group,
.control-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}

.header-actions,
.presenter-controls .control-group:last-child {
  justify-content: flex-end;
}

.deck-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--presentation-muted);
}

.timer,
.page-counter {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.timer {
  font-size: 22px;
}

.page-counter {
  width: 78px;
  text-align: center;
  font-size: 13px;
  color: var(--presentation-muted);
}

.presenter-content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 18px;
  padding: 18px;
}

.current-pane,
.side-pane,
.next-pane,
.notes-pane {
  min-width: 0;
  min-height: 0;
}

.current-pane,
.next-pane,
.notes-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.side-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 18px;
}

.pane-label {
  flex: 0 0 auto;
  color: var(--presentation-subtle);
  font-size: 12px;
}

.current-stage,
.next-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #fff;
}

.current-stage {
  max-height: 100%;
  margin: auto;
}

.current-stage :deep(.deck-renderer),
.next-stage :deep(.deck-renderer) {
  height: 100%;
  min-height: 0;
  padding: 0;
}

.next-stage :deep(.slide-frame),
.current-stage :deep(.slide-frame) {
  box-shadow: none;
}

.next-stage.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--presentation-empty-bg);
  color: var(--presentation-subtle);
}

.notes-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  border: 1px solid var(--presentation-border);
  border-radius: 6px;
  background: var(--presentation-surface);
  color: var(--presentation-notes-fg);
  font-size: 16px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.icon-btn {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--presentation-muted);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled),
.icon-btn.active {
  background: var(--presentation-hover);
  color: var(--presentation-fg);
}

.icon-btn.is-live {
  background: rgba(221, 72, 57, 0.16);
  color: #eb7565;
}

.icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.color-swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}

.color-swatch.active {
  border-color: var(--presentation-fg);
}

.color-swatch:disabled {
  cursor: default;
  opacity: 0.35;
}

.theme-toggle {
  display: inline-flex;
  flex: 0 0 auto;
}

@media (max-width: 900px) {
  .presenter-header,
  .presenter-controls {
    padding: 0 8px;
  }

  .deck-title {
    display: none;
  }

  .presenter-content {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .side-pane {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto;
  }

  .presenter-controls .control-group:last-child {
    overflow-x: auto;
    scrollbar-width: none;
  }

  .presenter-controls .control-group:last-child::-webkit-scrollbar {
    display: none;
  }
}
</style>
