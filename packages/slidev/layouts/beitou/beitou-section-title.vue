<!--
  beitou-standard 章节标题页 layout（Phase 7.5D NEW）。
  红底白字 + 左侧巨型数字 + 右侧章节名，用于章节切换 / 主题分隔。

  frontmatter：
    chapterNumber : number   章节序号（如 1 / 2 / 3）
    chapterTitle  : string   章节标题
-->
<script setup lang="ts">
defineProps<{
  chapterNumber?: number
  chapterTitle?: string
}>()
</script>

<template>
  <div class="slidev-layout beitou-section-title-slide">
    <div class="bt-section-root">
      <div class="bt-section-number" v-if="chapterNumber !== undefined">
        {{ String(chapterNumber).padStart(2, '0') }}
      </div>
      <div class="bt-section-divider" />
      <h1 class="bt-section-title" v-if="chapterTitle">{{ chapterTitle }}</h1>
    </div>
  </div>
</template>

<style scoped>
.bt-section-root {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 60px;
  background: var(--bt-brand-gradient);
  padding: 60px 80px;
  font-family: var(--bt-ff-brand);
  color: #ffffff;
  overflow: hidden;
}
.bt-section-number {
  font-size: 160px;
  font-weight: 900;
  letter-spacing: 4px;
  line-height: 1;
  flex: 0 0 auto;
}
.bt-section-divider {
  width: 4px;
  height: 200px;
  background: rgba(255, 255, 255, 0.6);
}
.bt-section-title {
  flex: 1;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 6px;
  line-height: 1.3;
  margin: 0;
}
</style>
