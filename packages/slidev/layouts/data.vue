<!--
  company-standard 数据 layout：左侧 chart 区（slot default） + 右侧 metric cards 列。
  frontmatter 字段：
    heading : string —— 页标题。用 heading 而非 title 避开 Slidev 全局 headmatter `title`
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
  <div class="slidev-layout data-slide">
    <div class="content-root">
      <h1 v-if="heading" class="content-title">{{ heading }}</h1>
      <div class="data-body">
        <div class="chart-wrap">
          <slot />
        </div>
        <div v-if="metrics.length" class="metrics-wrap">
          <LMetricCard
            v-for="(m, i) in metrics"
            :key="i"
            :value="m.value"
            :unit="m.unit"
            :label="m.label"
          />
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
.data-body {
  margin-top: 40px;
  display: flex;
  align-items: center;
  gap: 40px;
}
.chart-wrap {
  flex: 1;
  min-width: 0;
}
.metrics-wrap {
  flex: 0 0 240px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
