<!--
  beitou-standard 目录 layout。
  frontmatter 字段：
    items   : string[] —— 目录项文本数组（必填）。示例：items: ["Q1 关键目标", "数据背景", "重点项目", "风险与依赖"]
    active  : number   —— 1-based 当前高亮项；未设置或 0 则全部高亮（用作总览页）
-->
<script setup lang="ts">
withDefaults(
  defineProps<{
    items?: string[]
    active?: number
  }>(),
  { items: () => [], active: 0 },
)
</script>

<template>
  <div class="slidev-layout toc-slide">
    <div class="toc-root">
      <div class="toc-left-block">
        <div class="toc-left-texture"></div>
        <div class="cross-h"></div>
        <div class="cross-v"></div>
        <div class="toc-zh">目<br />录</div>
        <div class="toc-en">CONTENTS</div>
      </div>
      <div class="toc-divider"></div>
      <div class="toc-right">
        <div
          v-for="(item, idx) in items"
          :key="idx"
          class="toc-item"
          :class="{ inactive: active > 0 && active !== idx + 1 }"
        >
          <span class="toc-num">{{ idx + 1 }}</span>
          <span class="toc-label">{{ item }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toc-root {
  position: absolute;
  inset: 0;
  background: var(--bt-bg-page);
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 40px 48px;
  box-sizing: border-box;
  gap: 20px;
  font-family: var(--bt-ff-brand);
}
.toc-left-block {
  position: relative;
  width: 350px;
  height: 350px;
  flex-shrink: 0;
  background: var(--bt-brand-gradient);
  overflow: hidden;
}
.toc-left-texture {
  position: absolute;
  inset: 0;
  background-image: url('/templates/beitou-standard/logo-mark.png');
  background-repeat: no-repeat;
  background-size: 100% 100%;
  background-position: center;
  opacity: 0.1;
  mix-blend-mode: screen;
  pointer-events: none;
}
.cross-h {
  position: absolute;
  top: 90%;
  left: 30%;
  right: 10%;
  height: 1px;
  background: #ffffff;
}
.cross-v {
  position: absolute;
  left: 45%;
  top: 70%;
  bottom: 2%;
  width: 1px;
  background: #ffffff;
}
.toc-zh {
  position: absolute;
  top: 48%;
  left: 25%;
  color: #ffffff;
  font-size: 60px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 4px;
  z-index: 2;
}
.toc-en {
  position: absolute;
  bottom: 12%;
  left: 50%;
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 3px;
  z-index: 2;
}
.toc-divider {
  width: 3px;
  align-self: center;
  height: 350px;
  background: var(--bt-brand);
  flex-shrink: 0;
}
.toc-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 36px;
  gap: 30px;
}
.toc-item {
  display: flex;
  align-items: center;
  border: 2px solid var(--bt-brand);
}
.toc-item.inactive {
  opacity: 0.2;
  border-color: rgba(208, 13, 20, 0.4);
}
.toc-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  background: var(--bt-brand);
  flex-shrink: 0;
}
.toc-label {
  flex: 1;
  font-size: 22px;
  font-weight: 600;
  color: var(--bt-fg-primary);
  letter-spacing: 2px;
  padding: 10px 16px;
}
</style>
