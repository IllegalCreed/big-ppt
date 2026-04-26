<script setup lang="ts">
/**
 * 公共栅格组件：右主左从（3 小竖排 + 1 大）。
 *
 * OneLeftThreeRight 的镜像版；主元素在右栏，3 个次级元素在左栏纵向排列。
 * 适合右侧重图 / 重数据，左侧旁注的反向布局。配色读 `--ld-*` token。
 */
defineProps<{
  mainFr?: number
}>()
</script>

<template>
  <div class="ld-one-right-three-left" :style="{ gridTemplateColumns: `1fr ${mainFr ?? 1}fr` }">
    <div class="ld-items">
      <div class="ld-item"><slot name="item1" /></div>
      <div class="ld-item"><slot name="item2" /></div>
      <div class="ld-item"><slot name="item3" /></div>
    </div>
    <div class="ld-main">
      <slot name="main" />
    </div>
  </div>
</template>

<style scoped>
.ld-one-right-three-left {
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
  grid-template-rows: repeat(3, 1fr);
  gap: 0.8em;
  min-width: 0;
}

.ld-item {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
