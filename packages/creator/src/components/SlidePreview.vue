<script setup lang="ts">
import { computed } from 'vue'
import { Download, Play, RefreshCw } from 'lucide-vue-next'
import { useSlideStore } from '../composables/useSlideStore'

const slideStore = useSlideStore()

// Slidev 原生支持 URL path `/:page` 跳到指定页；带 `?t=token` 在 token 变化时强制 iframe 重载
// （Vue 看到 src 改变就会重新挂载 iframe）。
const iframeSrc = computed(
  () => `http://localhost:3031/${slideStore.currentPage.value}?t=${slideStore.refreshToken.value}`,
)
const presentSrc = computed(() => `http://localhost:3031/${slideStore.currentPage.value}`)

function refresh() {
  slideStore.refresh()
}

function exportFile() {
  slideStore.exportMarkdown()
}

function present() {
  window.open(presentSrc.value, '_blank')
}
</script>

<template>
  <div class="preview-panel">
    <div class="preview-toolbar">
      <div class="preview-title-group">
        <span class="preview-dot" />
        <span class="preview-title">幻灯片预览</span>
      </div>
      <div class="preview-actions">
        <button
          type="button"
          class="icon-btn"
          title="刷新预览"
          aria-label="刷新预览"
          @click="refresh"
        >
          <RefreshCw :size="16" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="导出 .md"
          aria-label="导出 .md"
          @click="exportFile"
        >
          <Download :size="16" :stroke-width="1.8" />
        </button>
        <button type="button" class="cta-btn" title="全屏放映" @click="present">
          <Play :size="14" :stroke-width="2" fill="currentColor" />
          <span>放映</span>
        </button>
      </div>
    </div>
    <div class="preview-frame">
      <iframe
        :src="iframeSrc"
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
  padding: 0 var(--space-4);
  height: 44px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.preview-title-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.preview-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.preview-title {
  font-size: var(--fs-base);
  color: var(--color-fg-secondary);
  font-weight: var(--fw-medium);
  letter-spacing: 0.02em;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.icon-btn {
  width: 30px;
  height: 30px;
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

.cta-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  padding: 0 var(--space-3);
  margin-left: var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.cta-btn:hover {
  background: var(--color-accent-hover);
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
