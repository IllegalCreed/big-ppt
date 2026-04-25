<!--
  beitou-standard 两栏 layout。
  frontmatter 字段：
    heading    : string —— 页标题（红色，40px）。用 heading 而非 title 避开 Slidev 全局 headmatter `title`
    leftTitle  : string —— 左栏小标题
    rightTitle : string —— 右栏小标题
  Markdown 中使用 Slidev 命名 slot 语法：
    ::left::
    <左栏内容>
    ::right::
    <右栏内容>
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  leftTitle?: string
  rightTitle?: string
}>()
</script>

<template>
  <div class="slidev-layout two-col-slide">
    <div class="content-root">
      <h1 v-if="heading" class="content-title">{{ heading }}</h1>
      <div class="two-col-body">
        <div class="col col-left">
          <h2 v-if="leftTitle" class="col-title">{{ leftTitle }}</h2>
          <div class="col-content"><slot name="left" /></div>
        </div>
        <div class="col-divider"></div>
        <div class="col col-right">
          <h2 v-if="rightTitle" class="col-title">{{ rightTitle }}</h2>
          <div class="col-content"><slot name="right" /></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-root {
  position: absolute;
  inset: 0;
  background: var(--bt-bg-page);
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: var(--bt-ff-brand);
}
.content-title {
  color: var(--bt-brand);
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.two-col-body {
  margin-top: 48px;
  display: flex;
  align-items: stretch;
  gap: 40px;
}
.col {
  flex: 1;
  min-width: 0;
}
.col-divider {
  width: 2px;
  background: var(--bt-brand);
  opacity: 0.5;
  align-self: stretch;
}
.col-title {
  color: var(--bt-brand);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 18px 0;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--bt-brand);
}
.col-content {
  color: var(--bt-fg-primary);
  font-size: 20px;
  line-height: 1.8;
}
.col-content :deep(p) {
  margin: 4px 0;
}
</style>
