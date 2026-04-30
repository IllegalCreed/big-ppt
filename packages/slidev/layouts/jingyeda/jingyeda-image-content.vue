<!--
  Phase 11.5：jingyeda-standard 图片内容页 layout。
  body 是一张 16:9 的图片(由 generate_slide_image 工具填 imageSrc)。
  当前不暴露 layout slot - body 文本无视。

  frontmatter 字段:
    heading?  : string —— 页标题(蓝底白字,经 LJydHeader)
    imageSrc  : string —— /api/assets/<uuid>(agent 绝对路径,不要经 templateAsset())
    caption?  : string —— 图下小字标注(可选)
    imageFit? : 'cover' | 'contain' —— 默认 cover
-->
<script setup lang="ts">
import { templateAsset } from '../../composables/useTemplateAsset'

defineProps<{
  heading?: string
  imageSrc: string
  caption?: string
  imageFit?: 'cover' | 'contain'
}>()
</script>

<template>
  <div class="slidev-layout jingyeda-template jyd-image-content-slide">
    <div class="jyd-image-content-root">
      <LJydHeader>
        <h1 v-if="heading" class="jyd-image-content-title">{{ heading }}</h1>
      </LJydHeader>
      <div class="jyd-image-content-body">
        <!-- 关键:imageSrc 是 agent 绝对路径,不经 templateAsset() -->
        <img
          :src="imageSrc"
          :alt="caption || heading || ''"
          class="jyd-image-content-img"
          :class="`jyd-image-content-img--${imageFit || 'cover'}`"
          decoding="async"
          loading="eager"
        />
        <p v-if="caption" class="jyd-image-content-caption">{{ caption }}</p>
      </div>
      <img
        :src="templateAsset('/templates/jingyeda-standard/logo.png')"
        class="jyd-image-content-watermark"
      />
    </div>
  </div>
</template>

<style scoped>
.jyd-image-content-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
  display: flex;
  flex-direction: column;
}
.jyd-image-content-title {
  color: #ffffff;
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin: 0;
  line-height: 1.3;
}
.jyd-image-content-body {
  /* 图直接充满 header 下所有空间;不留 padding 不留装饰 */
  padding: 0;
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.jyd-image-content-img {
  display: block;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
}
.jyd-image-content-img--cover {
  object-fit: cover;
}
.jyd-image-content-img--contain {
  object-fit: contain;
}
.jyd-image-content-caption {
  /* caption 叠在图底部不挤占 img(无 caption 时根本不渲染) */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 0.6em 3em;
  color: #ffffff;
  background: linear-gradient(to top, rgba(13, 27, 62, 0.65), transparent);
  font-size: 0.7em;
  line-height: 1.5;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.jyd-image-content-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
