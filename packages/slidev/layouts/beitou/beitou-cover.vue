<!--
  beitou-standard 封面 layout。
  frontmatter 字段（全部可选，缺失时对应元素隐藏）：
    mainTitle : 主标题（白字，52px）—— 用 mainTitle 而非 title，避开与 Slidev 全局 `title`（浏览器 tab）的 key 冲突
    subtitle  : 副标题（白字，46px）
    reporter  : 汇报人（底部信息区）
    date      : 日期（底部信息区）
-->
<script setup lang="ts">
defineProps<{
  mainTitle?: string
  subtitle?: string
  reporter?: string
  date?: string
}>()
</script>

<template>
  <div class="slidev-layout cover-slide">
    <div class="cover-root">
      <LBeitouCoverLogo class="cover-logo" />
      <LBeitouTitleBlock>
        <h1 v-if="mainTitle">{{ mainTitle }}</h1>
        <h2 v-if="subtitle">{{ subtitle }}</h2>
      </LBeitouTitleBlock>
      <div v-if="reporter || date" class="cover-info">
        <p v-if="reporter" class="cover-info-line">汇报人：{{ reporter }}</p>
        <p v-if="date" class="cover-info-line">时&emsp;间：{{ date }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cover-root {
  position: absolute;
  inset: 0;
  background: var(--bt-bg-page);
  overflow: hidden;
  padding: 36px 48px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  font-family: var(--bt-ff-brand);
}
.cover-logo {
  justify-content: flex-end;
  margin-bottom: 20px;
}
.cover-root :deep(h1) {
  color: #ffffff;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.6;
}
.cover-root :deep(h2) {
  color: #ffffff;
  font-size: 46px;
  font-weight: 600;
  letter-spacing: 3px;
  margin: 0;
  line-height: 1.6;
}
.cover-info {
  margin-top: 20px;
  margin-left: 40px;
  color: var(--bt-fg-primary);
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 1px;
}
.cover-info-line {
  margin: 2px 0;
  line-height: 1.5;
}
</style>
