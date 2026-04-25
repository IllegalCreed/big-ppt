<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import { computed, onMounted, ref } from 'vue'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const props = defineProps<{
  labels: string[]
  values: number[]
  label?: string
  height?: number
}>()

/*
 * 从最近父元素的 CSS 变量读取配色，支持多模板主题切换。
 *   --chart-primary-bg     : bar fill color (含 alpha)
 *   --chart-primary-border : bar border color
 * 如果父级没设这些变量，fallback 到中性灰（避免漏注入时静默使用某个模板的品牌色）。
 */
const rootRef = ref<HTMLElement | null>(null)
const bgColor = ref('rgba(128, 128, 128, 0.5)')
const borderColor = ref('#888888')

onMounted(() => {
  if (!rootRef.value) return
  const s = getComputedStyle(rootRef.value)
  const bg = s.getPropertyValue('--chart-primary-bg').trim()
  const bd = s.getPropertyValue('--chart-primary-border').trim()
  if (bg) bgColor.value = bg
  if (bd) borderColor.value = bd
})

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      label: props.label ?? '数值',
      data: props.values,
      backgroundColor: bgColor.value,
      borderColor: borderColor.value,
      borderWidth: 1,
      borderRadius: 4,
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
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
