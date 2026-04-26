<!--
  jingyeda-standard 封面 layout。
  结构：三段高度 1/3 等分（logo / banner 2×2 grid / 文字段）
  所有尺寸用相对单位（em / fr / %），不依赖 px，便于不同 canvas 尺寸自适应。
  frontmatter 字段（全部可选，缺失时对应元素隐藏）：
    mainTitle  : 主标题（品牌蓝）
    subtitle   : 副标题（自动加括号）
    reporter   : 汇报人
    department : 所在部门
    bu         : 所属 BU（业务单元）
    date       : 汇报日期
-->
<script setup lang="ts">
import { templateAsset } from '../../composables/useTemplateAsset'

defineProps<{
  mainTitle?: string
  subtitle?: string
  reporter?: string
  department?: string
  bu?: string
  date?: string
}>()
</script>

<template>
  <div class="slidev-layout jingyeda-template jyd-cover-slide">
    <div class="jyd-cover-root">
      <!-- ① logo 段（1/3） -->
      <div class="jyd-cover-top">
        <img :src="templateAsset('/templates/jingyeda-standard/logo.png')" class="jyd-cover-logo" />
      </div>

      <!-- ② banner 段（1/3）：2×2 grid ── banner 图 / 右侧蓝竖条 / 底部蓝横条 / 右下绿方块 -->
      <div class="jyd-cover-banner">
        <img
          :src="templateAsset('/templates/jingyeda-standard/banner.png')"
          class="jyd-cover-banner-img"
        />
        <div class="jyd-cover-banner-right"></div>
        <div class="jyd-cover-banner-bottom"></div>
        <div class="jyd-cover-banner-corner"></div>
      </div>

      <!-- ③ 文字段（1/3） -->
      <div class="jyd-cover-bottom">
        <div class="jyd-cover-titles">
          <h1 v-if="mainTitle" class="jyd-cover-title">{{ mainTitle }}</h1>
          <p v-if="subtitle" class="jyd-cover-subtitle">（{{ subtitle }}）</p>
        </div>
        <div v-if="reporter || department || bu || date" class="jyd-cover-info">
          <div v-if="reporter" class="jyd-cover-info-cell">
            <span class="jyd-cover-info-label">汇报人：</span>
            <span class="jyd-cover-info-value">{{ reporter }}</span>
          </div>
          <div v-if="department" class="jyd-cover-info-cell">
            <span class="jyd-cover-info-label">所在部门：</span>
            <span class="jyd-cover-info-value">{{ department }}</span>
          </div>
          <div v-if="bu" class="jyd-cover-info-cell">
            <span class="jyd-cover-info-label">所属BU：</span>
            <span class="jyd-cover-info-value">{{ bu }}</span>
          </div>
          <div v-if="date" class="jyd-cover-info-cell">
            <span class="jyd-cover-info-label">汇报日期：</span>
            <span class="jyd-cover-info-value">{{ date }}</span>
          </div>
        </div>
      </div>

      <!-- 右下角网址 -->
      <span class="jyd-cover-url">www.jyd.com.cn</span>
    </div>
  </div>
</template>

<style scoped>
.jyd-cover-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  font-family: var(--jyd-ff-brand);
}

/* ① logo 段（3/10） */
.jyd-cover-top {
  flex: 3;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0 5%;
}
.jyd-cover-logo {
  height: 1.5em; /* 跟随基础字号缩放 */
}

/* ② banner 段（3/10）：2×2 grid，尺寸全比例（参照参考图实测比例） */
.jyd-cover-banner {
  flex: 4;
  display: grid;
  grid-template-columns: 10fr 2fr;
  grid-template-rows: 8fr 1fr;
  gap: 0.5em;
  overflow: hidden;
}
.jyd-cover-banner-img {
  grid-column: 1;
  grid-row: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  min-height: 0; /* 允许 grid 子项自由缩小 */
}
.jyd-cover-banner-right {
  grid-column: 2;
  grid-row: 1;
  background: var(--jyd-brand-primary);
}
/* 底横条：只占 banner 图宽度的 75%，左对齐，右端到绿方块之间留白缝 */
.jyd-cover-banner-bottom {
  grid-column: 1;
  grid-row: 2;
  justify-self: start;
  width: 100%;
  height: 100%;
  background: var(--jyd-brand-primary);
}
.jyd-cover-banner-corner {
  grid-column: 2;
  grid-row: 2;
  background: var(--jyd-brand-accent);
}

/* ③ 文字段（4/10） */
.jyd-cover-bottom {
  flex: 4;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.4em;
  padding: 0 7.3%;
}
.jyd-cover-titles {
  text-align: center;
}
.jyd-cover-title {
  color: var(--jyd-brand-primary);
  font-size: 2.25em;
  font-weight: 500; /* 仿宋系不宜过粗，synthesized bold 会发糊 */
  letter-spacing: 0.18em;
  margin: 0;
  line-height: 1.3;
}
.jyd-cover-subtitle {
  color: var(--jyd-brand-primary); /* 副标题也改为品牌蓝 */
  font-size: 1.125em;
  font-weight: 400;
  letter-spacing: 0.12em;
  margin: 0.25em 0 0 0;
  line-height: 1.3;
}
.jyd-cover-info {
  display: grid;
  grid-template-columns: auto auto; /* 按内容宽度自动撑开，不强制 1:1 分 */
  justify-content: center; /* 两列整体在 grid 容器内水平居中 */
  column-gap: 4em;
  row-gap: 0.6em;
  font-family: var(--jyd-ff-ui);
  font-size: 1em;
  line-height: 1.6;
  letter-spacing: 0.06em;
}
.jyd-cover-info-cell {
  display: flex;
  align-items: baseline;
  white-space: nowrap;
}
.jyd-cover-info-label {
  color: var(--jyd-fg-primary);
  font-weight: bold;
  flex-shrink: 0;
}
.jyd-cover-info-value {
  color: var(--jyd-fg-primary);
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右下角网址 */
.jyd-cover-url {
  position: absolute;
  right: 3.7%;
  bottom: 2.2%;
  color: var(--jyd-brand-primary);
  font-size: 0.75em;
  letter-spacing: 0.08em;
}
</style>
