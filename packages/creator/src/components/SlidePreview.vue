<!--
  Phase 10.5 落地：编辑器主视图预览。

  iframe 时代 → DeckRenderer。结构：
    - 顶部 toolbar：重启 Slidev 按钮（仅放映场景兜底）/ 导出 .md / 全屏放映
    - 内容区：<DeckRenderer> 单页模式（currentPage 跟 slideStore 联动）

  全屏放映流程（Phase 10.5 新）：
    1. 点「放映」按钮 → POST /api/present/:deckId 抢锁 + 写 slides.md
    2. 200 OK → window.open '/api/slidev-preview/#/<page>' 开新 tab 加载 Slidev SPA
    3. 409 → 在 toolbar 下方 banner 显示「X 正在放映该 deck」

  「重启 Slidev」按钮 Phase 10.5 后：编辑器不再依赖 Slidev runtime，触发场景
  仅剩「放映 tab 内容陈旧 / Slidev dev 进程卡死」的兜底。从 aiBusy 联动改成
  无条件可点；保留 confirm 弹窗避免误点。
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Download, Play, RefreshCw } from 'lucide-vue-next'
import { useSlideStore } from '../composables/useSlideStore'
import { api, ApiError } from '../api/client'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'
import type { LockHolderWire } from '../composables/useDecks'

const props = defineProps<{
  deckId: number
  templateId: string
  /** 父组件已拉到的 currentVersion.content；首屏直接渲染不再多发一次请求 */
  initialContent: string
}>()

const slideStore = useSlideStore()
const restarting = ref(false)
const restartError = ref<string | null>(null)
const presenting = ref(false)
const presentError = ref<string | null>(null)
const presentHolder = ref<LockHolderWire | null>(null)

// 绑定 deckId 到 slideStore + 写入初始内容；
// 后续 LLM tool / 切模板 / 时间线回滚由各 composable 调 slideStore.refresh()
// 走 deck-scoped 路径同步。
onMounted(() => {
  slideStore.initDeck(props.deckId, props.initialContent)
})

/**
 * 重启 Slidev 演讲进程。
 *
 * Phase 10.5 后：编辑器用 DeckRenderer 不依赖 Slidev runtime；此按钮仅在
 * 全屏放映 tab 内容陈旧 / Slidev dev 进程卡死时手工兜底。
 *
 * - production: agent execFile pm2 restart lumideck-slidev
 * - development: agent 返 503 + 提示用户手动 pnpm dev
 */
async function restartSlidev() {
  if (restarting.value) return
  const ok = window.confirm(
    '即将重启 Slidev 演讲进程。这会让正在放映的页面短暂中断（约 1-2 秒）。\n\n仅在放映卡死 / 内容陈旧时使用。确定要继续吗？',
  )
  if (!ok) return
  restarting.value = true
  restartError.value = null
  try {
    await api.post<{ success: boolean; message?: string }>('/api/slidev-restart', {})
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      restartError.value =
        err.message || '当前是 dev 模式，请手动 pnpm dev 重启 slidev 进程'
    } else {
      restartError.value = err instanceof ApiError ? err.message : (err as Error).message
    }
  } finally {
    restarting.value = false
  }
}

function exportFile() {
  slideStore.exportMarkdown()
}

/**
 * 全屏放映：先抢 Slidev 锁 + 同步 slides.md，再 window.open 新 tab。
 */
async function present() {
  if (presenting.value) return
  presenting.value = true
  presentError.value = null
  presentHolder.value = null
  try {
    await api.post<{ ok: true; deckId: number }>(`/api/present/${props.deckId}`, {})
    const url = `/api/slidev-preview/#/${slideStore.currentPage.value}`
    window.open(url, '_blank')
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const body = (err as { body?: unknown }).body as
        | { error?: string; holder?: LockHolderWire }
        | undefined
      if (body?.holder) {
        presentHolder.value = body.holder
        presentError.value = `${body.holder.email} 正在放映该 deck，请稍后再试`
      } else {
        presentError.value = '该 deck 当前被他人放映，请稍后再试'
      }
    } else {
      presentError.value = err instanceof ApiError ? err.message : (err as Error).message
    }
  } finally {
    presenting.value = false
  }
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
          :class="{ 'icon-btn--restarting': restarting }"
          :title="
            restarting
              ? '正在重启 Slidev...'
              : '重启 Slidev 演讲进程（仅放映卡死 / 内容陈旧时使用）'
          "
          aria-label="重启 Slidev 演讲进程"
          :disabled="restarting"
          @click="restartSlidev"
        >
          <RefreshCw :size="16" :stroke-width="1.8" :class="{ spinning: restarting }" />
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
        <button
          type="button"
          class="cta-btn"
          :title="presenting ? '正在抢占 Slidev 演讲锁...' : '全屏放映（演讲模式）'"
          :disabled="presenting"
          @click="present"
        >
          <Play :size="14" :stroke-width="2" fill="currentColor" />
          <span>放映</span>
        </button>
      </div>
    </div>
    <div v-if="restartError || presentError" class="error-banner">
      <span v-if="presentError">⚠️ {{ presentError }}</span>
      <span v-else-if="restartError">⚠️ {{ restartError }}</span>
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

.icon-btn--restarting .spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
