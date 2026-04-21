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
  background: #e8e8e8;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  flex-shrink: 0;
}

.preview-title {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.preview-actions {
  display: flex;
  gap: 6px;
}

.preview-btn {
  padding: 2px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  color: #333;
}

.preview-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.present-btn {
  background: #1677ff;
  color: #fff;
  border-color: #1677ff;
}

.present-btn:hover {
  background: #4096ff;
  border-color: #4096ff;
  color: #fff;
}

.preview-frame {
  flex: 1;
  padding: 12px;
  display: flex;
}

.slidev-iframe {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
