<script setup lang="ts">
/**
 * Phase 12 Task I：Anthropic prompt cache 命中提示（assistant bubble 下方小字）。
 *
 * - 显示「本轮命中缓存 N tokens / 计费 M tokens（节省 X%）」
 * - 节省比例 = cached / (cached + cost)，分母为 0 时不显示比例
 * - 全部用 `--ld-*` token，不 hardcode 颜色
 */
import { computed } from 'vue'

const props = defineProps<{ cached: number; cost: number }>()

const savedPercent = computed(() => {
  const total = props.cached + props.cost
  if (total <= 0) return null
  return Math.round((props.cached / total) * 100)
})
</script>

<template>
  <div class="cache-hint">
    本轮命中缓存 {{ cached }} tokens / 计费 {{ cost }} tokens
    <span v-if="savedPercent !== null"> · 节省 {{ savedPercent }}%</span>
  </div>
</template>

<style scoped>
.cache-hint {
  display: inline-block;
  margin: 4px 0 0;
  padding: 2px 8px;
  font-size: var(--fs-xs, 11px);
  color: var(--color-fg-tertiary, var(--ld-color-text-subtle, #888));
  background: var(--color-bg-subtle, var(--ld-bg-subtle, rgba(0, 0, 0, 0.03)));
  border-radius: var(--radius-sm, 4px);
  letter-spacing: 0.02em;
}
</style>
