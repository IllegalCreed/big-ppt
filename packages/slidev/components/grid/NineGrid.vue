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
/* 9 cell 等宽等高 + gap 视觉对称的关键：让 NineGrid 自身保持 1:1 aspect-ratio。
 * 这样 cell 自然是正方形，水平 / 垂直 gap 旁的"留白比例"才视觉一致。
 * 如果 body 是 16:9 矩形，NineGrid 按短边 fit、自动水平居中（margin: 0 auto）。
 */
.ld-nine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 1.5em;
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  margin: 0 auto;
  flex: 0 1 auto; /* 不强制撑满主轴；让 height: 100% + aspect-ratio 决定大小 */
  min-height: 0;
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
