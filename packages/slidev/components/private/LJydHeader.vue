<!--
  jingyeda-standard 共用页面顶部标题栏。
  布局：水平 3 段（蓝色 80% + 绿色 10% + 留白 10%），蓝绿块带向下外阴影。
  slot default : 标题内容（会在蓝色块内渲染，继承白色 color）
  用 `L` 前缀标记为 layout 内部复用块，不对 AI prompt 列举。
  被 jingyeda 的 content / toc / two-col / data / image-content 5 个 layout 共用。
-->
<template>
  <div class="l-jyd-header">
    <div class="l-jyd-header-blue">
      <slot />
    </div>
    <div class="l-jyd-header-green"></div>
  </div>
</template>

<style scoped>
.l-jyd-header {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  min-height: 4.5em;
}
.l-jyd-header-blue {
  flex: 0 0 80%;
  background: var(--jyd-brand-primary);
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 1em;
  padding: 0 2em;
  box-shadow: 0 0.3em 0.5em rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}
.l-jyd-header-green {
  flex: 0 0 10%;
  background: var(--jyd-brand-accent);
  box-shadow: 0 0.3em 0.5em rgba(0, 0, 0, 0.15);
}
/* 右边 10% 天然留白（flex 填充） */
</style>
