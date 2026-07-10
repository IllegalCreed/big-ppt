<script setup lang="ts">
import { X } from 'lucide-vue-next'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'

defineProps<{
  markdown: string
  templateId: string
  totalPages: number
  currentPage: number
}>()

const emit = defineEmits<{
  select: [page: number]
  close: []
}>()
</script>

<template>
  <div class="overview" role="dialog" aria-modal="true" aria-label="幻灯片总览">
    <header class="overview-header">
      <span class="overview-count">{{ totalPages }} 页</span>
      <button
        type="button"
        class="icon-btn"
        title="关闭总览"
        aria-label="关闭总览"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </header>
    <div class="overview-grid">
      <button
        v-for="page in totalPages"
        :key="page"
        type="button"
        class="thumbnail"
        :class="{ active: page === currentPage }"
        :aria-label="`跳转到第 ${page} 页`"
        @click="emit('select', page)"
      >
        <span class="thumbnail-canvas">
          <DeckRenderer :markdown="markdown" :template-id="templateId" :current-page="page" />
        </span>
        <span class="thumbnail-number">{{ page }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.overview {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: rgba(14, 16, 18, 0.98);
  color: #f7f7f5;
}

.overview-header {
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}

.overview-count {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.overview-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  align-content: start;
  gap: 20px;
  padding: 24px;
}

.thumbnail {
  min-width: 0;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  background: #24272b;
  color: #fff;
  cursor: pointer;
  text-align: left;
}

.thumbnail:hover,
.thumbnail.active {
  border-color: #d86f47;
}

.thumbnail-canvas {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #fff;
}

.thumbnail-canvas :deep(.deck-renderer) {
  min-height: 0;
  padding: 0;
}

.thumbnail-canvas :deep(.slide-frame) {
  box-shadow: none;
}

.thumbnail-number {
  display: block;
  padding: 7px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

@media (max-width: 640px) {
  .overview-grid {
    grid-template-columns: 1fr;
    padding: 14px;
  }
}
</style>
