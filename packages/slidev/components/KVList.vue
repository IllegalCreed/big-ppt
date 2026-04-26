<script setup lang="ts">
/**
 * 公共内容块组件：键值列表。
 *
 * 展示"label : value"列表（如个人信息 / 项目元数据）；columns 控制几列布局。
 * label 灰色 + UI 字体，value 主文字色 + 品牌字体。配色读 `--ld-*` token。
 */
defineProps<{
  /** 键值对数组（必填） */
  items: Array<{ label: string; value: string }>
  /** 列数；默认 2 */
  columns?: number
}>()
</script>

<template>
  <dl class="ld-kv-list" :style="{ gridTemplateColumns: `repeat(${columns ?? 2}, auto 1fr)` }">
    <template v-for="(item, idx) in items" :key="idx">
      <dt class="ld-kv-label">{{ item.label }}</dt>
      <dd class="ld-kv-value">{{ item.value }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.ld-kv-list {
  display: grid;
  gap: 0.6em 1.2em;
  align-items: baseline;
  font-family: var(--ld-font-family-brand);
  font-size: var(--ld-font-size-body);
  margin: 0;
  padding: 0;
}

.ld-kv-label {
  font-family: var(--ld-font-family-ui);
  color: var(--ld-color-fg-muted);
  font-weight: var(--ld-font-weight-regular);
  white-space: nowrap;
}

.ld-kv-value {
  color: var(--ld-color-fg-primary);
  font-weight: var(--ld-font-weight-bold);
  margin: 0;
  min-width: 0;
}
</style>
