<script setup lang="ts">
/** Phase 12.7 Task G：单次 tool execution 状态块 —— pending/running/done/error 四态 + 折叠详情。 */
import { computed } from 'vue'
import type { ToolExecutionStateName } from '../composables/useAIChat'
import { useMoodBoardPicker } from '../composables/useMoodBoardPicker'

const props = defineProps<{
  toolName: string
  state: ToolExecutionStateName
  argsPreview?: string
  resultPreview?: string
}>()

/**
 * Phase 11.8 dogfood 修正:`generate_slide_image` 工具在 backend 入口
 * polling 等 anchor 决策时,frontend SSE 看到的 tool_execution.start 已派发,
 * 显示「执行中」会让用户误以为 OpenAI 已经在烧 token。实际此刻 OpenAI 还
 * 没被调用过,只是 worker promise 卡在 polling loop。
 *
 * 启发式判断:picker modal 开着 = 用户尚在决策 = backend tool 大概率在 polling。
 * 改文案让用户不慌(等用户选完 anchor / 取消后 modal 自动关,文案立刻切回「执行中」)。
 */
const picker = useMoodBoardPicker()
const isWaitingForAnchorDecision = computed(
  () =>
    props.toolName === 'generate_slide_image' &&
    props.state === 'running' &&
    picker.open.value,
)

const stateLabel = computed(() => {
  if (isWaitingForAnchorDecision.value) return '等待视觉风格选定'
  switch (props.state) {
    case 'pending': return '排队中'
    case 'running': return '执行中'
    case 'done': return '完成'
    case 'error': return '失败'
    default: return ''
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
/**
 * Phase 12.7-G code review fix：token 命名同步成两层 fallback `--color-* → --ld-*`,
 * 跟 ThinkingBlock / UsageStatsHint 等 peer 一致。`--color-*` 是 creator SPA 自身
 * 的 Lumideck 设计 token（terracotta 暖色系,见 src/styles/tokens.css）;`--ld-*`
 * 仅在 Slidev `.slidev-layout` 子树 resolve（多模板色板),ChatPanel 渲染时不会
 * 命中,但作为 belt-and-suspenders 兜底保留,与 peer 模式对齐。
 */
.tool-execution-block {
  font-size: var(--fs-sm, var(--ld-font-size-sm, 12px));
  padding: var(--space-2, var(--ld-space-2, 6px))
    var(--space-3, var(--ld-space-3, 10px));
  border-radius: var(--radius-sm, var(--ld-radius-sm, 4px));
  background: var(--color-bg-subtle, var(--ld-bg-subtle, #f5f5f5));
  margin: var(--space-1, var(--ld-space-1, 4px)) 0;
  border: 1px solid var(--color-border-subtle, var(--ld-color-border-subtle, transparent));
}

.tool-execution-block.pending {
  background: var(--color-bg-subtle, var(--ld-bg-subtle, #f0f0f0));
  color: var(--color-fg-tertiary, var(--ld-color-text-muted, #888));
}

.tool-execution-block.running {
  background: var(--color-accent-soft, var(--ld-bg-info, #e8f4ff));
  border-color: var(--color-accent, var(--ld-color-info, #6aa1d6));
}

.tool-execution-block.done {
  background: var(--color-success-soft, var(--ld-bg-success, #e8ffe8));
  border-color: var(--color-success, var(--ld-color-success, #4a9d4a));
}

.tool-execution-block.error {
  background: var(--color-danger-soft, var(--ld-bg-danger, #ffe8e8));
  border-color: var(--color-danger, var(--ld-color-danger, #c14747));
}

.tool-exec-header {
  display: flex;
  gap: var(--space-2, var(--ld-space-2, 8px));
  align-items: center;
}

.tool-name {
  font-weight: var(--fw-medium, 500);
  font-family: var(--font-mono, var(--ld-font-family-mono, monospace));
}

.tool-state {
  color: var(--color-fg-muted, var(--ld-color-text-muted, #888));
  font-size: var(--fs-xs, var(--ld-font-size-xs, 11px));
}

.tool-exec-details {
  margin-top: var(--space-1, var(--ld-space-1, 4px));
}

.tool-exec-details summary {
  cursor: pointer;
  font-size: var(--fs-xs, var(--ld-font-size-xs, 11px));
  color: var(--color-fg-tertiary, var(--ld-color-text-muted, #999));
  user-select: none;
}

.tool-exec-args,
.tool-exec-result {
  font-size: var(--fs-xs, var(--ld-font-size-xs, 11px));
  overflow-x: auto;
  margin-top: var(--space-1, var(--ld-space-1, 4px));
  padding: var(--space-1, var(--ld-space-1, 4px))
    var(--space-2, var(--ld-space-2, 6px));
  background: var(--color-bg-surface, var(--ld-bg-page, #fff));
  border-radius: var(--radius-sm, var(--ld-radius-sm, 3px));
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
