<!--
  Phase 16：编辑器主视图预览 + creator 原生放映入口。

  iframe 时代 → DeckRenderer。结构：
    - 顶部 toolbar：翻页 / 全屏放映
      (Phase 15 落地后导出走顶栏「导出」modal,SlidePreview 不再带 export 按钮)
    - 内容区：<DeckRenderer> 单页模式（currentPage 跟 slideStore 联动）

  放映直接打开 `/decks/:id/present`，复用 DeckRenderer，不请求单实例锁。
-->
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ChevronLeft, ChevronRight, Play } from 'lucide-vue-next'
import { useSlideStore } from '../composables/useSlideStore'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'

const props = defineProps<{
  deckId: number
  templateId: string
  /** 父组件已拉到的 currentVersion.content；首屏直接渲染不再多发一次请求 */
  initialContent: string
}>()

const slideStore = useSlideStore()
const presentError = ref<string | null>(null)

// 绑定 deckId 到 slideStore + 写入初始内容；
// 后续 LLM tool / 切模板 / 时间线回滚由各 composable 调 slideStore.refresh()
// 走 deck-scoped 路径同步。
onMounted(() => {
  slideStore.initDeck(props.deckId, props.initialContent)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

// 翻页器：toolbar 显示「< N / M >」+ 全局键盘 ← → 翻页
const currentPage = computed(() => slideStore.currentPage.value)
const totalPages = computed(() => slideStore.totalPages.value)
const canPrev = computed(() => currentPage.value > 1)
const canNext = computed(() => currentPage.value < totalPages.value)

function prevPage() {
  if (canPrev.value) slideStore.setPage(currentPage.value - 1)
}
function nextPage() {
  if (canNext.value) slideStore.setPage(currentPage.value + 1)
}

function onKey(e: KeyboardEvent) {
  // 焦点在 input / textarea / contenteditable 时不抢键盘 —— ChatPanel 输入框不能被
  // 翻页键劫持。其他场景（点了 preview 区域 / 全局未输入态）才生效。
  const t = e.target as HTMLElement | null
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) {
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    prevPage()
    e.preventDefault()
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
    nextPage()
    e.preventDefault()
  }
}

function present() {
  presentError.value = null
  const url = `/decks/${props.deckId}/present?page=${slideStore.currentPage.value}`
  if (!window.open(url, '_blank')) presentError.value = '浏览器阻止了放映窗口，请允许弹出窗口后重试'
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
        <div class="page-nav" v-if="totalPages > 0">
          <button
            type="button"
            class="icon-btn"
            :disabled="!canPrev"
            title="上一页（← / PageUp）"
            aria-label="上一页"
            @click="prevPage"
          >
            <ChevronLeft :size="16" :stroke-width="1.8" />
          </button>
          <span class="page-indicator">{{ currentPage }} / {{ totalPages }}</span>
          <button
            type="button"
            class="icon-btn"
            :disabled="!canNext"
            title="下一页（→ / Space / PageDown）"
            aria-label="下一页"
            @click="nextPage"
          >
            <ChevronRight :size="16" :stroke-width="1.8" />
          </button>
        </div>
        <button type="button" class="cta-btn" title="全屏放映" @click="present">
          <Play :size="14" :stroke-width="2" fill="currentColor" />
          <span>放映</span>
        </button>
      </div>
    </div>
    <div v-if="presentError" class="error-banner">
      <span>{{ presentError }}</span>
    </div>
    <div class="preview-frame">
      <DeckRenderer
        :markdown="slideStore.content.value"
        :template-id="templateId"
        :current-page="slideStore.currentPage.value"
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

.page-nav {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: var(--space-2);
  padding-right: var(--space-2);
  border-right: 1px solid var(--color-border-subtle);
}

.page-indicator {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  min-width: 48px;
  text-align: center;
  user-select: none;
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

.icon-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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

.cta-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.cta-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.error-banner {
  padding: var(--space-2) var(--space-4);
  background: rgba(212, 136, 6, 0.08);
  color: #d48806;
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--color-border-subtle);
}

.preview-frame {
  flex: 1;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: auto;
  min-height: 0;
}
</style>
