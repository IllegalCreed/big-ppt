<!--
  company-standard 图文 layout：左 45% 图 + 右 55% 文字。
  frontmatter 字段：
    heading   : string —— 页标题。用 heading 而非 title 避开 Slidev 全局 headmatter `title`
    image     : string —— 图片 URL
    textTitle : string —— 文字区小标题
  slot default：文字正文
-->
<script setup lang="ts">
defineProps<{
  heading?: string
  image?: string
  textTitle?: string
}>()
</script>

<template>
  <div class="slidev-layout image-content-slide">
    <div class="content-root">
      <h1 v-if="heading" class="content-title">{{ heading }}</h1>
      <div class="image-content-body">
        <div class="image-wrap">
          <img v-if="image" :src="image" class="content-image" />
        </div>
        <div class="text-wrap">
          <h2 v-if="textTitle" class="text-title">{{ textTitle }}</h2>
          <div class="text-body">
            <slot />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-root {
  position: absolute;
  inset: 0;
  background: var(--c-bg-page);
  overflow: hidden;
  padding: 48px 60px;
  box-sizing: border-box;
  font-family: var(--ff-brand);
}
.content-title {
  color: var(--c-brand);
  font-size: 40px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
  line-height: 1.2;
}
.image-content-body {
  margin-top: 48px;
  display: flex;
  align-items: center;
  gap: 48px;
}
.image-wrap {
  flex: 0 0 45%;
  aspect-ratio: 4 / 3;
  background: var(--c-bg-subtle);
  border: 4px solid var(--c-brand);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.content-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.text-wrap {
  flex: 1;
  min-width: 0;
}
.text-title {
  color: var(--c-brand);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--c-brand);
}
.text-body {
  color: var(--c-fg-primary);
  font-size: 20px;
  line-height: 1.8;
}
.text-body :deep(p) {
  margin: 6px 0;
}
</style>
