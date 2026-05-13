<script setup lang="ts">
/**
 * Phase 12 Task I：assistant bubble 的「思考过程」折叠区。
 *
 * - 默认折叠（不挤占聊天主视线）；用户点击 header 展开
 * - 用 `--ld-*` token 保持视觉统一；不 hardcode 颜色
 * - text 走等宽字体 + monospace 渲染，便于阅读 LLM 内部链路
 */
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

defineProps<{ text: string }>()

const expanded = ref(false)
function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="thinking-block" :class="{ expanded }">
    <button
      type="button"
      class="thinking-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <ChevronRight :size="14" :stroke-width="2" class="chevron" />
      <span class="label">思考过程</span>
    </button>
    <pre v-if="expanded" class="thinking-text">{{ text }}</pre>
  </div>
</template>

<style scoped>
.thinking-block {
  margin: var(--space-1, 4px) 0;
  font-size: var(--fs-sm, 12px);
  color: var(--color-fg-tertiary, var(--ld-color-text-muted, #888));
}

.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: inherit;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-sm, 4px);
  transition: background var(--dur-fast, 0.1s) var(--ease-out, ease);
}

.thinking-toggle:hover {
  background: var(--color-bg-subtle, var(--ld-bg-subtle, rgba(0, 0, 0, 0.04)));
}

.chevron {
  transition: transform var(--dur-fast, 0.1s) var(--ease-out, ease);
}

.thinking-block.expanded .chevron {
  transform: rotate(90deg);
}

.thinking-text {
  margin: 6px 0 0 18px;
  padding: var(--space-2, 8px) var(--space-3, 12px);
  background: var(--color-bg-subtle, var(--ld-bg-subtle, rgba(0, 0, 0, 0.03)));
  border-radius: var(--radius-md, 6px);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: var(--fs-xs, 11px);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-fg-secondary, var(--ld-color-text-muted, #555));
  max-height: 360px;
  overflow-y: auto;
}
</style>
