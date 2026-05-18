<!--
  Phase 14 Task C：导出弹窗 UI。

  UX 闭环:
  - 顶栏「导出」按钮 → 打开本 modal
  - radio 三选一(PDF / PNG 序列 zip / PPTX),默认 PDF
  - 时间预估提示文本(给用户「同步导出请保持页面打开」的预期)
  - 确认 → 调 useExport().exportDeck(deck, format)
    - loading:禁用所有按钮 + spinner + 进度文本 `第 X/N 页`
    - 错误:红色错误文本 + retry 按钮
    - 成功:200ms 内自动关 modal(给浏览器下载条出现一点时间)
  - 关闭按钮 / 取消按钮:loading 期间 disabled(防中断 capture-pages,防用户认知混乱)

  跟 SettingsModal 视觉风格对齐(同样的 Teleport + .modal-overlay + .modal-content 结构),
  不引入 antdv-next a-modal —— 项目没用 a-modal,统一走自定义 modal。

  测试基建:Teleport 让 VueTestUtils wrapper.find 找不到节点,test 必须用
  document.querySelector(同 SettingsModal.save.test.ts 套路);成功 setTimeout 200ms
  在测试里用 fake timers + advanceTimersByTime 控。
-->
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { X, Loader2, Download as DownloadIcon } from 'lucide-vue-next'
import { useExport, type ExportFormat, type ExportDeckPayload } from '../composables/useExport'

const props = defineProps<{
  open: boolean
  deck: ExportDeckPayload
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const format = ref<ExportFormat>('pdf')
const { exporting, error, progress, exportDeck } = useExport()

/**
 * 成功后 200ms 自动关 modal 的 timer 句柄。CLAUDE.md「前端约定」:
 * 组件内 setTimeout / setInterval 必须在 onUnmounted 清理,否则用户在 200ms 窗口
 * 内导航离开会触发 emit-on-unmounted warning;同一 timer 重复触发也清旧的再起新。
 */
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

function clearAutoCloseTimer() {
  if (autoCloseTimer !== null) {
    clearTimeout(autoCloseTimer)
    autoCloseTimer = null
  }
}

onUnmounted(() => {
  clearAutoCloseTimer()
})

/** 关 modal(loading 期间不允许)*/
function close() {
  if (exporting.value) return
  emit('update:open', false)
}

/** 重置 modal 状态(关弹窗后再打开应回到 fresh:format=pdf / error=null)*/
watch(
  () => props.open,
  (open) => {
    if (open) {
      format.value = 'pdf'
      error.value = null
    }
  },
)

async function onConfirm() {
  try {
    await exportDeck(props.deck, format.value)
    // 成功:200ms 内自动关 modal(让浏览器下载条先出现);先清旧 timer 避叠加
    clearAutoCloseTimer()
    autoCloseTimer = setTimeout(() => {
      emit('update:open', false)
      autoCloseTimer = null
    }, 200)
  } catch {
    // useExport 已设 error.value,这里吞掉防 console 红;UI 渲染错误态 + retry
  }
}

async function onRetry() {
  await onConfirm()
}

/**
 * Phase 15 Task D:进度文本根据 format 切换。
 * - client 截图链路(pdf/pptx/png-zip):后端无 hook,有 done/total → "第 X/Y 页"
 * - lumideck 后端归档:single shot 无逐页 hook,显示 indeterminate "正在打包..."
 *
 * 走 computed 而非 template inline:CLAUDE.md「Vue setup() 内派生对象一律 computed」
 * + 三态分支放 template 内会让嵌套变重;集中到 setup 便于将来扩格式。
 */
const progressText = computed(() => {
  if (!progress.value) return '正在导出...'
  if (format.value === 'lumideck') return '正在打包...'
  return `正在导出 第 ${progress.value.done}/${progress.value.total} 页`
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay">
      <div class="modal-content" role="dialog" aria-labelledby="export-modal-title">
        <div class="modal-header">
          <h3 id="export-modal-title">导出 Deck</h3>
          <button
            type="button"
            class="close-btn"
            aria-label="关闭"
            :disabled="exporting"
            @click="close"
          >
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-body">
          <section class="form-section">
            <header class="section-header">
              <span class="section-title">选择导出格式</span>
              <span class="section-hint">同步导出请保持页面打开</span>
            </header>
            <div class="format-options" role="radiogroup" aria-label="导出格式">
              <label class="format-option" :class="{ active: format === 'pdf' }">
                <input
                  v-model="format"
                  type="radio"
                  name="export-format"
                  value="pdf"
                  :disabled="exporting"
                  data-test="format-pdf"
                />
                <div class="format-meta">
                  <span class="format-name">PDF</span>
                  <span class="format-hint">≈ 12 秒 · 单文件,适合打印 / 邮件分发</span>
                </div>
              </label>
              <label class="format-option" :class="{ active: format === 'png-zip' }">
                <input
                  v-model="format"
                  type="radio"
                  name="export-format"
                  value="png-zip"
                  :disabled="exporting"
                  data-test="format-png-zip"
                />
                <div class="format-meta">
                  <span class="format-name">PNG 序列(zip)</span>
                  <span class="format-hint">≈ 10 秒 · 每页一张高清 PNG,适合二次编辑</span>
                </div>
              </label>
              <label class="format-option" :class="{ active: format === 'pptx' }">
                <input
                  v-model="format"
                  type="radio"
                  name="export-format"
                  value="pptx"
                  :disabled="exporting"
                  data-test="format-pptx"
                />
                <div class="format-meta">
                  <span class="format-name">PPTX</span>
                  <span class="format-hint">≈ 15 秒 · PowerPoint 文件,每页为背景图(不可编辑)</span>
                </div>
              </label>
              <label class="format-option" :class="{ active: format === 'lumideck' }">
                <input
                  v-model="format"
                  type="radio"
                  name="export-format"
                  value="lumideck"
                  :disabled="exporting"
                  data-test="format-lumideck"
                />
                <div class="format-meta">
                  <span class="format-name">归档包 (.lumideck)</span>
                  <span class="format-hint">≈ 3 秒 · 给其他 Lumideck 用户导入用</span>
                </div>
              </label>
            </div>
          </section>

          <div v-if="exporting" class="progress-row" data-test="export-progress">
            <Loader2 class="spinner" :size="16" :stroke-width="2" />
            <span class="progress-text">{{ progressText }}</span>
          </div>

          <div v-if="error && !exporting" class="error-row" data-test="export-error">
            <span class="error-text">导出失败:{{ error }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-retry"
              data-test="retry-button"
              @click="onRetry"
            >
              重试
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-ghost"
            data-test="cancel-button"
            :disabled="exporting"
            @click="close"
          >
            取消
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-test="confirm-button"
            :disabled="exporting"
            @click="onConfirm"
          >
            <DownloadIcon :size="14" :stroke-width="2" />
            {{ exporting ? '导出中…' : '开始导出' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(70, 54, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-6);
}

.modal-content {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  width: 520px;
  max-width: 100%;
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
  letter-spacing: 0.01em;
}

.close-btn {
  width: 32px;
  height: 32px;
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

.close-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-fg-primary);
}

.close-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.modal-body {
  padding: 0 var(--space-6) var(--space-4);
  overflow-y: auto;
}

.form-section {
  margin-bottom: var(--space-4);
}

.section-header {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-3);
}

.section-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}

.section-hint {
  font-size: 11px;
  color: var(--color-fg-tertiary);
  margin-top: 2px;
}

.format-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.format-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.format-option:hover {
  background: var(--color-bg-subtle);
}

.format-option.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.format-option input[type='radio'] {
  margin-top: 3px;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.format-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.format-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}

.format-hint {
  font-size: 11px;
  color: var(--color-fg-tertiary);
  margin-top: 2px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  color: var(--color-fg-secondary);
  font-size: var(--fs-sm);
  margin-top: var(--space-3);
}

.spinner {
  animation: spin 1s linear infinite;
  color: var(--color-accent);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.progress-text {
  flex: 1;
}

.error-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: rgba(180, 71, 44, 0.08);
  border: 1px solid rgba(180, 71, 44, 0.24);
  border-radius: var(--radius-md);
  margin-top: var(--space-3);
}

.error-text {
  flex: 1;
  color: #b4472c;
  font-size: var(--fs-sm);
}

.btn-retry {
  flex-shrink: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border-subtle);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-ghost {
  background: transparent;
  color: var(--color-fg-secondary);
  border-color: var(--color-border-subtle);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-subtle);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-accent-fg);
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent);
  filter: brightness(1.05);
}
</style>
