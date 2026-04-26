<script setup lang="ts">
/**
 * 公共栅格组件：上主下从（1 大 + 3 等列）。
 *
 * 主元素占顶部一行，下方 3 个次级元素水平排列；
 * 适合"主标题 / 引言句 + 3 要点 / 3 阶段"类布局。配色读 `--ld-*` token。
 */
defineProps<{
  /** 主区行高占比（fr 单位）；默认 1，让上下等高 */
  mainFr?: number
}>()
</script>

<template>
  <div class="ld-one-top-three-bottom" :style="{ gridTemplateRows: `${mainFr ?? 1}fr 1fr` }">
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
.ld-one-top-three-bottom {
  display: grid;
  gap: 1.2em;
  width: 100%;
  height: 100%;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ld-items {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1em;
  min-height: 0;
}

.ld-item {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
