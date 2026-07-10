<script setup lang="ts">
import type { PresentationPayload, PresentationSnapshot } from '@big-ppt/shared'
import { Maximize } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'
import { parseDeck } from '../deck-renderer/parse-deck'
import DrawingLayer from './DrawingLayer.vue'

const props = defineProps<{
  presentation: PresentationPayload
  snapshot: PresentationSnapshot
  connectionState: 'connecting' | 'connected' | 'reconnecting'
}>()

const rootRef = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
const totalPages = computed(() => Math.max(1, parseDeck(props.presentation.markdown).slides.length))
const currentPage = computed(() =>
  Math.min(totalPages.value, Math.max(1, Math.trunc(props.snapshot.page) || 1)),
)
const currentStrokes = computed(() => props.snapshot.drawings[currentPage.value] ?? [])
const connectionLabel = computed(() => {
  if (props.connectionState === 'connected') return '直播中'
  if (props.connectionState === 'reconnecting') return '重新连接中'
  return '连接中'
})

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen()
  else await rootRef.value?.requestFullscreen()
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === rootRef.value
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
</script>

<template>
  <div ref="rootRef" class="live-audience-viewer" data-live-audience>
    <header class="live-toolbar">
      <span class="deck-title">{{ presentation.title }}</span>
      <span class="page-counter">{{ currentPage }} / {{ totalPages }}</span>
      <div class="toolbar-actions">
        <span class="connection-status" :class="connectionState" role="status">
          <span class="status-dot" />
          {{ connectionLabel }}
        </span>
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

    <main class="live-stage">
      <div class="slide-shell">
        <Transition name="slide-fade" mode="out-in">
          <DeckRenderer
            :key="currentPage"
            :markdown="presentation.markdown"
            :template-id="presentation.templateId"
            :current-page="currentPage"
            allow-upscale
          />
        </Transition>
        <DrawingLayer v-if="currentStrokes.length" :strokes="currentStrokes" />
      </div>
      <div v-if="snapshot.blackout !== 'none'" class="blackout" :class="snapshot.blackout" />
    </main>
  </div>
</template>

<style scoped>
.live-audience-viewer {
  --live-bg: #111315;
  --live-surface: #1b1e21;
  --live-fg: #f7f7f5;
  --live-muted: rgba(255, 255, 255, 0.7);
  --live-border: rgba(255, 255, 255, 0.1);
  --live-hover: rgba(255, 255, 255, 0.13);

  width: 100vw;
  height: 100vh;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--live-bg);
  color: var(--live-fg);
  font-family: var(--font-sans);
}

.live-toolbar {
  position: relative;
  z-index: 10;
  height: 44px;
  flex: 0 0 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--live-border);
  background: var(--live-surface);
}

.deck-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--live-muted);
  font-size: 13px;
}

.page-counter {
  width: 72px;
  text-align: center;
  color: var(--live-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.toolbar-actions,
.connection-status {
  display: flex;
  align-items: center;
}

.toolbar-actions {
  min-width: 0;
  justify-content: flex-end;
  gap: 10px;
}

.connection-status {
  gap: 7px;
  color: var(--live-muted);
  font-size: 12px;
}

.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: #d69a41;
}

.connection-status.connected .status-dot {
  background: #22a06b;
}

.connection-status.reconnecting .status-dot {
  animation: status-pulse 1.1s ease-in-out infinite;
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
  color: var(--live-muted);
  cursor: pointer;
}

.icon-btn:hover,
.icon-btn.active {
  background: var(--live-hover);
  color: var(--live-fg);
}

.live-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.slide-shell {
  position: relative;
  width: min(100%, calc((100vh - 44px) * 16 / 9));
  max-height: calc(100vh - 44px);
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #fff;
}

.slide-shell :deep(.deck-renderer) {
  height: 100%;
  min-height: 0;
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

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: opacity 120ms ease-out;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
}

@keyframes status-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 640px) {
  .live-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .page-counter,
  .connection-status {
    display: none;
  }
}
</style>
