<script setup lang="ts">
/**
 * 公共栅格组件：九宫格 3×3。
 *
 * 默认模式: 9 个等大 slot 排成 3 行 3 列;用于"9 项能力 / 9 分类标签"等密度高、
 * 文字短的展示。slot 内**仅放短文字 / 单 metric / 单图标**——slot 在 1080p
 * 视口下约 280×180px,塞 chart 会撑爆。
 *
 * Phase 11.7 加中央装饰 mode:`:show-center-decoration="true"` 时,中央 cell
 * 渲染 #decoration slot(放 icon / logo / 主题图等装饰),slot1..slot8 占据
 * 外圈 8 格(从左上顺时针 / 行优先顺序)。适合"8 个要点围绕主题图"的视觉。
 *
 * 配色读 `--ld-*` token。
 */
import { computed } from 'vue'

const props = defineProps<{
  /** Phase 11.7: 启用 8+1 中央装饰模式;true 时 slot1..slot8 占外圈,中央渲染 #decoration */
  showCenterDecoration?: boolean
}>()

interface CellSpec {
  slot: string
  isDecoration: boolean
}

const cells = computed<CellSpec[]>(() =>
  Array.from({ length: 9 }, (_, idx) => {
    const cellIndex = idx + 1 // 1-based
    if (!props.showCenterDecoration) {
      return { slot: `slot${cellIndex}`, isDecoration: false }
    }
    if (cellIndex === 5) return { slot: 'decoration', isDecoration: true }
    // 中心之外的 8 格按 grid 顺序映射到 slot1..slot8
    const slotIndex = cellIndex < 5 ? cellIndex : cellIndex - 1
    return { slot: `slot${slotIndex}`, isDecoration: false }
  }),
)
</script>

<template>
  <div class="ld-nine-grid" :data-show-center-decoration="showCenterDecoration ? 'true' : 'false'">
    <div
      v-for="cell in cells"
      :key="cell.slot"
      class="ld-cell"
      :class="{ 'ld-cell--decoration': cell.isDecoration }"
    >
      <slot :name="cell.slot" />
    </div>
  </div>
</template>

<style scoped>
/* 9 cell 等宽等高,撑满 body。cell 实际比例由 body 宽高决定（16:9 slide 内
 * cell 必然横长 ~2:1）;之前试过 aspect-ratio: 1/1 让 NineGrid 1:1 居中显示
 * 但左右白边过大体验更差,故仍取撑满策略。
 */
.ld-nine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-cell {
  display: grid;
  place-items: stretch;
  min-width: 0;
  min-height: 0;
  text-align: center;
}

/* 中央装饰 cell:整体居中显示装饰内容(icon / logo) */
.ld-cell--decoration {
  place-items: center;
}
</style>
