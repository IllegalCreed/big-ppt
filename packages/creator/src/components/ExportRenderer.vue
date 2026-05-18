<!--
  Phase 14 Task A：ExportRenderer 简化版 DeckRenderer wrapper。

  仅为离线截图存在：position: fixed; left: -10000px 移出视区，但 DOM 仍正常
  reflow / 字体度量 / ResizeObserver 可触发（不能用 display: none —— html2canvas
  截 0×0 元素）。

  容器固定 1920×1080（2× DESIGN_WIDTH / DESIGN_HEIGHT），让 :deep 的 .slide-frame
  也撑到 1920×1080。配 html2canvas scale: 2 出 3840×2160 PNG，打印质量。

  Props 跟 DeckRenderer 1:1 透传（除 currentPage 强制 required → pageIndex）。
  暴露 `rootRef` 给 capturePages 拿根 DOM 元素调 html2canvas。
-->
<script setup lang="ts">
import { ref } from 'vue'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'

defineProps<{
  deckId: number
  /** 1-indexed 当前页码（透传给 DeckRenderer currentPage） */
  pageIndex: number
  markdown: string
  templateId: string
}>()

/** capturePages 通过 defineExpose 拿到这个根元素直接喂 html2canvas */
const rootRef = ref<HTMLElement | null>(null)

defineExpose({ rootRef })
</script>

<template>
  <div ref="rootRef" class="export-renderer" :data-deck-id="deckId">
    <DeckRenderer :markdown="markdown" :template-id="templateId" :current-page="pageIndex" />
  </div>
</template>

<style scoped>
.export-renderer {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 1920px;
  height: 1080px;
  background: #fff;
  z-index: -9999;
  pointer-events: none;
}
/* 让 DeckRenderer 内的 slide-frame 撑到 1920×1080（覆盖默认 max-width: 960 + 16:9 等比） */
.export-renderer :deep(.slide-frame) {
  max-width: none;
  width: 1920px;
  height: 1080px;
  box-shadow: none;
  aspect-ratio: 16 / 9;
}
/*
 * Slidev 标准做法 + Phase 14 修正:.slide-canvas **保持 960×540 固定设计尺寸**
 * (layouts / 字号 / chart 全按这个绝对尺寸画,任何内部 box 拉伸都会破坏比例),
 * 通过 `transform: scale(2)` **等比缩放**到 1920×1080。transform-origin: top left
 * 让缩放从左上角展开,正好填满 ExportRenderer 容器。
 *
 * !important 覆盖 DeckRenderer 内置的 `transform: scale(var(--slide-scale,1))` —
 * DeckRenderer 内部 ResizeObserver 算 frameWidth = min(available, 960) / 960,
 * 永远 ≤ 1.0,即便容器 1920px 也只 scale=1,canvas 仅占左上 1/4。
 *
 * (前一版用 `width:1920;height:1080;transform:scale(1)` 强行拉 box,破坏所有内部
 *  比例,导出 PNG 字号 / 元素位置全错。已修正为 transform-only 等比缩放。)
 */
.export-renderer :deep(.slide-canvas) {
  transform: scale(2) !important;
  transform-origin: top left !important;
}
</style>
