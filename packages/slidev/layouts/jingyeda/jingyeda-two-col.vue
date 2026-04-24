<!--
  jingyeda-standard 两栏 layout。
  frontmatter 字段：
    heading    : 页标题
    leftTitle  : 左栏小标题（蓝底白字）
    rightTitle : 右栏小标题（绿底白字）
  Slidev 命名 slot：::left:: / ::right::
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  leftTitle?: string
  rightTitle?: string
}>()
</script>

<template>
  <div class="slidev-layout jyd-two-col-slide">
    <div class="jyd-tc-root">
      <LJydHeader>
        <h1 v-if="heading" class="jyd-tc-title">{{ heading }}</h1>
      </LJydHeader>
      <div class="jyd-tc-body">
        <div class="jyd-tc-col">
          <h2 v-if="leftTitle" class="jyd-tc-col-title jyd-tc-col-title--blue">{{ leftTitle }}</h2>
          <div class="jyd-tc-col-content"><slot name="left" /></div>
        </div>
        <div class="jyd-tc-divider"></div>
        <div class="jyd-tc-col">
          <h2 v-if="rightTitle" class="jyd-tc-col-title jyd-tc-col-title--green">{{ rightTitle }}</h2>
          <div class="jyd-tc-col-content"><slot name="right" /></div>
        </div>
      </div>
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-tc-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-tc-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
}
.jyd-tc-title {
  color: #ffffff;
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin: 0;
  line-height: 1.3;
}
.jyd-tc-body {
  margin-top: 2em;
  padding: 0 3em 3em;
  display: flex;
  align-items: stretch;
  gap: 1.8em;
}
.jyd-tc-col {
  flex: 1;
  min-width: 0;
}
.jyd-tc-divider {
  width: 0.15em;
  background: var(--jyd-brand-accent);
  align-self: stretch;
}
.jyd-tc-col-title {
  color: #ffffff;
  font-size: 1.25em;
  font-weight: 600;
  letter-spacing: 0.12em;
  margin: 0 0 1em 0;
  padding: 0.5em 1em;
}
.jyd-tc-col-title--blue {
  background: var(--jyd-brand-primary);
}
.jyd-tc-col-title--green {
  background: var(--jyd-brand-accent);
}
.jyd-tc-col-content {
  color: var(--jyd-fg-primary);
  font-size: 1.25em;
  line-height: 1.8;
}
.jyd-tc-col-content :deep(p) {
  margin: 0.2em 0;
}
.jyd-tc-col-content :deep(ul),
.jyd-tc-col-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.2em 0;
}
.jyd-tc-col-content :deep(li) {
  margin: 0.2em 0;
}
.jyd-tc-col-content :deep(strong) {
  color: var(--jyd-brand-primary);
}
.jyd-tc-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
