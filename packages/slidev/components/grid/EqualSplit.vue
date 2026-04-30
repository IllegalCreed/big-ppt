<script setup lang="ts">
/**
 * 公共栅格组件：2-4 个等分平级元素。
 *
 * Phase 11.7 取代 TwoCol + ThreeCol 两个独立组件。`count` 决定平铺数量,
 * `direction` 决定横排('row',默认)还是竖排('col')。配色读 `--ld-*` token。
 *
 * 用法:
 *   <EqualSplit :count="3">
 *     <template #slot1>A</template>
 *     <template #slot2>B</template>
 *     <template #slot3>C</template>
 *   </EqualSplit>
 *
 * 适合"N 个并列要点 / N 个阶段 / N 列对比"。slot 内可放 markdown / 子组件。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 平级元素数量,2-4 之间 */
  count: 2 | 3 | 4
  /** 排列方向;'row' = 单行多列(横排,默认), 'col' = 单列多行(竖排) */
  direction?: 'row' | 'col'
}>()

const containerStyle = computed(() => {
  const tracks = `repeat(${props.count}, minmax(0, 1fr))`
  return props.direction === 'col'
    ? { gridTemplateRows: tracks, gridTemplateColumns: 'minmax(0, 1fr)' }
    : { gridTemplateColumns: tracks }
})

const slotIndices = computed(() => Array.from({ length: props.count }, (_, i) => i + 1))
</script>

<template>
  <div class="ld-equal-split" :style="containerStyle" :data-count="count" :data-direction="direction ?? 'row'">
    <div v-for="i in slotIndices" :key="i" class="ld-slot">
      <slot :name="`slot${i}`" />
    </div>
  </div>
</template>

<style scoped>
.ld-equal-split {
  display: grid;
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  align-items: stretch;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-slot {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
