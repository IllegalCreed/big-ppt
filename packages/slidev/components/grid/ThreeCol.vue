<script setup lang="ts">
/**
 * 公共栅格组件：三列均分 1/1/1。
 *
 * 用于左 / 中 / 右三段并列内容；中间一栏常用于装饰组件（PetalFour 等），
 * 左右两栏放文字列表 / 子组件。配色读 `--ld-*` token。
 */
defineProps<{
  /** 各列权重（fr 单位）；默认 '1 1 1' 均分 */
  cols?: string
}>()
</script>

<template>
  <div
    class="ld-three-col"
    :style="{ gridTemplateColumns: cols ?? 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)' }"
  >
    <div class="ld-col">
      <slot name="left" />
    </div>
    <div class="ld-col">
      <slot name="center" />
    </div>
    <div class="ld-col">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.ld-three-col {
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

.ld-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
