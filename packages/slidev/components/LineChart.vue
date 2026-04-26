<script setup lang="ts">
import { Line } from 'vue-chartjs'
import { computed, onMounted, ref } from 'vue'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

const props = defineProps<{
  labels: string[]
  values: number[]
  label?: string
  height?: number
}>()

/*
 * Phase 7.5C-3：token rename 同 BarChart。
 *   --ld-color-chart-primary-border : 折线颜色 + 点填充色
 *   --ld-color-chart-primary-bg     : 折线下方填充色（含 alpha）
 *   --ld-color-fg-primary           : 主文字色
 *   --ld-color-fg-muted             : 次要文字色
 *   --ld-font-family-ui             : chart 文字字体（chart-level option，
 *                                     不动 Chart.defaults 避免单例互覆盖）
 * fallback 中性灰。
 */
const rootRef = ref<HTMLElement | null>(null)
const lineColor = ref('#888888')
const fillColor = ref('rgba(128, 128, 128, 0.15)')
const textColor = ref('#333333')
const mutedColor = ref('#666666')
const fontFamily = ref('Microsoft YaHei, 微软雅黑, sans-serif')

onMounted(() => {
  if (!rootRef.value) return
  const s = getComputedStyle(rootRef.value)
  const bd = s.getPropertyValue('--ld-color-chart-primary-border').trim()
  const bg = s.getPropertyValue('--ld-color-chart-primary-bg').trim()
  const fg = s.getPropertyValue('--ld-color-fg-primary').trim()
  const muted = s.getPropertyValue('--ld-color-fg-muted').trim()
  const ff = s.getPropertyValue('--ld-font-family-ui').trim()
  if (bd) lineColor.value = bd
  if (bg) fillColor.value = bg
  if (fg) textColor.value = fg
  if (muted) mutedColor.value = muted
  if (ff) fontFamily.value = ff
})

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      label: props.label ?? '数值',
      data: props.values,
      borderColor: lineColor.value,
      backgroundColor: fillColor.value,
      borderWidth: 3,
      pointBackgroundColor: lineColor.value,
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 5,
      fill: true,
      tension: 0.35,
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        font: { family: fontFamily.value, size: 14 },
        color: textColor.value,
      },
    },
  },
  scales: {
    x: {
      ticks: {
        font: { family: fontFamily.value, size: 13 },
        color: textColor.value,
      },
      grid: { display: false },
    },
    y: {
      beginAtZero: true,
      ticks: {
        font: { family: fontFamily.value, size: 13 },
        color: mutedColor.value,
      },
      grid: { color: 'rgba(0, 0, 0, 0.06)' },
    },
  },
}))
</script>

<template>
  <div ref="rootRef" :style="{ height: `${height ?? 340}px`, width: '100%' }">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
