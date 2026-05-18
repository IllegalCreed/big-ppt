<!--
  Phase 14 Task A:ExportRenderer 简化版 DeckRenderer wrapper(2026-05-18 重构)。

  仅为离线截图存在:position: fixed; left: -10000px 移出视区,但 DOM 仍正常
  reflow / 字体度量 / ResizeObserver 可触发(不能用 display: none — html2canvas
  截 0×0 元素)。

  **设计原则:容器 = DESIGN_WIDTH × DESIGN_HEIGHT(960×540),零 override**:
  - DeckRenderer 内部 ResizeObserver 看到容器 960 → 算 scale = 960/960 = 1.0
  - slide-frame width:100% max-width:960 aspect 16/9 → 960×540 正好撑满
  - slide-canvas 960×540 + transform: scale(1) → 渲染设计稿原始尺寸
  - html2canvas `scale: 2` 自动出 1920×1080 PNG(打印质量),完全等比放大,
    内容比例 = 设计稿,跟 Slidev 标准 100% 对齐

  唯一 :deep override:strip .deck-renderer 容器的 flex / padding / gap,
  防止 padding-top:16 让 slide-frame 偏移出 540 高 viewport(html2canvas 会
  丢掉超出区域,造成内容截断)。

  Props 跟 DeckRenderer 1:1 透传(除 currentPage 强制 required → pageIndex)。
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
  /* 设计尺寸 — DeckRenderer 内部 ResizeObserver 看到 960 → scale = 1.0 → slide-canvas
     按原始 960×540 像素渲染。html2canvas `scale: 2` 选项自动出 1920×1080 PNG。 */
  width: 960px;
  height: 540px;
  background: #fff;
  z-index: -9999;
  pointer-events: none;
}
/*
 * 唯一 override:strip .deck-renderer 容器的 flex / padding / gap。
 * DeckRenderer 默认 flex column center + padding:16px 0 让 slide-frame 在 vertical
 * 居中 + 顶部偏移 16px,导致 frame 下 16px 溢出 540 高 viewport 被 html2canvas 截掉。
 * 改 display:block padding:0 让 frame 从 (0,0) 起精确铺满 960×540 容器。
 */
.export-renderer :deep(.deck-renderer) {
  display: block;
  padding: 0;
  gap: 0;
  min-height: 0;
}
/* slide-frame box-shadow 在截图边缘留灰边,清掉(导出场景不需要) */
.export-renderer :deep(.slide-frame) {
  box-shadow: none;
}
</style>
