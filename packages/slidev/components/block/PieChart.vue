<script setup lang="ts">
import { Pie } from 'vue-chartjs'
import { computed, onMounted, ref } from 'vue'
import { ArcElement, CategoryScale, Chart as ChartJS, Legend, Title, Tooltip } from 'chart.js'

ChartJS.register(ArcElement, CategoryScale, Title, Tooltip, Legend)

const props = defineProps<{
  labels: string[]
  values: number[]
  label?: string
  height?: number
}>()

/*
 * Phase 7.5E：饼图。颜色策略——基于品牌主色生成多片色阶（不同 alpha）让多分片
 * 之间有视觉对比，不再依赖单一 chart-primary 双色对。读 token：
 *   --ld-color-brand-primary       : 主色基底
 *   --ld-color-brand-primary-deep  : 深主色（深色片）
 *   --ld-color-brand-accent        : 辅色
 *   --ld-color-fg-primary / muted  : 标签文字
 *   --ld-font-family-ui            : chart 文字
 * 所有色由用户模板的 token 决定，跨模板自动适配。
 */
const rootRef = ref<HTMLElement | null>(null)
const palette = ref<string[]>([
  'rgba(128, 128, 128, 0.85)',
  'rgba(128, 128, 128, 0.65)',
  'rgba(128, 128, 128, 0.45)',
  'rgba(128, 128, 128, 0.30)',
  'rgba(128, 128, 128, 0.20)',
])
const borderColor = ref('#ffffff')
const textColor = ref('#333333')
const fontFamily = ref('Microsoft YaHei, 微软雅黑, sans-serif')

onMounted(() => {
  if (!rootRef.value) return
  const s = getComputedStyle(rootRef.value)
  const primary = s.getPropertyValue('--ld-color-brand-primary').trim()
  const deep = s.getPropertyValue('--ld-color-brand-primary-deep').trim()
  const accent = s.getPropertyValue('--ld-color-brand-accent').trim()
  const muted = s.getPropertyValue('--ld-color-fg-muted').trim()
  const fg = s.getPropertyValue('--ld-color-fg-primary').trim()
  const ff = s.getPropertyValue('--ld-font-family-ui').trim()
  const bg = s.getPropertyValue('--ld-color-bg-page').trim()

  if (primary && deep && accent) {
    palette.value = [primary, deep, accent, muted || '#888888', '#cccccc']
  }
  if (bg) borderColor.value = bg
  if (fg) textColor.value = fg
  if (ff) fontFamily.value = ff
})

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      label: props.label ?? '占比',
      data: props.values,
      backgroundColor: props.values.map((_, i) => palette.value[i % palette.value.length]),
      borderColor: borderColor.value,
      borderWidth: 2,
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'right' as const,
      labels: {
        font: { family: fontFamily.value, size: 14 },
        color: textColor.value,
        padding: 14,
        boxWidth: 16,
      },
    },
  },
}))
</script>

<template>
  <div ref="rootRef" :style="{ height: `${height ?? 340}px`, width: '100%' }">
    <Pie :data="chartData" :options="chartOptions" />
  </div>
</template>
