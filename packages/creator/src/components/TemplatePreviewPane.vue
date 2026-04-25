<script setup lang="ts">
import type { TemplateManifest } from '@big-ppt/shared'

defineProps<{
  manifest: TemplateManifest
  showSwitchWarning: boolean
}>()

function thumbnailUrl(m: TemplateManifest): string {
  // 同 TemplateCard：走 /api 前缀，agent 提供静态文件路由
  return m.thumbnail ? `/api/templates/${m.id}/${m.thumbnail}` : ''
}
</script>

<template>
  <div class="tpl-preview">
    <div class="tpl-preview__thumb">
      <img v-if="manifest.thumbnail" :src="thumbnailUrl(manifest)" :alt="manifest.name" />
      <div v-else class="tpl-preview__thumb-fallback">
        <span>{{ manifest.name }}</span>
      </div>
    </div>
    <div class="tpl-preview__body">
      <h4 class="tpl-preview__name">{{ manifest.name }}</h4>
      <p v-if="manifest.description" class="tpl-preview__desc">{{ manifest.description }}</p>
      <div v-if="showSwitchWarning" class="tpl-preview__warning" role="alert">
        <strong>切换会触发：</strong>
        <ul>
          <li>AI 用新模板风格重写全部内容</li>
          <li>当前版本自动保存快照</li>
          <li>失败或不满意可用 <code>/undo</code> 回退</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  min-height: 320px;
}
.tpl-preview__thumb {
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg-subtle);
}
.tpl-preview__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-preview__thumb-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fg-muted);
  background: linear-gradient(135deg, var(--color-accent-soft), var(--color-bg-subtle));
}
.tpl-preview__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tpl-preview__name {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}
.tpl-preview__desc {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  line-height: 1.6;
}
.tpl-preview__warning {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid rgba(180, 71, 44, 0.3);
  border-radius: var(--radius-md);
  background: rgba(180, 71, 44, 0.06);
  color: var(--color-fg-primary);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.tpl-preview__warning ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}
.tpl-preview__warning code {
  background: rgba(180, 71, 44, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.85em;
}
</style>
