<!--
  Phase 10.5 落地：DeckRenderer 主组件。

  接 markdown + templateId + currentPage prop → parseDeck → 每页用 `<component :is>`
  动态渲染对应 layout（unplugin-vue-components 已自动 import 两套模板的 layouts）；
  body markdown 走 compileBody runtime compile，让 `<TwoCol>` 等 Vue 标签能解析。

  使用方式：
    <DeckRenderer
      :markdown="content"
      template-id="beitou-standard"
      :current-page="3"  // 不传则渲染全部页
    />
-->
<script setup lang="ts">
import { computed } from 'vue'
import { parseDeck } from './parse-deck'
import { compileBody } from './compile-body'

const props = withDefaults(
  defineProps<{
    markdown: string
    templateId: string
    /** 1-indexed；undefined = 多页平铺（编辑视图列表 / 印刷预览用） */
    currentPage?: number
  }>(),
  { currentPage: undefined },
)

const parsed = computed(() => parseDeck(props.markdown))

const visibleSlides = computed(() => {
  if (props.currentPage === undefined) return parsed.value.slides
  const idx = props.currentPage - 1
  const slide = parsed.value.slides[idx]
  return slide ? [slide] : []
})
</script>

<template>
  <div class="deck-renderer" :class="`template-${templateId}`">
    <div
      v-for="(slide, idx) in visibleSlides"
      :key="idx"
      class="slide-canvas"
      :class="templateId === 'beitou-standard' ? 'beitou-template' : 'jingyeda-template'"
    >
      <component :is="slide.layout" v-bind="slide.frontmatter">
        <component v-if="slide.body" :is="compileBody(slide.body)" />
      </component>
    </div>
  </div>
</template>

<style scoped>
.deck-renderer {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.slide-canvas {
  position: relative;
  width: 960px;
  height: 540px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.slide-canvas :deep(.slidev-layout) {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
</style>
