<!--
  jingyeda-standard 章节标题页 layout（Phase 7.5D NEW）。
  全屏蓝底 banner + 居中"第 N 章"+ 大字章节标题 + 底部绿色装饰条。

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
  <div class="slidev-layout jingyeda-section-title-slide">
    <div class="jyd-section-root">
      <div class="jyd-section-banner">
        <div class="jyd-section-marker" v-if="chapterNumber !== undefined">
          第 {{ String(chapterNumber).padStart(2, '0') }} 章
        </div>
        <h1 class="jyd-section-title" v-if="chapterTitle">{{ chapterTitle }}</h1>
      </div>
      <div class="jyd-section-accent" />
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-section-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-section-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-brand-primary);
  font-family: var(--jyd-ff-brand);
  color: #ffffff;
  overflow: hidden;
}
.jyd-section-banner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.2em;
  padding: 0 4em;
  text-align: center;
}
.jyd-section-marker {
  font-family: var(--jyd-ff-ui);
  font-size: 1.6em;
  font-weight: 400;
  letter-spacing: 0.4em;
  opacity: 0.85;
}
.jyd-section-title {
  font-size: 3.2em;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1.25;
  margin: 0;
}
.jyd-section-accent {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 0.6em;
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
