<script setup lang="ts">
import type { TemplateManifest } from '@big-ppt/shared'

defineProps<{ manifest: TemplateManifest; active: boolean }>()
defineEmits<{ select: [] }>()

function thumbnailUrl(m: TemplateManifest): string {
  if (!m.thumbnail) return ''
  // 走 /api 前缀，由 agent /api/templates/:id/:filename 路由读 packages/slidev/templates/<id>/ 下文件
  return `/api/templates/${m.id}/${m.thumbnail}`
}
</script>

<template>
  <button
    type="button"
    class="tpl-card"
    :class="{ active }"
    data-template-card
    @click="$emit('select')"
  >
    <div class="tpl-card__thumb">
      <img v-if="manifest.thumbnail" :src="thumbnailUrl(manifest)" :alt="manifest.name" />
      <div v-else class="tpl-card__thumb-fallback" />
    </div>
    <div class="tpl-card__meta">
      <div class="tpl-card__name">{{ manifest.name }}</div>
      <div v-if="manifest.tagline" class="tpl-card__tagline">{{ manifest.tagline }}</div>
    </div>
  </button>
</template>

<style scoped>
.tpl-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.tpl-card:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-subtle);
}
.tpl-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.08);
}
.tpl-card__thumb {
  width: 64px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-subtle);
}
.tpl-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-card__thumb-fallback {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--color-accent-soft), var(--color-bg-subtle));
}
.tpl-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tpl-card__name {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--color-fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-card__tagline {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}
</style>
