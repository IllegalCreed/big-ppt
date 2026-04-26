<!--
  jingyeda-standard 通用内容 layout（纯文字页）。
  frontmatter 字段：
    heading : string —— 页标题（蓝底白字，由 LJydHeader 提供）
  slot default : markdown 正文
-->
<script setup lang="ts">
defineProps<{ heading?: string }>()
</script>

<template>
  <div class="slidev-layout jingyeda-template jyd-content-slide">
    <div class="jyd-content-root">
      <LJydHeader>
        <h1 v-if="heading" class="jyd-content-title">{{ heading }}</h1>
      </LJydHeader>
      <div class="jyd-content-body">
        <slot />
      </div>
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-content-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-content-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
}
.jyd-content-title {
  color: #ffffff; /* 显式白色，Slidev 默认 h1 color 会覆盖继承 */
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin: 0;
  line-height: 1.3;
}
.jyd-content-body {
  padding: 2em 3em 3em;
  color: var(--jyd-fg-primary);
  font-size: 1.25em;
  line-height: 1.9;
}
.jyd-content-body :deep(p) {
  margin: 0.3em 0;
}
.jyd-content-body :deep(strong) {
  color: var(--jyd-brand-primary);
  font-weight: bold;
}
.jyd-content-body :deep(ul),
.jyd-content-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.3em 0;
}
.jyd-content-body :deep(li) {
  margin: 0.2em 0;
}
.jyd-content-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
