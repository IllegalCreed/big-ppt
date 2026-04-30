<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Play, RefreshCw } from 'lucide-vue-next'
import { useSlideStore } from '../composables/useSlideStore'
import { api, ApiError } from '../api/client'

const slideStore = useSlideStore()
const restarting = ref(false)
const restartError = ref<string | null>(null)

// 走 agent 反代（/api/slidev-preview/*），agent 校验 session cookie + 当前是锁持有者才放行。
// 这样外网拿到 URL 没登录/没占用锁的用户看不到别人的 deck。
//
// Phase 7D fix（hash-mode）：iframe src 不再绑 currentPage，仅 refreshToken 触发 reload。
// Slidev 已切到 routerMode: hash（mirror 写盘时 ensureRouterModeHash 强插），翻页通过
// 修改 contentWindow.location.hash 实现 —— 不触发 iframe full reload，避免 LLM 工具
// 链频繁 setPage 时画面闪烁 + 浏览器扩展 postMessage 在 contentWindow null 瞬间挂错。
const iframeRef = ref<HTMLIFrameElement | null>(null)
const initialPage = slideStore.currentPage.value // 仅用作 mount 时的初始 hash

// effectiveToken 跟随 store.refreshToken 但延后到 Slidev 反代 ready 才同步——避免切模板
// 这种"slides.md 大改"触发 Slidev vite full reload 的几百 ms 窗口里 iframe 撞 502。
// 见 onWatch(refreshToken) 里的 probeSlidevReady 逻辑。
const effectiveToken = ref(slideStore.refreshToken.value)
const iframeSrc = computed(
  () => `/api/slidev-preview/?t=${effectiveToken.value}#/${initialPage}`,
)
const presentSrc = computed(() => `/api/slidev-preview/#/${slideStore.currentPage.value}`)

/** 探测 Slidev 反代是否就绪（最多 timeoutMs，每 300ms 重试） */
async function probeSlidevReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/slidev-preview/', { credentials: 'include' })
      if (res.ok) return true
    } catch {
      /* 网络/反代错就 retry */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// refreshToken bump → 等 Slidev 重启稳态再切 iframe src（仅切模板/restore 这种大改场景重要；
// 手动刷新按钮路径下 Slidev 没在 reload，probe 第一次就 ok，几乎无延迟）
watch(
  () => slideStore.refreshToken.value,
  async (newToken) => {
    await probeSlidevReady(5000)
    effectiveToken.value = newToken // 即便超时也 sync，让 iframe 至少尝试加载
  },
)

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

/**
 * dogfood 后改造:这个按钮原来只是 slideStore.refresh() 让 iframe 重 load HTML,
 * 但 Slidev / Vite dev server 进程内的 vite module cache 在 long session 累积错位
 * 后,iframe reload 拿到的 HTML 还是错的(layout component 缓存对不上)。
 *
 * 改成调 POST /api/slidev-restart 真重启 Slidev 进程清进程内存:
 * - production: agent execFile pm2 restart lumideck-slidev
 * - development: agent 返 503 + 提示用户手动 cmd+C / pnpm dev
 *
 * 重启后 1.5s 等 Slidev ready,再 slideStore.refresh() 让 iframe reload 拿干净 HTML。
 *
 * 保护:LLM 工作中(slideStore.aiBusy)弹 confirm,允许用户在卡死场景强制重启,但默认警示。
 */
async function refresh() {
  if (restarting.value) return
  // LLM 工作中重启会中断 tool_call(slides.md 写一半,Slidev 起来读到中间态)。
  // 弹 confirm 而不是直接 disable,允许用户在卡死场景仍能强制重启。
  if (slideStore.aiBusy.value) {
    const ok = window.confirm(
      'AI 正在生成或调用工具,重启 Slidev 会中断当前任务并可能让 slides.md 落到不完整中间态。\n\n仅在 SlidePreview 卡死或渲染严重错乱时才强制重启,否则建议等 AI 完成后再操作。\n\n确定要现在重启吗?',
    )
    if (!ok) return
  }
  restarting.value = true
  restartError.value = null
  try {
    await api.post<{ success: boolean; message?: string }>('/api/slidev-restart', {})
    // 给 Slidev 进程 1.5s 起来再 reload iframe(probeSlidevReady 会进一步等)
    await new Promise((r) => setTimeout(r, 1500))
    slideStore.refresh()
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      // dev 模式 fallback:仅 iframe reload(虽然不能根治,但优于啥都不做)
      restartError.value = err.message || '当前是 dev 模式,仅 iframe reload(请手动重启 pnpm dev 根治)'
      slideStore.refresh()
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
          :class="{ 'icon-btn--busy': slideStore.aiBusy.value, 'icon-btn--restarting': restarting }"
          :title="
            restarting
              ? '正在重启 Slidev...'
              : slideStore.aiBusy.value
                ? '⚠️ AI 工作中,重启会中断当前任务(慎重)'
                : '重启 Slidev 预览(清 vite HMR 缓存,1-2s 等待)'
          "
          aria-label="重启 Slidev 预览"
          :disabled="restarting"
          @click="refresh"
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
        <button type="button" class="cta-btn" title="全屏放映" @click="present">
          <Play :size="14" :stroke-width="2" fill="currentColor" />
          <span>放映</span>
        </button>
      </div>
    </div>
    <div class="preview-frame">
      <!--
        Phase 9-C（A03 防御）：iframe sandbox 限制 Slidev 内潜在 XSS 利用面。
        - allow-same-origin：保留 contentWindow.location.hash 翻页能力（同源 iframe）
        - allow-scripts：Slidev / Vite HMR / iframe 内 Vue 必需
        - allow-forms：Slidev 内 form 元素（presenter 设置面板等）
        - allow-popups：presenter 全屏放映 window.open 需要
        - allow-popups-to-escape-sandbox：popup 窗口（present view）不继承 sandbox 限制
      -->
      <iframe
        ref="iframeRef"
        :src="iframeSrc"
        class="slidev-iframe"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
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

.icon-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

/* AI 工作中:橙色警示色,鼠标悬停时不变绿(避免误以为可安全点) */
.icon-btn--busy {
  color: #d48806;
}
.icon-btn--busy:hover:not(:disabled) {
  background: rgba(212, 136, 6, 0.08);
  color: #d48806;
}

/* 正在重启:icon 旋转动画 */
.icon-btn--restarting .spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
