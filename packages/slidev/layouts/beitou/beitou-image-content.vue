<!--
  Phase 11.5：beitou-standard 图片内容页 layout。
  body 是一张 16:9 的图片(由 generate_slide_image 工具填 imageSrc)。
  当前不暴露 layout slot - body 文本无视。

  frontmatter 字段:
    heading?  : string —— 页标题(红色,40px,与 beitou-content 一致)
    imageSrc  : string —— /api/assets/<uuid>(agent 绝对路径,不要经 templateAsset())
    imageFit? : 'cover' | 'contain' —— 默认 contain(整图必显,比例不符留边不裁);hero 满铺可显式传 cover
                注:出图尺寸(manifest.imageGenSize)匹配 body 区时 contain≡cover 满铺无边;
                仅当 provider 返回比例不符(如中转无视 size 按 16:9 返图)才留边——此时留边 ≫ 裁掉内容
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  imageSrc: string
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
          :alt="heading || ''"
          class="image-content-img"
          :class="`image-content-img--${imageFit || 'contain'}`"
          decoding="async"
          loading="eager"
        />
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
  /* 图直接充满 header 下所有空间;不留 padding 不留装饰 */
  padding: 0;
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.image-content-img {
  /* 撑满 body,无圆角无阴影,纯净充满 */
  display: block;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
}
.image-content-img--cover {
  object-fit: cover;
}
.image-content-img--contain {
  object-fit: contain;
}
</style>
