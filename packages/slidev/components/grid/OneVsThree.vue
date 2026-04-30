<script setup lang="ts">
/**
 * 公共栅格组件：一主三从（1 大 + 3 小竖排）。
 *
 * Phase 11.6 合并:本组件取代了 OneLeftThreeRight + OneRightThreeLeft 两个镜像变体,
 * 通过 direction prop 切换主区在左还是右。配色读 `--ld-*` token。
 *
 * 适合"主标题 + 3 要点"或"主图 + 3 注解"类布局。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** 主区位置;默认 'left' = 主区在左,与原 OneLeftThreeRight 行为一致 */
  direction?: 'left' | 'right'
  /** 主区宽度占比（fr 单位）；默认 1，让左右等宽 */
  mainFr?: number
}>()

const containerStyle = computed(() => {
  const fr = props.mainFr ?? 1
  return {
    gridTemplateColumns: props.direction === 'right' ? `1fr ${fr}fr` : `${fr}fr 1fr`,
  }
})

const mainOrder = computed(() => (props.direction === 'right' ? 1 : 0))
const itemsOrder = computed(() => (props.direction === 'right' ? 0 : 1))
</script>

<template>
  <div class="ld-one-vs-three" :style="containerStyle">
    <div class="ld-main" :style="{ order: mainOrder }">
      <slot name="main" />
    </div>
    <div class="ld-items" :style="{ order: itemsOrder }">
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
