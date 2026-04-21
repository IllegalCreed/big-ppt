<script setup lang="ts">
import { ref } from 'vue'
import ChatPanel from './ChatPanel.vue'
import SlidePreview from './SlidePreview.vue'
import SettingsModal from './SettingsModal.vue'

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
  <div class="app-root">
    <header class="toolbar">
      <div class="toolbar-left">
        <h1 class="app-title">Big-PPT Creator</h1>
      </div>
      <div class="toolbar-right">
        <button class="toolbar-btn" @click="showSettings = true">设置</button>
      </div>
    </header>

    <main class="main-content" ref="mainRef">
      <div class="panel-left" :style="{ width: leftWidth + '%' }">
        <ChatPanel />
      </div>
      <div
        class="divider"
        :class="{ active: isDragging }"
        @mousedown="onMouseDown"
      />
      <div class="panel-right">
        <SlidePreview />
      </div>
      <!-- 拖动时覆盖 iframe，防止捕获鼠标事件 -->
      <div v-if="isDragging" class="drag-overlay" />
    </main>

    <SettingsModal v-model:open="showSettings" />
  </div>
</template>

<style scoped>
.app-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #333;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
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
  background: #e8e8e8;
  transition: background 0.2s;
  flex-shrink: 0;
  position: relative;
}

.divider:hover,
.divider.active {
  background: #1677ff;
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
