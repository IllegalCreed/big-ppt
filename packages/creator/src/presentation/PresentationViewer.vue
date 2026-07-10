<script setup lang="ts">
import type { PresentationPayload } from '@big-ppt/shared'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Grid2X2,
  Highlighter,
  Maximize,
  MonitorUp,
  Moon,
  Pencil,
  Sun,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'
import { parseDeck } from '../deck-renderer/parse-deck'
import DrawingLayer from './DrawingLayer.vue'
import OverviewGrid from './OverviewGrid.vue'
import type { BlackoutMode, DrawingStroke, DrawingTool, PresentationUiTheme } from './types'
import { usePresentationSession } from './usePresentationSession'

const props = withDefaults(
  defineProps<{
    presentation: PresentationPayload
    mode?: 'present' | 'share-view'
    initialPage?: number
    channelId?: string
  }>(),
  {
    mode: 'present',
    initialPage: 1,
    channelId: '',
  },
)

const emit = defineEmits<{
  exit: []
  'open-presenter': [page: number]
}>()

const parsed = computed(() => parseDeck(props.presentation.markdown))
const totalPages = computed(() => parsed.value.slides.length)
const session = usePresentationSession({
  deckId: props.presentation.deckId,
  channelId: props.channelId,
  initialPage: props.initialPage,
  totalPages: () => totalPages.value,
})

const rootRef = ref<HTMLElement | null>(null)
const overviewOpen = ref(false)
const isFullscreen = ref(false)
const uiTheme = ref<PresentationUiTheme>('dark')
const drawingEnabled = ref(false)
const drawingTool = ref<DrawingTool>('pen')
const drawingColor = ref('#ef4444')
const touchStart = ref<{ x: number; y: number } | null>(null)
const canDraw = computed(() => props.mode === 'present')
const currentStrokes = computed(() => session.drawings.value[session.currentPage.value] ?? [])
const progress = computed(() =>
  totalPages.value > 0 ? (session.currentPage.value / totalPages.value) * 100 : 0,
)

function previous(): void {
  session.setPage(session.currentPage.value - 1)
}

function next(): void {
  session.setPage(session.currentPage.value + 1)
}

function selectPage(page: number): void {
  session.setPage(page)
  overviewOpen.value = false
}

function toggleBlackout(mode: Exclude<BlackoutMode, 'none'>): void {
  session.setBlackout(session.blackout.value === mode ? 'none' : mode)
}

function updateStrokes(strokes: DrawingStroke[]): void {
  session.setStrokes(session.currentPage.value, strokes)
}

function undoStroke(): void {
  updateStrokes(currentStrokes.value.slice(0, -1))
}

function clearStrokes(): void {
  updateStrokes([])
}

function activateDrawingTool(tool: DrawingTool): void {
  drawingEnabled.value = true
  drawingTool.value = tool
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await rootRef.value?.requestFullscreen()
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === rootRef.value
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
    return
  }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') previous()
  else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') next()
  else if (event.key === 'Home') session.setPage(1)
  else if (event.key === 'End') session.setPage(totalPages.value)
  else if (event.key.toLowerCase() === 'b') toggleBlackout('black')
  else if (event.key.toLowerCase() === 'w') toggleBlackout('white')
  else if (event.key.toLowerCase() === 'f') void toggleFullscreen()
  else if (event.key.toLowerCase() === 'o' || event.key === 'Escape') {
    overviewOpen.value = !overviewOpen.value
  } else if (event.key.toLowerCase() === 'd' && canDraw.value) {
    drawingEnabled.value = !drawingEnabled.value
  } else return
  event.preventDefault()
}

function onStageClick(event: MouseEvent): void {
  if (drawingEnabled.value || overviewOpen.value) return
  const target = event.target as HTMLElement
  if (target.closest('[data-interactive]')) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (event.clientX - rect.left < rect.width / 3) previous()
  else next()
}

function onTouchStart(event: TouchEvent): void {
  if (drawingEnabled.value) return
  const touch = event.changedTouches[0]
  if (touch) touchStart.value = { x: touch.clientX, y: touch.clientY }
}

function onTouchEnd(event: TouchEvent): void {
  const start = touchStart.value
  const touch = event.changedTouches[0]
  touchStart.value = null
  if (!start || !touch || drawingEnabled.value) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return
  if (dx > 0) previous()
  else next()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <div
    ref="rootRef"
    class="presentation-viewer"
    :class="`ui-theme-${uiTheme}`"
    data-presentation-viewer
  >
    <header class="viewer-toolbar" data-interactive>
      <div class="toolbar-group">
        <button
          type="button"
          class="icon-btn"
          title="退出放映"
          aria-label="退出放映"
          @click="emit('exit')"
        >
          <ArrowLeft :size="18" />
        </button>
        <span class="deck-title">{{ presentation.title }}</span>
      </div>

      <div class="toolbar-group toolbar-center">
        <button
          type="button"
          class="icon-btn"
          title="上一页"
          aria-label="上一页"
          :disabled="session.currentPage.value <= 1"
          @click="previous"
        >
          <ChevronLeft :size="18" />
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
          <ChevronRight :size="18" />
        </button>
      </div>

      <div class="toolbar-group">
        <template v-if="canDraw">
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
            :class="{ active: !drawingEnabled }"
            title="关闭画笔"
            aria-label="关闭画笔"
            @click="drawingEnabled = false"
          >
            <Eraser :size="17" />
          </button>
          <span class="color-tools" aria-label="画笔颜色">
            <button
              v-for="color in ['#ef4444', '#facc15', '#22c55e', '#38bdf8']"
              :key="color"
              type="button"
              class="color-swatch"
              :class="{ active: drawingColor === color }"
              :style="{ background: color }"
              :title="`选择 ${color}`"
              :aria-label="`选择画笔颜色 ${color}`"
              @click="drawingColor = color"
            />
          </span>
          <button
            type="button"
            class="icon-btn"
            title="撤销笔迹"
            aria-label="撤销笔迹"
            :disabled="currentStrokes.length === 0"
            @click="undoStroke"
          >
            <Undo2 :size="17" />
          </button>
          <button
            type="button"
            class="icon-btn"
            title="清空本页笔迹"
            aria-label="清空本页笔迹"
            :disabled="currentStrokes.length === 0"
            @click="clearStrokes"
          >
            <Trash2 :size="17" />
          </button>
        </template>
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
        <button
          type="button"
          class="icon-btn"
          title="幻灯片总览"
          aria-label="幻灯片总览"
          @click="overviewOpen = true"
        >
          <Grid2X2 :size="17" />
        </button>
        <button
          v-if="mode === 'present'"
          type="button"
          class="icon-btn"
          title="演讲者视图"
          aria-label="演讲者视图"
          @click="emit('open-presenter', session.currentPage.value)"
        >
          <MonitorUp :size="18" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ active: isFullscreen }"
          title="切换全屏"
          aria-label="切换全屏"
          @click="toggleFullscreen"
        >
          <Maximize :size="18" />
        </button>
      </div>
    </header>

    <main
      class="viewer-stage"
      @click="onStageClick"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <div class="slide-shell">
        <Transition name="slide-fade" mode="out-in">
          <DeckRenderer
            :key="session.currentPage.value"
            :markdown="presentation.markdown"
            :template-id="presentation.templateId"
            :current-page="session.currentPage.value"
            allow-upscale
          />
        </Transition>
        <DrawingLayer
          v-if="canDraw || currentStrokes.length > 0"
          :strokes="currentStrokes"
          :enabled="drawingEnabled"
          :tool="drawingTool"
          :color="drawingColor"
          :width="drawingTool === 'highlighter' ? 24 : 4"
          @update:strokes="updateStrokes"
        />
      </div>
      <div
        v-if="session.blackout.value !== 'none'"
        class="blackout"
        :class="session.blackout.value"
      />
    </main>

    <div class="progress-track" aria-hidden="true">
      <div class="progress-value" :style="{ width: `${progress}%` }" />
    </div>

    <OverviewGrid
      v-if="overviewOpen"
      :markdown="presentation.markdown"
      :template-id="presentation.templateId"
      :total-pages="totalPages"
      :current-page="session.currentPage.value"
      @select="selectPage"
      @close="overviewOpen = false"
    />
  </div>
</template>

<style scoped>
.presentation-viewer {
  --presentation-bg: #111315;
  --presentation-surface: #1b1e21;
  --presentation-fg: #f7f7f5;
  --presentation-muted: rgba(255, 255, 255, 0.72);
  --presentation-subtle: rgba(255, 255, 255, 0.55);
  --presentation-border: rgba(255, 255, 255, 0.1);
  --presentation-hover: rgba(255, 255, 255, 0.13);
  --presentation-progress-track: rgba(255, 255, 255, 0.12);
  --presentation-overview-bg: rgba(14, 16, 18, 0.98);
  --presentation-empty-bg: #24272b;

  width: 100vw;
  height: 100vh;
  min-width: 0;
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

.presentation-viewer.ui-theme-light {
  --presentation-bg: #eef0f2;
  --presentation-surface: #ffffff;
  --presentation-fg: #202326;
  --presentation-muted: rgba(32, 35, 38, 0.68);
  --presentation-subtle: rgba(32, 35, 38, 0.5);
  --presentation-border: rgba(32, 35, 38, 0.14);
  --presentation-hover: rgba(32, 35, 38, 0.08);
  --presentation-progress-track: rgba(32, 35, 38, 0.14);
  --presentation-overview-bg: rgba(238, 240, 242, 0.98);
  --presentation-empty-bg: #dde1e4;
}

.viewer-toolbar {
  position: relative;
  z-index: 10;
  height: 48px;
  flex: 0 0 48px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--presentation-surface);
  border-bottom: 1px solid var(--presentation-border);
}

.toolbar-group {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-group:last-child {
  justify-content: flex-end;
}

.toolbar-center {
  justify-content: center;
}

.deck-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--presentation-muted);
}

.page-counter {
  width: 74px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--presentation-muted);
}

.icon-btn {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--presentation-muted);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled),
.icon-btn.active {
  color: var(--presentation-fg);
  background: var(--presentation-hover);
}

.icon-btn:disabled {
  opacity: 0.32;
  cursor: default;
}

.color-tools {
  display: flex;
  gap: 3px;
  margin: 0 4px;
}

.theme-toggle {
  display: inline-flex;
  flex: 0 0 auto;
}

.color-swatch {
  width: 17px;
  height: 17px;
  border: 2px solid transparent;
  border-radius: 50%;
  padding: 0;
  cursor: pointer;
}

.color-swatch.active {
  border-color: var(--presentation-fg);
}

.viewer-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: default;
}

.slide-shell {
  position: relative;
  width: min(100%, calc((100vh - 52px) * 16 / 9));
  aspect-ratio: 16 / 9;
  max-height: calc(100vh - 52px);
  overflow: hidden;
  background: #fff;
}

.slide-shell :deep(.deck-renderer) {
  min-height: 0;
  height: 100%;
  padding: 0;
}

.slide-shell :deep(.slide-frame) {
  box-shadow: none;
}

.blackout {
  position: absolute;
  inset: 0;
  z-index: 8;
}

.blackout.black {
  background: #000;
}

.blackout.white {
  background: #fff;
}

.progress-track {
  position: absolute;
  z-index: 12;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--presentation-progress-track);
}

.progress-value {
  height: 100%;
  background: #d86f47;
  transition: width 160ms ease-out;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: opacity 120ms ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .viewer-toolbar {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 4px;
    padding: 0 6px;
  }

  .toolbar-center,
  .deck-title,
  .color-tools {
    display: none;
  }

  .toolbar-group:last-child {
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .toolbar-group:last-child::-webkit-scrollbar {
    display: none;
  }
}
</style>
