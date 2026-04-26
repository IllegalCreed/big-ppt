<script setup lang="ts">
/**
 * 公共栅格组件：田字格 2×2。
 *
 * 4 个等大 slot 排成 2 行 2 列；适合"4 维度对比 / 4 季度数据 / 4 优势点"
 * 这种 4 分平等结构。slot 内可放纯文字 / 内容块组件 / 装饰几何（PetalFour
 * 等装饰类组件已自带 4 区，无需再外套此栅格）。配色读 `--ld-*` token。
 */
</script>

<template>
  <div class="ld-two-x-two">
    <div class="ld-cell"><slot name="slot1" /></div>
    <div class="ld-cell"><slot name="slot2" /></div>
    <div class="ld-cell"><slot name="slot3" /></div>
    <div class="ld-cell"><slot name="slot4" /></div>
  </div>
</template>

<style scoped>
.ld-two-x-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1.2em;
  width: 100%;
  height: 100%;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
