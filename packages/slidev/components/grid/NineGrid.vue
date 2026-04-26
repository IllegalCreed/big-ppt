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
.ld-nine-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 1em;
  width: 100%;
  height: 100%;
  font-family: var(--ld-font-family-brand);
  color: var(--ld-color-fg-primary);
  font-size: var(--ld-font-size-body);
}

.ld-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  text-align: center;
}
</style>
