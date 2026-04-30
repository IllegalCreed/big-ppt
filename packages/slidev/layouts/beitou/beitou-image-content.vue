<!--
  Phase 11.5：beitou-standard 图片内容页 layout。
  body 是一张 16:9 的图片(由 generate_slide_image 工具填 imageSrc)。
  当前不暴露 layout slot - body 文本无视。

  frontmatter 字段:
    heading?  : string —— 页标题(红色,40px,与 beitou-content 一致)
    imageSrc  : string —— /api/assets/<uuid>(agent 绝对路径,不要经 templateAsset())
    caption?  : string —— 图下小字标注(可选)
    imageFit? : 'cover' | 'contain' —— 默认 cover(AI hero 图);diagram/screenshot 用 contain
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  imageSrc: string
  caption?: string
  imageFit?: 'cover' | 'contain'
}>()
</script>

<template>
  <div class="slidev-layout beitou-template image-content-slide">
    <div class="image-content-root">
      <LBtHeader>
        <h1 v-if="heading" class="image-content-title">{{ heading }}</h1>
      </LBtHeader>
      <div class="image-content-body">
        <!--
          关键:imageSrc 是 agent 绝对路径(/api/assets/<uuid>),
          不要包 templateAsset() —— 那会加 --base 前缀变成
          /api/slidev-preview/api/assets/...,直接 404。
        -->
        <img
          :src="imageSrc"
          :alt="caption || heading || ''"
          class="image-content-img"
          :class="`image-content-img--${imageFit || 'cover'}`"
          decoding="async"
          loading="eager"
        />
        <p v-if="caption" class="image-content-caption">{{ caption }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-content-root {
  position: absolute;
  inset: 0;
  background: var(--bt-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--bt-ff-brand);
  display: flex;
  flex-direction: column;
}
.image-content-title {
  color: #ffffff;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
  flex-shrink: 0;
}
.image-content-body {
  padding: 32px 60px 48px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.image-content-img {
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.18),
    0 2px 6px rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.04);
}
.image-content-img--cover {
  object-fit: cover;
}
.image-content-img--contain {
  object-fit: contain;
}
.image-content-caption {
  margin: 0;
  color: var(--bt-fg-secondary);
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
