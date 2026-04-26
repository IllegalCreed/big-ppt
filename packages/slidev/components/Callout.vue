<script setup lang="ts">
/**
 * 公共内容块组件：高亮信息块。
 *
 * 三种 type 切换不同语气：info / warning / success。info 配色随模板品牌色，
 * warning / success 走中性 amber / green（避免与品牌色冲突）。
 * 默认 slot 是正文，title 可选。
 */
defineProps<{
  /** 语气；默认 'info' */
  type?: 'info' | 'warning' | 'success'
  /** 标题（可选） */
  title?: string
}>()
</script>

<template>
  <div class="ld-callout" :data-type="type ?? 'info'">
    <div v-if="title" class="ld-callout-title">{{ title }}</div>
    <div class="ld-callout-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ld-callout {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  padding: 0.8em 1em;
  border-radius: var(--ld-radius-md);
  border-left: var(--ld-border-width-thick) solid;
  font-family: var(--ld-font-family-brand);
  font-size: var(--ld-font-size-body);
  color: var(--ld-color-fg-primary);
}

.ld-callout[data-type='info'] {
  background: var(--ld-color-bg-subtle);
  border-color: var(--ld-color-brand-primary);
}

.ld-callout[data-type='warning'] {
  background: rgba(255, 196, 0, 0.12);
  border-color: #d97706; /* amber-600 中性色 */
}

.ld-callout[data-type='success'] {
  background: rgba(34, 197, 94, 0.12);
  border-color: #16a34a; /* green-600 中性色 */
}

.ld-callout-title {
  font-family: var(--ld-font-family-ui);
  font-weight: var(--ld-font-weight-bold);
}

.ld-callout-body {
  font-weight: var(--ld-font-weight-regular);
  line-height: 1.55;
}
</style>
