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
import { computed } from 'vue'
import type { ImageJobTracking } from '../composables/useAIChat'
import type { ImageJobState } from '../composables/useDecks'

const props = defineProps<{
  jobs: Map<string, ImageJobTracking>
}>()

interface RowVm {
  jobId: string
  slideIndex: number | undefined
  stage: ImageJobState
  progressPct: number
  errorMsg: string | undefined
  variant: 'pending' | 'running' | 'done' | 'failed'
  label: string
  detail: string
}

function classifyVariant(stage: ImageJobState): RowVm['variant'] {
  if (stage === 'pending') return 'pending'
  if (stage === 'running') return 'running'
  if (stage === 'done' || stage === 'fallback-rewrote') return 'done'
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
      return '完成（兜底重写）'
    case 'failed':
      return '失败'
    case 'fallback-failed':
      return '失败（兜底也失败）'
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
const failedCount = computed(() => rows.value.filter((r) => r.variant === 'failed').length)
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
          <template v-else>✕</template>
        </span>
        <span class="label">{{ row.label }}</span>
        <span class="detail" :title="row.errorMsg || ''">{{ row.detail }}</span>
        <span v-if="row.variant === 'running' || row.variant === 'pending'" class="bar" aria-hidden="true">
          <span class="bar-fill" :style="{ width: row.progressPct + '%' }"></span>
        </span>
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
  grid-template-columns: 18px 56px 1fr 120px;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: 4px 2px;
  border-radius: var(--radius-sm, 4px);
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

.row-failed .icon {
  color: var(--color-danger, #c33);
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
