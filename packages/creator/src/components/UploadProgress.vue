<script setup lang="ts">
/** Phase 13 Task F:上传进度 chip(filename + size + ✓/✕/↑ icon)。 */
defineProps<{
  filename: string
  sizeBytes: number
  status?: 'uploading' | 'done' | 'error'
  errorMsg?: string
}>()

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}
</script>

<template>
  <div :class="['upload-chip', `upload-chip-${status ?? 'uploading'}`]">
    <span class="icon">
      <template v-if="status === 'done'">✓</template>
      <template v-else-if="status === 'error'">✕</template>
      <template v-else>↑</template>
    </span>
    <span class="filename" :title="filename">{{ filename }}</span>
    <span class="size">{{ fmtSize(sizeBytes) }}</span>
    <span v-if="status === 'error' && errorMsg" class="error" :title="errorMsg">{{ errorMsg }}</span>
  </div>
</template>

<style scoped>
.upload-chip {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  background: var(--color-bg-subtle);
  color: var(--color-fg-secondary);
}
.upload-chip-done {
  color: var(--color-success);
}
.upload-chip-error {
  color: var(--color-danger);
}
.icon {
  width: 14px;
  text-align: center;
  font-family: var(--font-mono);
}
.filename {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  color: var(--color-fg-tertiary);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}
.error {
  color: var(--color-danger);
  font-size: var(--fs-xs);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
