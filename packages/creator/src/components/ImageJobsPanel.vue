<script setup lang="ts">
/**
 * Phase 12.7 dogfood 修正:image-gen job 实时进度面板。
 *
 * 挂在 ChatPanel sender 上方,持久显示 useAIChat 的 imageJobs Map。
 * 跨 turn / 跨 bubble 汇总用户当前所有图片生成任务,4 状态:
 *   - 排队中(pending): 灰圈 ⏳,进度条 5%
 *   - 生成中(running): 蓝圈,进度条 50%~85%
 *   - 完成(done / fallback-rewrote): 绿勾 ✅
 *   - 失败(failed / fallback-failed / cancelled): 红叉 ❌ + errorMsg
 *
 * 排序:已知 slideIndex 升序,未知 slideIndex 排末尾(jobId 字典序兜底)。
 */
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { ImageJobTracking } from '../composables/useAIChat'
import type { ImageJobState } from '../composables/useDecks'

const props = defineProps<{
  jobs: Map<string, ImageJobTracking>
}>()

const emit = defineEmits<{
  /** Phase 11.8 dogfood:用户主动 dismiss 一行 terminal 状态(failed / fallback-* / cancelled) */
  (e: 'dismiss', jobId: string): void
}>()

interface RowVm {
  jobId: string
  slideIndex: number | undefined
  stage: ImageJobState
  progressPct: number
  errorMsg: string | undefined
  /**
   * Phase 11.8 dogfood:加 'warning' variant 区分降级 / 兜底失败(之前都被归到 done/failed)。
   *   - 'done' 完整成功(绿勾)
   *   - 'warning' 降级(黄色感叹号):fallback-rewrote / fallback-failed
   *   - 'failed' 真失败(红叉):failed / cancelled
   */
  variant: 'pending' | 'running' | 'done' | 'warning' | 'failed'
  label: string
  detail: string
  /** 是否还能 cancel(running / pending 时显示 ✕ 按钮) */
  canCancel: boolean
  /** 是否能 dismiss(terminal 非 done 时显示 ✕ 按钮让用户主动关) */
  canDismiss: boolean
}

/**
 * Phase 11.8 dogfood:用户主动取消卡死 job。
 *
 * 背景:OpenAI 出图慢是常态(60-120s),不能加 fetch timeout 误杀正常长任务。
 * 但偶发 OpenAI 上游卡死(observed 卡 12+ 分钟无任何 log),用户没有兜底入口。
 *
 * 修复:在 running / pending 行右侧暴露 ✕ 按钮,点击调 tracking.instance.cancel()
 * → backend DELETE /api/image-jobs/<jobId> → worker controller.abort() → fetch
 * 主动断 → worker catch 走 fallback-rewrote 兜底重写为组件版。
 *
 * cancellingIds 防双击同时 fire 多次 cancel;状态机由 backend 推进到 cancelled
 * /failed terminal 后行变红叉,Map prune timer 5s 自动消失。
 */
const cancellingIds = ref<Set<string>>(new Set())

async function onCancel(jobId: string): Promise<void> {
  if (cancellingIds.value.has(jobId)) return
  const tracking = props.jobs.get(jobId)
  if (!tracking) return
  cancellingIds.value.add(jobId)
  try {
    await tracking.instance.cancel()
  } finally {
    cancellingIds.value.delete(jobId)
  }
}

function classifyVariant(stage: ImageJobState): RowVm['variant'] {
  if (stage === 'pending') return 'pending'
  if (stage === 'running') return 'running'
  if (stage === 'done') return 'done'
  // Phase 11.8 dogfood:fallback-rewrote / fallback-failed 是降级,跟"完整成功"区分开
  if (stage === 'fallback-rewrote' || stage === 'fallback-failed') return 'warning'
  return 'failed'
}

function stageLabel(stage: ImageJobState, ratio: number): string {
  switch (stage) {
    case 'pending':
      return '排队中'
    case 'running':
      return `生成中 ${Math.round(ratio * 100)}%`
    case 'done':
      return '完成'
    case 'fallback-rewrote':
      // Phase 11.8 dogfood:这是降级,不是"完成"。文案要让用户知道图没出来,降级为组件版了
      return '出图失败,已降级为组件版'
    case 'failed':
      return '失败'
    case 'fallback-failed':
      return '失败(兜底重写也失败)'
    case 'cancelled':
      return '已取消'
  }
}

const rows = computed<RowVm[]>(() => {
  const list = [...props.jobs.values()].map((j) => {
    const variant = classifyVariant(j.stage)
    return {
      jobId: j.jobId,
      slideIndex: j.slideIndex,
      stage: j.stage,
      progressPct: Math.round(j.progressRatio * 100),
      errorMsg: j.errorMsg,
      variant,
      // slideIndex 已经是 1-based(tool prompt 约定,见 generate-slide-image.ts:143),
      // 直接用,不再 +1(2026-05-16 dogfood 修正:之前显示「第 3/4 页」实际是「第 2/3 页」)。
      label: j.slideIndex !== undefined ? `第 ${j.slideIndex} 页` : '排队中…',
      detail: stageLabel(j.stage, j.progressRatio),
      canCancel: variant === 'running' || variant === 'pending',
      canDismiss: variant === 'warning' || variant === 'failed',
    }
  })
  list.sort((a, b) => {
    const ai = a.slideIndex ?? Number.MAX_SAFE_INTEGER
    const bi = b.slideIndex ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.jobId.localeCompare(b.jobId)
  })
  return list
})

const totalCount = computed(() => rows.value.length)
const doneCount = computed(() => rows.value.filter((r) => r.variant === 'done').length)
// Phase 11.8 dogfood:counts 把 warning(fallback-rewrote / fallback-failed)也算进失败
// 桶,header 显示「失败 N」让用户一眼知道有 N 页没出来真图(组件版兜底)
const failedCount = computed(
  () => rows.value.filter((r) => r.variant === 'failed' || r.variant === 'warning').length,
)
</script>

<template>
  <div v-if="rows.length > 0" class="image-jobs-panel" role="status" aria-live="polite">
    <div class="header">
      <span class="title">图片生成进度</span>
      <span class="counts">{{ doneCount }} / {{ totalCount }}<span v-if="failedCount > 0" class="failed-count"> · 失败 {{ failedCount }}</span></span>
    </div>
    <ul class="list">
      <li v-for="row in rows" :key="row.jobId" :class="['row', `row-${row.variant}`]">
        <span class="icon" aria-hidden="true">
          <template v-if="row.variant === 'pending'">⏳</template>
          <template v-else-if="row.variant === 'running'">●</template>
          <template v-else-if="row.variant === 'done'">✓</template>
          <template v-else-if="row.variant === 'warning'">⚠</template>
          <template v-else>✕</template>
        </span>
        <span class="label">{{ row.label }}</span>
        <span class="detail" :title="row.errorMsg || ''">{{ row.detail }}</span>
        <span v-if="row.canCancel" class="bar" aria-hidden="true">
          <span class="bar-fill" :style="{ width: row.progressPct + '%' }"></span>
        </span>
        <span v-else class="bar-placeholder" aria-hidden="true" />
        <button
          v-if="row.canCancel"
          type="button"
          class="cancel-btn"
          :disabled="cancellingIds.has(row.jobId)"
          :title="cancellingIds.has(row.jobId) ? '取消中…' : '取消生成(OpenAI 卡死时用)'"
          :aria-label="`取消第 ${row.slideIndex ?? '?'} 页生图`"
          :data-cancel-job-id="row.jobId"
          @click="onCancel(row.jobId)"
        >
          <X :size="12" :stroke-width="2" />
        </button>
        <button
          v-else-if="row.canDismiss"
          type="button"
          class="dismiss-btn"
          :title="row.errorMsg || '知道了,关闭这条提示'"
          :aria-label="`关闭第 ${row.slideIndex ?? '?'} 页提示`"
          :data-dismiss-job-id="row.jobId"
          @click="emit('dismiss', row.jobId)"
        >
          <X :size="12" :stroke-width="2" />
        </button>
        <span v-else class="cancel-placeholder" aria-hidden="true" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.image-jobs-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-1, 4px);
  padding: var(--space-2, 8px) var(--space-3, 12px);
  background: var(--color-bg-subtle, #f7f5f1);
  border-top: 1px solid var(--color-border-subtle, #e7e3dc);
  border-bottom: 1px solid var(--color-border-subtle, #e7e3dc);
  font-size: var(--fs-sm, 13px);
  color: var(--color-text-default, #2a261f);
  max-height: 30vh;
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  font-weight: 500;
  color: var(--color-text-muted, #6f6a60);
}

.title {
  font-size: var(--fs-xs, 12px);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.counts {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-xs, 12px);
}

.failed-count {
  color: var(--color-danger, #c33);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: grid;
  grid-template-columns: 18px 56px 1fr 120px 22px;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: 4px 2px;
  border-radius: var(--radius-sm, 4px);
}

.cancel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--color-text-muted, #6f6a60);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

/* 仅 running / pending 行(.row-running / .row-pending)hover 时显出按钮 */
.row-running:hover .cancel-btn,
.row-pending:hover .cancel-btn,
.cancel-btn:focus-visible {
  opacity: 1;
}

.cancel-btn:hover:not(:disabled) {
  background: var(--color-danger-soft, #ffe8e8);
  color: var(--color-danger, #c33);
}

.cancel-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4 !important;
}

/* Phase 11.8 dogfood:dismiss 按钮(terminal 非 done 时,用户主动关) */
.dismiss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--color-text-muted, #6f6a60);
  cursor: pointer;
  /* dismiss 默认就显示(跟 cancel 的 hover-only 不同),因为用户要主动看到+关 */
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.dismiss-btn:hover {
  opacity: 1;
  background: var(--color-bg-hover, #efeae0);
  color: var(--color-text-default, #2a261f);
}

.icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.row-pending .icon {
  color: var(--color-text-muted, #6f6a60);
}

.row-running .icon {
  color: var(--color-accent, #b65b3d);
  animation: pulse 1.4s ease-in-out infinite;
}

.row-done .icon {
  color: var(--color-success, #2a8a3f);
}

.row-warning .icon {
  color: var(--color-warning, #c08416);
}

.row-failed .icon {
  color: var(--color-danger, #c33);
}

.row-warning .detail {
  color: var(--color-warning, #c08416);
}

.label {
  font-weight: 500;
}

.detail {
  color: var(--color-text-muted, #6f6a60);
  font-size: var(--fs-xs, 12px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-failed .detail {
  color: var(--color-danger, #c33);
}

.bar {
  width: 100%;
  height: 4px;
  background: var(--color-border-subtle, #e7e3dc);
  border-radius: 2px;
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--color-accent, #b65b3d);
  transition: width 0.4s ease-out;
}

.row-pending .bar-fill {
  background: var(--color-text-muted, #6f6a60);
  opacity: 0.5;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
