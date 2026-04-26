<script setup lang="ts">
/**
 * 公共栅格组件：左主右从（1 大 + 3 小竖排）。
 *
 * 主元素在左，3 个次级元素在右栏纵向排列；适合"主标题 + 3 要点"
 * 或"主图 + 3 注解"类布局。配色读 `--ld-*` token。
 */
defineProps<{
  /** 主区宽度占比（fr 单位）；默认 1，让左右等宽 */
  mainFr?: number
}>()
</script>

<template>
  <div class="ld-one-left-three-right" :style="{ gridTemplateColumns: `${mainFr ?? 1}fr 1fr` }">
    <div class="ld-main">
      <slot name="main" />
    </div>
    <div class="ld-items">
      <div class="ld-item"><slot name="item1" /></div>
      <div class="ld-item"><slot name="item2" /></div>
      <div class="ld-item"><slot name="item3" /></div>
    </div>
  </div>
</template>

<style scoped>
.ld-one-left-three-right {
  display: grid;
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  align-items: stretch;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ld-items {
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 0.8em;
  min-width: 0;
}

.ld-item {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
