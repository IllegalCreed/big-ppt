<script setup lang="ts">
/**
 * 公共栅格组件：一主三从（1 大 + 3 小）。
 *
 * Phase 11.6 起合并 OneLeftThreeRight + OneRightThreeLeft 镜像变体。
 * Phase 11.7 起 direction 扩到 4 方向，取代 OneTopThreeBottom：
 *   - 'left' (默认):  main 在左,  items 在右栏纵向 3 行
 *   - 'right':         main 在右,  items 在左栏纵向 3 行
 *   - 'top':           main 在上,  items 在下行横向 3 列
 *   - 'bottom':        main 在下,  items 在上行横向 3 列
 *
 * 适合"主标题 + 3 要点"或"主图 + 3 注解"类布局。配色读 `--ld-*` token。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 主区位置;默认 'left' = 主区在左,与原 OneLeftThreeRight 行为一致 */
  direction?: 'left' | 'right' | 'top' | 'bottom'
  /** 主区占比（fr 单位）；默认 1，让主从等大 */
  mainFr?: number
}>()

const isVertical = computed(
  () => props.direction === 'top' || props.direction === 'bottom',
)

const containerStyle = computed(() => {
  const fr = props.mainFr ?? 1
  if (isVertical.value) {
    return {
      gridTemplateRows:
        props.direction === 'bottom' ? `1fr ${fr}fr` : `${fr}fr 1fr`,
      gridTemplateColumns: 'minmax(0, 1fr)',
    }
  }
  return {
    gridTemplateColumns:
      props.direction === 'right' ? `1fr ${fr}fr` : `${fr}fr 1fr`,
    gridTemplateRows: 'minmax(0, 1fr)',
  }
})

/** main 在前(left/top)时 order=0,在后(right/bottom)时 order=1 */
const mainOrder = computed(() =>
  props.direction === 'right' || props.direction === 'bottom' ? 1 : 0,
)
const itemsOrder = computed(() => (mainOrder.value === 0 ? 1 : 0))

/** items 内部排布:vertical 时横向 3 列, horizontal 时纵向 3 行 */
const itemsStyle = computed(() =>
  isVertical.value
    ? {
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gridTemplateRows: 'minmax(0, 1fr)',
      }
    : {
        gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
        gridTemplateColumns: 'minmax(0, 1fr)',
      },
)
</script>

<template>
  <div class="ld-one-vs-three" :style="containerStyle" :data-direction="direction ?? 'left'">
    <div class="ld-main" :style="{ order: mainOrder }">
      <slot name="main" />
    </div>
    <div class="ld-items" :style="{ order: itemsOrder, ...itemsStyle }">
      <div class="ld-item"><slot name="item1" /></div>
      <div class="ld-item"><slot name="item2" /></div>
      <div class="ld-item"><slot name="item3" /></div>
    </div>
  </div>
</template>

<style scoped>
.ld-one-vs-three {
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

.ld-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.ld-items {
  display: grid;
  gap: 0.8em;
  min-width: 0;
  min-height: 0;
}

.ld-item {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
