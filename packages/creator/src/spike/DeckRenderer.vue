<!--
  Phase 10.5 spike Task D：DeckRenderer 主组件。

  接 markdown 字符串 + templateId → parseDeck → 每页用 <component :is> 动态
  装配对应 layout。layout 大量字段来自 frontmatter，v-bind="frontmatter" 一键透传。

  Spike 范围：
  - 只支持当前两套模板的 12 个 layout
  - body markdown 当 v-html 字符串塞进 <slot />（无 markdown→HTML 编译，
    无 Vue 标签运行时编译）—— content 类 layout 的复杂 body 渲染留给 plan 25
  - 每页用 960×540（Slidev 默认 16:9）一个独立 frame，垂直排列，便于跟
    Slidev iframe 并排对照
-->
<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { parseDeck } from './parse-deck'

const props = defineProps<{
  markdown: string
  templateId: 'beitou-standard' | 'jingyeda-standard'
}>()

const slides = computed(() => parseDeck(props.markdown))

// 静态映射：每个 layout 名 → 异步组件。defineAsyncComponent 保证 lazy load，
// 12 个 layout 共 ~30KB，spike 阶段不在意 chunk 大小。
const layoutMap: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  'beitou-cover': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-cover.vue'),
  ),
  'beitou-content': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-content.vue'),
  ),
  'beitou-toc': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-toc.vue'),
  ),
  'beitou-section-title': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-section-title.vue'),
  ),
  'beitou-back-cover': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-back-cover.vue'),
  ),
  'beitou-image-content': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/beitou/beitou-image-content.vue'),
  ),
  'jingyeda-cover': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-cover.vue'),
  ),
  'jingyeda-content': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-content.vue'),
  ),
  'jingyeda-toc': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-toc.vue'),
  ),
  'jingyeda-section-title': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-section-title.vue'),
  ),
  'jingyeda-back-cover': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-back-cover.vue'),
  ),
  'jingyeda-image-content': defineAsyncComponent(
    () => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-image-content.vue'),
  ),
}

function bodyAsHtml(body: string): string {
  // Spike 不做 markdown→HTML，原文 v-html 出去：纯文字 / `<TwoCol>` 等 Vue 标签
  // 会以 unknown DOM element 形式出现，视觉是「内容文字基本可见，但布局不对」。
  // 完整 markdown body 编译由 plan 25 接入。
  return body
}
</script>

<template>
  <div class="deck-renderer">
    <div
      v-for="(slide, idx) in slides"
      :key="idx"
      class="slide-frame"
      :class="templateId === 'beitou-standard' ? 'beitou-template' : 'jingyeda-template'"
    >
      <div class="slide-label">#{{ idx + 1 }} layout={{ slide.layout }}</div>
      <div class="slide-canvas">
        <component
          :is="layoutMap[slide.layout] ?? 'div'"
          v-bind="slide.frontmatter"
        >
          <div v-if="slide.body" v-html="bodyAsHtml(slide.body)" />
        </component>
        <div v-if="!layoutMap[slide.layout]" class="slide-unknown">
          未注册 layout：{{ slide.layout }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deck-renderer {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.slide-frame {
  width: 960px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.slide-label {
  font-family: monospace;
  font-size: 12px;
  color: #888;
}
.slide-canvas {
  position: relative;
  width: 960px;
  height: 540px;
  overflow: hidden;
  border: 1px solid #d9d9d9;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  background: #fff;
}
.slide-unknown {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d4380d;
  background: #fff7f0;
}
/* 让 layout 内部 .slidev-layout 撑满 slide-canvas（Slidev 自己跑时是 transform
   scale 适配 viewport，spike 简化为固定 960×540 自然铺满，layout 内部用 px 设计） */
.slide-canvas :deep(.slidev-layout) {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
</style>
