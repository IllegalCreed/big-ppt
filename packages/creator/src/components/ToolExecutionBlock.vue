<script setup lang="ts">
/** Phase 12.7 Task G：单次 tool execution 状态块 —— pending/running/done/error 四态 + 折叠详情。 */
import { computed } from 'vue'

export type ToolExecutionStateName = 'pending' | 'running' | 'done' | 'error'

const props = defineProps<{
  toolName: string
  state: ToolExecutionStateName
  argsPreview?: string
  resultPreview?: string
}>()

const stateLabel = computed(() => {
  switch (props.state) {
    case 'pending': return '排队中'
    case 'running': return '执行中'
    case 'done': return '完成'
    case 'error': return '失败'
  }
})

const hasDetails = computed(() => Boolean(props.argsPreview || props.resultPreview))
</script>

<template>
  <div
    class="tool-execution-block"
    :class="{
      pending: state === 'pending',
      running: state === 'running',
      done: state === 'done',
      error: state === 'error',
    }"
  >
    <div class="tool-exec-header">
      <span class="tool-name">{{ toolName }}</span>
      <span class="tool-state">{{ stateLabel }}</span>
    </div>
    <details v-if="hasDetails" class="tool-exec-details">
      <summary>查看详情</summary>
      <pre v-if="argsPreview" class="tool-exec-args">{{ argsPreview }}</pre>
      <pre v-if="resultPreview" class="tool-exec-result">{{ resultPreview }}</pre>
    </details>
  </div>
</template>

<style scoped>
.tool-execution-block {
  font-size: var(--fs-sm, 12px);
  padding: var(--space-2, 6px) var(--space-3, 10px);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-bg-subtle, #f5f5f5);
  margin: var(--space-1, 4px) 0;
  border: 1px solid var(--color-border-subtle, transparent);
}

.tool-execution-block.pending {
  background: var(--color-bg-subtle, #f0f0f0);
  color: var(--color-fg-tertiary, #888);
}

.tool-execution-block.running {
  background: var(--color-accent-soft, #e8f4ff);
  border-color: var(--color-accent, #6aa1d6);
}

.tool-execution-block.done {
  background: var(--color-success-soft, #e8ffe8);
  border-color: var(--color-success, #4a9d4a);
}

.tool-execution-block.error {
  background: var(--color-danger-soft, #ffe8e8);
  border-color: var(--color-danger, #c14747);
}

.tool-exec-header {
  display: flex;
  gap: var(--space-2, 8px);
  align-items: center;
}

.tool-name {
  font-weight: var(--fw-medium, 500);
  font-family: var(--font-mono, monospace);
}

.tool-state {
  color: var(--color-fg-muted, #888);
  font-size: 11px;
}

.tool-exec-details {
  margin-top: var(--space-1, 4px);
}

.tool-exec-details summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--color-fg-tertiary, #999);
  user-select: none;
}

.tool-exec-args,
.tool-exec-result {
  font-size: 11px;
  overflow-x: auto;
  margin-top: var(--space-1, 4px);
  padding: var(--space-1, 4px) var(--space-2, 6px);
  background: var(--color-bg-surface, #fff);
  border-radius: var(--radius-sm, 3px);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
