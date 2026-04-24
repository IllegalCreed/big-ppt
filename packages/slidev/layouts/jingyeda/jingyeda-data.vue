<!--
  jingyeda-standard 数据 layout：左侧 chart 区（slot default） + 右侧蓝底指标卡列。
  frontmatter 字段：
    heading : 页标题
    metrics : Array<{ value: string|number, unit?: string, label: string }>
              示例：metrics: [{ "value": "629", "unit": "点", "label": "年度交付总量" }]
  slot default：chart 内容（通常是 <BarChart /> / <LineChart />）
-->
<script setup lang="ts">
interface Metric {
  value: string | number
  unit?: string
  label: string
}
withDefaults(
  defineProps<{
    heading?: string
    metrics?: Metric[]
  }>(),
  { metrics: () => [] },
)
</script>

<template>
  <div class="slidev-layout jyd-data-slide">
    <div class="jyd-data-root">
      <LJydHeader>
        <h1 v-if="heading" class="jyd-data-title">{{ heading }}</h1>
      </LJydHeader>
      <div class="jyd-data-body">
        <div class="jyd-data-chart">
          <slot />
        </div>
        <div v-if="metrics.length" class="jyd-data-metrics">
          <div v-for="(m, i) in metrics" :key="i" class="jyd-metric">
            <div class="jyd-metric-top">
              <span class="jyd-metric-value">{{ m.value }}</span>
              <span v-if="m.unit" class="jyd-metric-unit">{{ m.unit }}</span>
            </div>
            <div class="jyd-metric-bar"></div>
            <div class="jyd-metric-label">{{ m.label }}</div>
          </div>
        </div>
      </div>
      <img src="/templates/jingyeda-standard/logo.png" class="jyd-data-watermark" />
    </div>
  </div>
</template>

<style scoped>
.jyd-data-root {
  position: absolute;
  inset: 0;
  background: var(--jyd-bg-page);
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--jyd-ff-brand);
}
.jyd-data-title {
  color: #ffffff;
  font-size: 1.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin: 0;
  line-height: 1.3;
}
.jyd-data-body {
  margin-top: 1.75em;
  padding: 0 3em 3em;
  display: flex;
  align-items: center;
  gap: 2em;
}
.jyd-data-chart {
  flex: 1;
  min-width: 0;
  /* chart 组件从这里读 CSS 变量覆盖默认红色 */
  --chart-primary-bg: rgba(0, 61, 165, 0.85);
  --chart-primary-border: #003da5;
}
.jyd-data-metrics {
  flex: 0 0 25%;
  display: flex;
  flex-direction: column;
  gap: 1em;
}
.jyd-metric {
  background: var(--jyd-brand-primary);
  padding: 1em 1.25em;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}
.jyd-metric-top {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
}
.jyd-metric-value {
  font-size: 2.4em;
  font-weight: 700;
  line-height: 1;
}
.jyd-metric-unit {
  font-size: 0.95em;
  font-weight: 500;
  opacity: 0.9;
}
.jyd-metric-bar {
  width: 2em;
  height: 0.25em;
  background: var(--jyd-brand-accent);
}
.jyd-metric-label {
  font-size: 0.875em;
  opacity: 0.85;
  letter-spacing: 0.06em;
}
.jyd-data-watermark {
  position: absolute;
  right: 2.5%;
  bottom: 3%;
  height: 1.5em;
  opacity: 0.85;
}
</style>
