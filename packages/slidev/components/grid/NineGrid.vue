<script setup lang="ts">
/**
 * 公共栅格组件：九宫格 3×3。
 *
 * 9 个等大 slot 排成 3 行 3 列；用于"9 项能力 / 9 分类标签"等密度高、
 * 文字短的展示。slot 内**仅放短文字 / 单 metric / 单图标**——slot 在 1080p
 * 视口下约 280×180px，塞 chart 会撑爆，AI prompt 决策树会明示这点。
 * 配色读 `--ld-*` token。
 */
</script>

<template>
  <div class="ld-nine-grid">
    <div v-for="i in 9" :key="i" class="ld-cell">
      <slot :name="`slot${i}`" />
    </div>
  </div>
</template>

<style scoped>
/* 9 cell 等宽等高，撑满 body。cell 实际比例由 body 宽高决定（16:9 slide 内
 * cell 必然横长 ~2:1）；之前试过 aspect-ratio: 1/1 让 NineGrid 1:1 居中显示
 * 但左右白边过大体验更差，故仍取撑满策略。gap 横竖 px 一致（1.5em），视觉差异
 * 是 cell 横长的客观结果，可通过减少 heading 占高、缩 padding 缓解。
 */
.ld-nine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 1.5em;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0; /* Phase 7.5E flex slot 撑满 */
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

/* cell 用 grid + place-items: stretch，让 MetricCard 等子组件自动撑满，
 * 保证每格大小一致；纯文字用 inline 自然左上对齐——demo 推荐每格放 MetricCard。
 */
.ld-cell {
  display: grid;
  place-items: stretch;
  min-width: 0;
  min-height: 0;
  text-align: center;
}
</style>
