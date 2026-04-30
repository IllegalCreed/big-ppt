<!--
  beitou-standard 共用页面顶部标题栏。
  布局：占满宽度的红底（横向渐变），右侧叠半透明 logo 纹理。
  slot default : 标题内容（会在红色块内渲染，继承白色 color）
  用 `L` 前缀标记为 layout 内部复用块，不对 AI prompt 列举。
  被 beitou 的 content / image-content 等内容页 layout 共用。
-->
<script setup lang="ts">
import { templateAsset } from '../../composables/useTemplateAsset'
</script>

<template>
  <div class="l-bt-header">
    <div class="l-bt-header-bar">
      <div class="l-bt-header-content">
        <slot />
      </div>
      <img
        :src="templateAsset('/templates/beitou-standard/logo-mark.png')"
        class="l-bt-header-logo"
        alt=""
        aria-hidden="true"
      />
    </div>
  </div>
</template>

<style scoped>
.l-bt-header {
  display: flex;
  flex-shrink: 0;
  min-height: 4.5em;
}
.l-bt-header-bar {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 2.5em;
  background: linear-gradient(
    90deg,
    var(--bt-brand) 0%,
    var(--bt-brand-mid) 55%,
    var(--bt-brand-deep) 100%
  );
  color: #ffffff;
  box-shadow: 0 0.3em 0.5em rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.l-bt-header-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 1em;
}
.l-bt-header-logo {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 50%;
  height: 100%;
  object-fit: fill;
  opacity: 0.18;
  pointer-events: none;
  user-select: none;
}
</style>
