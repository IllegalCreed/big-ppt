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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseDeck } from './parse-deck'
import { compileBody } from './compile-body'

/**
 * Slidev 内部约定的「设计尺寸」—— layouts 内部所有 px 数字（字号、padding、间距）
 * 都按这个固定基准画。DeckRenderer 通过 transform: scale 适配实际容器宽度，layouts
 * 内部代码无需改。
 *
 * 跟 Slidev 默认 aspectRatio: 16/9 + canvasWidth: 980 略不同（980 → 960）—— 北投 / 竞业达
 * 两套模板内部都按 960×540 设计；保持一致避免改动 layouts CSS。
 */
const DESIGN_WIDTH = 960
const DESIGN_HEIGHT = 540

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

// 容器宽度 → scale 比例。ResizeObserver 监听 wrapper，新值写到 CSS 变量
// --slide-scale，单页/多页 .slide-canvas 通过 transform: scale(var(--slide-scale))
// 等比缩放。transform-origin: top center 让缩放后顶部对齐 + 水平居中。
const rendererRef = ref<HTMLElement | null>(null)
const scale = ref(1)

function recompute(): void {
  const el = rendererRef.value
  if (!el) return
  const available = el.clientWidth
  if (available <= 0) return
  // slide-frame 已经被 max-width: DESIGN_WIDTH 锁住，实际渲染宽度是
  // min(available, DESIGN_WIDTH)；scale 跟着这个真实宽度，永远 ≤ 1（不放大字）
  const frameWidth = Math.min(available, DESIGN_WIDTH)
  scale.value = frameWidth / DESIGN_WIDTH
}

let ro: ResizeObserver | null = null
onMounted(() => {
  recompute()
  // jsdom（vitest 环境）不实现 ResizeObserver — guard 避免 mount 时报错
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(recompute)
    if (rendererRef.value) ro.observe(rendererRef.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div
    ref="rendererRef"
    class="deck-renderer"
    :class="`template-${templateId}`"
    :style="{
      '--slide-scale': scale,
      '--design-width': `${DESIGN_WIDTH}px`,
      '--design-height': `${DESIGN_HEIGHT}px`,
    }"
  >
    <div
      v-for="(slide, idx) in visibleSlides"
      :key="idx"
      class="slide-frame"
      :class="templateId === 'beitou-standard' ? 'beitou-template' : 'jingyeda-template'"
    >
      <div class="slide-canvas">
        <component :is="slide.layout" v-bind="slide.frontmatter">
          <component v-if="slide.body" :is="compileBody(slide.body)" />
        </component>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deck-renderer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  width: 100%;
  min-height: 100%;
  padding: 16px 0;
  box-sizing: border-box;
}
/**
 * slide-frame：实际占位的盒子，宽度跟随容器（封顶 design-width），高度按 16:9 自动。
 * slide-canvas：固定 960×540 设计尺寸的"画布"，绝对定位铺满 slide-frame，
 *   transform: scale 等比缩放到实际 frame 宽度。
 *
 * transform-origin: top left + 容器 100% width 保证缩放后正好填满 frame
 * （配合 frame 宽度等于 design-width × scale）。
 */
.slide-frame {
  position: relative;
  width: 100%;
  max-width: var(--design-width);
  /* 16:9 比例：height = width * 9/16 */
  aspect-ratio: 16 / 9;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  background: #fff;
  overflow: hidden;
}
.slide-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--design-width);
  height: var(--design-height);
  transform: scale(var(--slide-scale, 1));
  transform-origin: top left;
}
.slide-canvas :deep(.slidev-layout) {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
</style>
