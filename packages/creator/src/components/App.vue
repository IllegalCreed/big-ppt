<script setup lang="ts">
import { ref } from 'vue'
import { ConfigProvider, theme, type ThemeConfig } from 'antdv-next'
import ChatPanel from './ChatPanel.vue'
import SlidePreview from './SlidePreview.vue'
import SettingsModal from './SettingsModal.vue'

const antdTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#C15F3C',
    colorPrimaryHover: '#A94E2E',
    colorPrimaryActive: '#A94E2E',
    colorSuccess: '#6B8E4E',
    colorWarning: '#C98A2B',
    colorError: '#B4472C',
    colorInfo: '#C15F3C',
    colorTextBase: '#1F1E1B',
    colorBgBase: '#FBF9F2',
    colorBorder: '#E3DCC8',
    borderRadius: 8,
    borderRadiusSM: 4,
    borderRadiusLG: 12,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    fontSize: 14,
  },
}

const showSettings = ref(false)
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
</script>

<template>
  <ConfigProvider :theme="antdTheme">
    <div class="app-root">
      <header class="toolbar">
        <div class="toolbar-left">
          <h1 class="app-title">
            <span class="app-title__en">Lumideck</span>
            <span class="app-title__sep">·</span>
            <span class="app-title__cn">幻光千叶</span>
          </h1>
        </div>
        <div class="toolbar-right">
          <button class="toolbar-btn" @click="showSettings = true">设置</button>
        </div>
      </header>

      <main class="main-content" ref="mainRef">
        <div class="panel-left" :style="{ width: leftWidth + '%' }">
          <ChatPanel />
        </div>
        <div class="divider" :class="{ active: isDragging }" @mousedown="onMouseDown" />
        <div class="panel-right">
          <SlidePreview />
        </div>
        <!-- 拖动时覆盖 iframe，防止捕获鼠标事件 -->
        <div v-if="isDragging" class="drag-overlay" />
      </main>

      <SettingsModal v-model:open="showSettings" />
    </div>
  </ConfigProvider>
</template>

<style scoped>
.app-root {
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
  padding: 0 var(--space-5);
  height: 48px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.app-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  margin: 0;
  color: var(--color-fg-primary);
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
}

.app-title__en {
  font-family: var(--font-serif);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.01em;
}

.app-title__sep {
  color: var(--color-fg-muted);
  font-weight: var(--fw-regular);
}

.app-title__cn {
  font-family: var(--font-sans);
  font-weight: var(--fw-medium);
  letter-spacing: 0.06em;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.toolbar-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--color-fg-secondary);
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.toolbar-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
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
