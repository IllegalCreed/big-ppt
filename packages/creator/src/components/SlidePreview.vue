<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Play, RefreshCw } from 'lucide-vue-next'
import { useSlideStore } from '../composables/useSlideStore'

const slideStore = useSlideStore()

// 走 agent 反代（/api/slidev-preview/*），agent 校验 session cookie + 当前是锁持有者才放行。
// 这样外网拿到 URL 没登录/没占用锁的用户看不到别人的 deck。
//
// Phase 7D fix（hash-mode）：iframe src 不再绑 currentPage，仅 refreshToken 触发 reload。
// Slidev 已切到 routerMode: hash（mirror 写盘时 ensureRouterModeHash 强插），翻页通过
// 修改 contentWindow.location.hash 实现 —— 不触发 iframe full reload，避免 LLM 工具
// 链频繁 setPage 时画面闪烁 + 浏览器扩展 postMessage 在 contentWindow null 瞬间挂错。
const iframeRef = ref<HTMLIFrameElement | null>(null)
const initialPage = slideStore.currentPage.value // 仅用作 mount 时的初始 hash
const iframeSrc = computed(
  () => `/api/slidev-preview/?t=${slideStore.refreshToken.value}#/${initialPage}`,
)
const presentSrc = computed(() => `/api/slidev-preview/#/${slideStore.currentPage.value}`)

// currentPage 变化 → 写 iframe hash（不重新挂载 iframe）
watch(
  () => slideStore.currentPage.value,
  (page) => {
    const win = iframeRef.value?.contentWindow
    if (!win) return
    try {
      // 同源 iframe（agent 反代到本机 Slidev）能直接读写 location；hash 改不触发 reload
      const wantHash = `#/${page}`
      if (win.location.hash !== wantHash) win.location.hash = wantHash
    } catch {
      /* 跨域或卸载中忽略；下次 refresh 自然对齐 */
    }
  },
)

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
        ref="iframeRef"
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
