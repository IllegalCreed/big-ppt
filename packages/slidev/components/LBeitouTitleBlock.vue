<!--
  红色渐变标题块（带 logo-mark texture）。被 cover / back-cover layout 使用。
  slot 内放实际标题文字（h1 / h2），本组件只负责底色 + texture。
-->
<script setup lang="ts">
withDefaults(defineProps<{ padding?: string }>(), { padding: '32px 0' })

// Slidev dev 配 --base /api/slidev-preview/，硬编 url() 不会被 vite 自动加 base
const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
const textureUrl = `url(${baseUrl}/templates/beitou-standard/logo-mark.png)`
</script>

<template>
  <div class="l-title-block" :style="{ padding }">
    <div class="l-title-texture" :style="{ backgroundImage: textureUrl }"></div>
    <div class="l-title-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.l-title-block {
  position: relative;
  background: var(--bt-brand-gradient);
  overflow: hidden;
}
.l-title-texture {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-position: center;
  opacity: 0.1;
  mix-blend-mode: screen;
  pointer-events: none;
}
.l-title-content {
  position: relative;
  z-index: 2;
  text-align: center;
}
</style>
