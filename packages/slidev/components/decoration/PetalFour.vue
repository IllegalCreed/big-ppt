<script setup lang="ts">
/**
 * 公共装饰组件：花瓣 4 区。
 *
 * 4 个椭圆花瓣中央对称排列，每片中央放一个 slot；常用于"4 小节方阵"
 * 展示（设计 / 开发 / 测试 / 文档 等）。slot 内默认放编号 / 短标签。
 *
 * 配色：花瓣描边读 `--ld-color-brand-primary`，slot 文字读 brand-primary
 *      + `--ld-font-size-h1` + `--ld-font-weight-bold`。模板切换时几何形状
 *      不变、配色自动适配。
 *
 * 几何：viewBox 200×200，4 片椭圆围绕中心 (100, 100)；上/下椭圆水平向、
 *      左/右椭圆垂直向，相邻两片在中央汇合形成花瓣外观。
 */
defineProps<{
  /** 描边宽度档位；默认 'thick' */
  borderWidth?: 'thin' | 'thick'
}>()
</script>

<template>
  <div class="ld-petal-four" :data-border="borderWidth ?? 'thick'">
    <svg class="ld-petal-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
      <ellipse cx="100" cy="50" rx="50" ry="30" />
      <ellipse cx="100" cy="150" rx="50" ry="30" />
      <ellipse cx="50" cy="100" rx="30" ry="50" />
      <ellipse cx="150" cy="100" rx="30" ry="50" />
    </svg>
    <div class="ld-petal-slots">
      <div class="ld-petal-cell ld-petal-top">
        <slot name="slot1" />
      </div>
      <div class="ld-petal-cell ld-petal-right">
        <slot name="slot2" />
      </div>
      <div class="ld-petal-cell ld-petal-bottom">
        <slot name="slot3" />
      </div>
      <div class="ld-petal-cell ld-petal-left">
        <slot name="slot4" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ld-petal-four {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  max-width: 100%;
  max-height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  font-family: var(--ld-font-family-brand);
}

.ld-petal-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  fill: none;
  stroke: var(--ld-color-brand-primary);
}

.ld-petal-four[data-border='thin'] .ld-petal-svg {
  stroke-width: 2;
}

.ld-petal-four[data-border='thick'] .ld-petal-svg {
  stroke-width: 4;
}

.ld-petal-slots {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.ld-petal-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--ld-font-size-h1);
  font-weight: var(--ld-font-weight-bold);
  color: var(--ld-color-brand-primary);
  text-align: center;
}

.ld-petal-top {
  grid-column: 1 / span 2;
  grid-row: 1;
  align-items: center;
  padding-top: 12%;
}

.ld-petal-bottom {
  grid-column: 1 / span 2;
  grid-row: 2;
  align-items: center;
  padding-bottom: 12%;
}

.ld-petal-left {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 30%;
  height: 30%;
}

.ld-petal-right {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 30%;
  height: 30%;
}
</style>
