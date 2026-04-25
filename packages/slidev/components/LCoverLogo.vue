<!--
  beitou-standard 品牌 logo 组合块：红色 logo-mark + 黑色 logo-text。
  用 `L` 前缀标记为 layout 内部复用块（不对 AI prompt 列举）。被 cover / back-cover layout 使用。
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    markSize?: number
    textSize?: number
    /** logo-text 是否压成黑色（封面用 true；反色背景用 false） */
    invertText?: boolean
  }>(),
  { markSize: 44, textSize: 44, invertText: true },
)
</script>

<template>
  <div class="l-cover-logo">
    <img
      src="/templates/beitou-standard/logo-mark.png"
      class="l-logo-mark"
      :style="{ height: `${markSize}px` }"
    />
    <img
      src="/templates/beitou-standard/logo-text.png"
      class="l-logo-text"
      :class="{ 'l-logo-text--invert': invertText }"
      :style="{ height: `${textSize}px` }"
    />
  </div>
</template>

<style scoped>
.l-cover-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.l-logo-mark {
  filter: var(--bt-logo-red-filter);
}
.l-logo-text--invert {
  filter: brightness(0);
}
</style>
