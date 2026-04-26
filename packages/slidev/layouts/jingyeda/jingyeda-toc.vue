<!--
  jingyeda-standard 目录 layout。
  frontmatter 字段：
    items  : string[] —— 目录项文本数组
    active : number   —— 1-based 当前高亮项；未设置或 0 则全部高亮（总览页）
-->
<script setup lang="ts">
import { templateAsset } from '../../composables/useTemplateAsset'

withDefaults(
  defineProps<{
    items?: string[]
    active?: number
  }>(),
  { items: () => [], active: 0 },
)
</script>

<template>
  <div class="slidev-layout jingyeda-template jyd-toc-slide">
    <div class="jyd-toc-root">
      <LJydHeader>
        <h1 class="jyd-toc-title">目&ensp;录</h1>
        <span class="jyd-toc-en">CONTENTS</span>
      </LJydHeader>
      <div class="jyd-toc-body">
        <div
          v-for="(item, idx) in items"
          :key="idx"
          class="jyd-toc-item"
          :class="{
            'jyd-toc-item--active': active === 0 || active === idx + 1,
            'jyd-toc-item--inactive': active > 0 && active !== idx + 1,
          }"
        >
          <span class="jyd-toc-num">{{ String(idx + 1).padStart(2, '0') }}</span>
          <span class="jyd-toc-bar"></span>
          <span class="jyd-toc-label">{{ item }}</span>
        </div>
      </div>
      <img
        :src="templateAsset('/templates/jingyeda-standard/logo.png')"
        class="jyd-toc-watermark"
      />
    </div>
  </div>
</template>

<style scoped>
.jyd-toc-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
}
.jyd-toc-title {
  color: #ffffff;
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.18em;
  margin: 0;
  line-height: 1.3;
}
.jyd-toc-en {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.875em;
  letter-spacing: 0.25em;
  font-weight: 400;
}
.jyd-toc-body {
  padding: 3em 5em;
  display: flex;
  flex-direction: column;
  gap: 1.4em;
}
.jyd-toc-item {
  display: flex;
  align-items: center;
  gap: 1.2em;
  transition: opacity 0.2s;
}
.jyd-toc-item--inactive {
  opacity: 0.35;
}
.jyd-toc-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25em;
  height: 3.25em;
  border-radius: 50%;
  background: var(--jyd-brand-primary);
  color: #ffffff;
  font-size: 1.25em;
  font-weight: 700;
  flex-shrink: 0;
  font-family: var(--jyd-ff-ui);
}
.jyd-toc-item--active .jyd-toc-num {
  box-shadow: 0 0 0 0.25em var(--jyd-brand-accent);
}
.jyd-toc-bar {
  width: 0.4em;
  height: 2em;
  background: var(--jyd-brand-accent);
  flex-shrink: 0;
}
.jyd-toc-label {
  font-size: 1.375em;
  font-weight: 500;
  color: var(--jyd-fg-primary);
  letter-spacing: 0.12em;
}
.jyd-toc-item--active .jyd-toc-label {
  color: var(--jyd-brand-primary);
  font-weight: 600;
}
.jyd-toc-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
