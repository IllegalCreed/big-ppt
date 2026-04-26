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
/* 4 cell 等大 + gap 视觉对称：让 TwoColumnsTwoRows 整体 1:1 aspect-ratio
 * （2 cell × 2 cell + 2 gap）。cell 自然正方形，水平 / 垂直 gap 视觉一致。
 * minmax(0, 1fr) 防止 cell 内容意外撑高 row。
 */
.ld-two-x-two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 1.5em;
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  margin: 0 auto;
  flex: 0 1 auto;
  min-height: 0;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

/* cell 用 grid + place-items: stretch，让 MetricCard 等块级子组件自动撑满 */
.ld-cell {
  display: grid;
  place-items: stretch;
  min-width: 0;
  min-height: 0;
}
</style>
