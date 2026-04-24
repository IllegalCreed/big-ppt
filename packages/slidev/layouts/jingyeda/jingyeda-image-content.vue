<!--
  jingyeda-standard 图文 layout：左 45% 图 + 右 55% 文字。
  frontmatter 字段：
    heading   : 页标题
    image     : 图片 URL
    textTitle : 文字区小标题
  slot default : 文字正文
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  image?: string
  textTitle?: string
}>()
</script>

<template>
  <div class="slidev-layout jyd-image-content-slide">
    <div class="jyd-ic-root">
      <LJydHeader>
        <h1 v-if="heading" class="jyd-ic-title">{{ heading }}</h1>
      </LJydHeader>
      <div class="jyd-ic-body">
        <div class="jyd-ic-image-wrap">
          <img v-if="image" :src="image" class="jyd-ic-image" />
        </div>
        <div class="jyd-ic-text-wrap">
          <h2 v-if="textTitle" class="jyd-ic-text-title">{{ textTitle }}</h2>
          <div class="jyd-ic-text-body">
            <slot />
          </div>
        </div>
      </div>
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-ic-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-ic-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
}
.jyd-ic-title {
  color: #ffffff;
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin: 0;
  line-height: 1.3;
}
.jyd-ic-body {
  margin-top: 1.75em;
  padding: 0 3em 3em;
  display: flex;
  align-items: center;
  gap: 2.25em;
}
.jyd-ic-image-wrap {
  flex: 0 0 45%;
  aspect-ratio: 4 / 3;
  background: var(--jyd-bg-subtle);
  border: 0.2em solid var(--jyd-brand-primary);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.jyd-ic-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.jyd-ic-text-wrap {
  flex: 1;
  min-width: 0;
}
.jyd-ic-text-title {
  color: var(--jyd-brand-primary);
  font-size: 1.375em;
  font-weight: 700;
  letter-spacing: 0.12em;
  margin: 0 0 0.7em 0;
  padding-bottom: 0.5em;
  border-bottom: 0.2em solid var(--jyd-brand-accent);
}
.jyd-ic-text-body {
  color: var(--jyd-fg-primary);
  font-size: 1.2em;
  line-height: 1.8;
}
.jyd-ic-text-body :deep(p) {
  margin: 0.3em 0;
}
.jyd-ic-text-body :deep(strong) {
  color: var(--jyd-brand-primary);
}
.jyd-ic-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
