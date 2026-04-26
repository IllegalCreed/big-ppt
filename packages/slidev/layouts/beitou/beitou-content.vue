<!--
  beitou-standard 通用内容 layout（纯文字页）。
  frontmatter 字段：
    heading : string —— 页标题（红色，40px）。用 heading 而非 title 避开 Slidev 全局 headmatter `title`
  slot default : markdown 正文
-->
<script setup lang="ts">
defineProps<{ heading?: string }>()
</script>

<template>
  <div class="slidev-layout beitou-template content-slide">
    <div class="content-root">
      <h1 v-if="heading" class="content-title">{{ heading }}</h1>
      <div class="content-body">
        <slot />
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
  /* Phase 7.5E：flex column 让 .content-body 撑满剩余高度，
     这样 slot 内的栅格组件 height: 100% 能找到参照 */
  display: flex;
  flex-direction: column;
}
.content-title {
  color: var(--bt-brand);
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
  flex-shrink: 0;
}
.content-body {
  margin-top: 48px;
  color: var(--bt-fg-primary);
  font-size: 22px;
  line-height: 1.8;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.content-body :deep(p) {
  margin: 4px 0;
}
.content-body :deep(strong) {
  color: var(--bt-brand);
}
</style>
