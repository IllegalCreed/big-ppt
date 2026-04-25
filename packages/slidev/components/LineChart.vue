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
 * 从最近父元素的 CSS 变量读取配色，支持多模板主题切换。
 *   --chart-primary-border : 折线颜色 + 点填充色
 *   --chart-primary-bg     : 折线下方填充色（含 alpha）
 * fallback 到中性灰（避免漏注入时静默使用某个模板的品牌色）。
 */
const rootRef = ref<HTMLElement | null>(null)
const lineColor = ref('#888888')
const fillColor = ref('rgba(128, 128, 128, 0.15)')

onMounted(() => {
  if (!rootRef.value) return
  const s = getComputedStyle(rootRef.value)
  const bd = s.getPropertyValue('--chart-primary-border').trim()
  const bg = s.getPropertyValue('--chart-primary-bg').trim()
  if (bd) lineColor.value = bd
  if (bg) fillColor.value = bg
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

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        font: { family: 'Microsoft YaHei, 微软雅黑, sans-serif', size: 14 },
        color: '#333333',
      },
    },
  },
  scales: {
    x: {
      ticks: {
        font: { family: 'Microsoft YaHei, 微软雅黑, sans-serif', size: 13 },
        color: '#333333',
      },
      grid: { display: false },
    },
    y: {
      beginAtZero: true,
      ticks: {
        font: { family: 'Microsoft YaHei, 微软雅黑, sans-serif', size: 13 },
        color: '#666666',
      },
      grid: { color: 'rgba(0, 0, 0, 0.06)' },
    },
  },
}
</script>

<template>
  <div ref="rootRef" :style="{ height: `${height ?? 340}px`, width: '100%' }">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
