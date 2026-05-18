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
 * Critical fix（code review）：DeckRenderer 内部 `frameWidth = Math.min(available, 960)`
 * 永远 ≤ 960 → scale = frameWidth/960 ≤ 1.0；即便我们把 slide-frame 撑到 1920，
 * .slide-canvas 仍是 960×540 + transform: scale(1) + transform-origin: top left，
 * 导致 html2canvas 截到的 1920×1080 区域里内容只占左上 1/4，其余 3/4 是白底。
 * 强制 1920×1080 + scale(1)，绕过 DeckRenderer 自带的等比缩放算法。
 */
.export-renderer :deep(.slide-canvas) {
  width: 1920px;
  height: 1080px;
  transform: scale(1);
}
</style>
