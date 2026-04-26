<script setup lang="ts">
/**
 * 公共栅格组件：两栏对比 50/50。
 *
 * 用法（写在模板的 content layer-1 layout body 内）：
 *
 *   <TwoCol left-title="旧方案" right-title="新方案">
 *     <template #left>
 *
 *   - 优势 A
 *   - 优势 B
 *
 *     </template>
 *     <template #right>
 *       <MetricGrid ... />
 *     </template>
 *   </TwoCol>
 *
 * 配色 / 字体读 `--ld-*` token，跨模板自动适配。
 */
defineProps<{
  /** 左栏顶部标题（可选） */
  leftTitle?: string
  /** 右栏顶部标题（可选） */
  rightTitle?: string
  /** 中间分隔条；默认 'on' */
  divider?: 'on' | 'off'
}>()
</script>

<template>
  <div class="ld-two-col" :data-divider="divider ?? 'on'">
    <div class="ld-col">
      <h3 v-if="leftTitle" class="ld-col-title">{{ leftTitle }}</h3>
      <div class="ld-col-body">
        <slot name="left" />
      </div>
    </div>
    <div class="ld-divider" />
    <div class="ld-col">
      <h3 v-if="rightTitle" class="ld-col-title">{{ rightTitle }}</h3>
      <div class="ld-col-body">
        <slot name="right" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ld-two-col {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  align-items: stretch;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
}

.ld-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ld-col-title {
  margin: 0 0 0.6em;
  font-size: var(--ld-font-size-h2);
  font-weight: var(--ld-font-weight-bold);
  color: var(--ld-color-brand-primary);
}

.ld-col-body {
  font-size: var(--ld-font-size-body);
  font-weight: var(--ld-font-weight-regular);
  flex: 1;
  min-width: 0;
}

.ld-divider {
  width: var(--ld-border-width-thick);
  background: var(--ld-color-brand-primary);
  align-self: stretch;
}

.ld-two-col[data-divider='off'] .ld-divider {
  display: none;
}
</style>
