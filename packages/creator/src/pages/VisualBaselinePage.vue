<!--
  Phase 10.5 Task 25-E-1：visual regression baseline 渲染入口。

  URL: /_visual/:template/:layout — 给 Playwright `toHaveScreenshot` 用，给每个
  layout 喂一份最小 frontmatter，固定大小 960×540 渲染单页，再截图对比基线。

  仅在 dev 模式挂载（router/index.ts 内 `import.meta.env.DEV` 控制），prod
  build 此路由不存在，避免线上误访问。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DeckRenderer from '../deck-renderer/DeckRenderer.vue'

const route = useRoute()
const template = computed(() => String(route.params.template))
const layout = computed(() => String(route.params.layout))
const thumbnailMode = computed(() => route.query.thumbnail === '1')

/**
 * 每种 layout 的最小 frontmatter（layout name + 必填字段）。
 * 故意不放 body，避免 markdown 编译变数；纯 frontmatter 跑就够 visual diff 用。
 */
const fixtures: Record<string, (tpl: string) => string> = {
  cover: (tpl) =>
    `layout: ${tpl}-cover\nmainTitle: 测试标题\nsubtitle: 测试副标题\nreporter: A 部门\ndate: 2026/05/12`,
  toc: (tpl) => `layout: ${tpl}-toc\nitems: ["背景介绍", "数据概览", "对比分析"]`,
  'section-title': (tpl) => `layout: ${tpl}-section-title\nchapterNumber: 1\nchapterTitle: 数据`,
  content: (tpl) => `layout: ${tpl}-content\nheading: 内容页标题`,
  'image-content': (tpl) =>
    `layout: ${tpl}-image-content\nheading: 图文页\nimageSrc: /templates/${tpl}-standard/assets/cover.png`,
  'back-cover': (tpl) => `layout: ${tpl}-back-cover\nmessage: 谢谢观看`,
}

const tplPrefix = computed(() => template.value.replace('-standard', ''))

const markdown = computed(() => {
  const builder = fixtures[layout.value]
  if (!builder) return ''
  const fm = builder(tplPrefix.value)
  return `---\n${fm}\n---`
})
</script>

<template>
  <div class="visual-baseline-root" :class="{ 'thumbnail-mode': thumbnailMode }">
    <DeckRenderer :markdown="markdown" :template-id="template" :allow-upscale="thumbnailMode" />
  </div>
</template>

<style scoped>
/* 固定 wrapper 宽高，让 Playwright 截图截到稳定区域。 */
.visual-baseline-root {
  width: 960px;
  padding: 0;
  background: #fff;
}
.visual-baseline-root.thumbnail-mode {
  width: 1280px;
  height: 720px;
}
.visual-baseline-root.thumbnail-mode :deep(.deck-renderer) {
  padding: 0;
}
</style>
