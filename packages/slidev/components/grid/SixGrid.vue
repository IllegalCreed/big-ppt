<script setup lang="ts">
/**
 * 公共栅格组件：6 个等分平级元素（5-6 项的容器）。
 *
 * Phase 11.7 新增。layout 决定拓扑：
 *   - '3x2' (默认): 3 行 2 列,适合"6 阶段竖排 / 6 维度对比"
 *   - '2x3':         2 行 3 列,适合"6 项横排展示"
 *
 * slot 容量介于田字格(4 格,medium)和九宫格(9 格,small)之间,适合放短文字 +
 * 单 metric 卡 / 单 icon+短标签;放 BarChart 容易撑爆。配色读 `--ld-*` token。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 布局拓扑;默认 '3x2' = 3 行 2 列 */
  layout?: '2x3' | '3x2'
}>()

const containerStyle = computed(() => {
  if (props.layout === '2x3') {
    return {
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    }
  }
  return {
    gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  }
})
</script>

<template>
  <div class="ld-six-grid" :style="containerStyle" :data-layout="layout ?? '3x2'">
    <div v-for="i in 6" :key="i" class="ld-cell">
      <slot :name="`slot${i}`" />
    </div>
  </div>
</template>

<style scoped>
.ld-six-grid {
  display: grid;
  gap: 1.2em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
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
