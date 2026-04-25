<!--
  company-standard 封底 layout。
  frontmatter 字段：
    message : string —— 结束语（白字于红色渐变块内，52px）
    date    : string —— 底部日期（可选）
-->
<script setup lang="ts">
defineProps<{
  message?: string
  date?: string
}>()
</script>

<template>
  <div class="slidev-layout back-cover-slide">
    <div class="back-cover-root">
      <LTitleBlock padding="40px 0" class="ending-block">
        <h1 v-if="message">{{ message }}</h1>
      </LTitleBlock>
      <div class="footer-area">
        <LCoverLogo :mark-size="24" :text-size="24" />
        <p v-if="date" class="footer-date">{{ date }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.back-cover-root {
  position: absolute;
  inset: 0;
  background: var(--bt-bg-page);
  overflow: hidden;
  padding: 36px 48px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding-top: 120px;
  font-family: var(--bt-ff-brand);
}
.ending-block {
  width: 100%;
}
.back-cover-root :deep(h1) {
  color: #ffffff;
  font-size: 52px;
  font-weight: 700;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.6;
}
.footer-area {
  margin-top: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.footer-date {
  color: var(--bt-fg-primary);
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 2px;
  margin: 0;
}
</style>
