<!--
  红色渐变标题块（带 logo-mark texture）。被 cover / back-cover layout 使用。
  slot 内放实际标题文字（h1 / h2），本组件只负责底色 + texture。
-->
<script setup lang="ts">
withDefaults(defineProps<{ padding?: string }>(), { padding: '32px 0' })
</script>

<template>
  <div class="l-title-block" :style="{ padding }">
    <div class="l-title-texture"></div>
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
  background-image: url('/templates/company-standard/logo-mark.png');
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
