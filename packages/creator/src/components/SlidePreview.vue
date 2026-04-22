<script setup lang="ts">
import { ref } from 'vue'
import { useSlideStore } from '../composables/useSlideStore'

const slideStore = useSlideStore()
const iframeKey = ref(0)

function refresh() {
  slideStore.refresh()
  iframeKey.value++
}

function exportFile() {
  slideStore.exportMarkdown()
}

function present() {
  window.open('http://localhost:3031', '_blank')
}
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <span class="preview-title">幻灯片预览</span>
      <div class="preview-actions">
        <button class="preview-btn" @click="refresh">刷新</button>
        <button class="preview-btn" @click="exportFile">导出 .md</button>
        <button class="preview-btn present-btn" @click="present">放映</button>
      </div>
    </div>
    <div class="preview-frame">
      <iframe
        :key="iframeKey"
        src="http://localhost:3031"
        class="slidev-iframe"
        allow="clipboard-write; screen-wake-lock"
      />
    </div>
  </div>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-surface-2);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3);
  height: 36px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.preview-title {
  font-size: var(--fs-base);
  color: var(--color-fg-tertiary);
  font-weight: var(--fw-medium);
}

.preview-actions {
  display: flex;
  gap: var(--space-2);
}

.preview-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
  color: var(--color-fg-secondary);
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.preview-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.present-btn {
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border-color: var(--color-accent);
}

.present-btn:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-accent-fg);
}

.preview-frame {
  flex: 1;
  padding: var(--space-4);
  display: flex;
}

.slidev-iframe {
  width: 100%;
  height: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
}
</style>
