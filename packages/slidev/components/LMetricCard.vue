<!--
  数据页里的一张 metric 卡（红色渐变底 + 白字大数 + 标签）。被 data layout 使用。
-->
<script setup lang="ts">
defineProps<{
  value: string | number
  unit?: string
  label: string
}>()
</script>

<template>
  <div class="l-metric-card">
    <div class="l-metric-value">
      {{ value }}<span v-if="unit" class="l-metric-unit">{{ unit }}</span>
    </div>
    <div class="l-metric-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.l-metric-card {
  padding: 18px 20px;
  background: var(--bt-brand-gradient);
  color: #ffffff;
  text-align: center;
}
.l-metric-value {
  font-size: 42px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: 1px;
}
.l-metric-unit {
  font-size: 20px;
  font-weight: 600;
  margin-left: 4px;
}
.l-metric-label {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  opacity: 0.95;
}
</style>
