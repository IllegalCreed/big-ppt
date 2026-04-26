<!--
  jingyeda-standard 章节标题页 layout（Phase 7.5D NEW，7.5E 调整为白底）。
  白底 + 蓝色"第 N 章"标识 + 黑色大字章节名 + 蓝绿渐变装饰条；克制不抢戏。

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
  <div class="slidev-layout jingyeda-template jingyeda-section-title-slide">
    <div class="jyd-section-root">
      <div class="jyd-section-marker" v-if="chapterNumber !== undefined">
        第 {{ String(chapterNumber).padStart(2, '0') }} 章
      </div>
      <h1 class="jyd-section-title" v-if="chapterTitle">{{ chapterTitle }}</h1>
      <div class="jyd-section-accent">
        <div class="jyd-section-accent-blue" />
        <div class="jyd-section-accent-green" />
      </div>
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-section-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-section-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 24px;
  background: var(--jyd-bg-page);
  padding: 80px 120px;
  font-family: var(--jyd-ff-brand);
  overflow: hidden;
}
.jyd-section-marker {
  font-family: var(--jyd-ff-ui);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.4em;
  color: var(--jyd-brand-primary);
}
.jyd-section-title {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1.2;
  margin: 0;
  color: var(--jyd-fg-primary);
}
.jyd-section-accent {
  display: flex;
  margin-top: 8px;
  width: 320px;
  height: 6px;
}
.jyd-section-accent-blue {
  flex: 0.7;
  background: var(--jyd-brand-primary);
}
.jyd-section-accent-green {
  flex: 0.3;
  background: var(--jyd-brand-accent);
}
.jyd-section-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 1.5em;
  height: 1.6em;
  opacity: 0.85;
}
</style>
