<!--
  beitou-standard 章节标题页 layout（Phase 7.5D NEW，7.5E 调整为白底）。
  白底 + 巨型红色数字 + 黑色章节名 + 右下红色装饰条；克制不抢戏。

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
  <div class="slidev-layout beitou-template beitou-section-title-slide">
    <div class="bt-section-root">
      <div class="bt-section-eyebrow" v-if="chapterNumber !== undefined">
        CHAPTER {{ String(chapterNumber).padStart(2, '0') }}
      </div>
      <div class="bt-section-number" v-if="chapterNumber !== undefined">
        {{ String(chapterNumber).padStart(2, '0') }}
      </div>
      <h1 class="bt-section-title" v-if="chapterTitle">{{ chapterTitle }}</h1>
      <div class="bt-section-accent" />
    </div>
  </div>
</template>

<style scoped>
.bt-section-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 24px;
  background: var(--bt-bg-page);
  padding: 80px 120px;
  font-family: var(--bt-ff-brand);
  overflow: hidden;
}
.bt-section-eyebrow {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 8px;
  color: var(--bt-fg-muted);
}
.bt-section-number {
  font-size: 220px;
  font-weight: 900;
  letter-spacing: 4px;
  line-height: 0.9;
  color: var(--bt-brand);
}
.bt-section-title {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: 6px;
  line-height: 1.2;
  margin: 0;
  color: var(--bt-fg-primary);
}
.bt-section-accent {
  position: absolute;
  right: 0;
  bottom: 80px;
  width: 240px;
  height: 6px;
  background: var(--bt-brand);
}
</style>
