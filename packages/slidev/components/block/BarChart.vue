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
 * Phase 7.5E：从最近父元素读 `--ld-*` 图表色板 token，跨模板自动适配。
 * 单系列默认用色板第 1 色（chart-1 边框 + chart-1-fill 填充 alpha 版）。
 *   --ld-color-chart-1       : bar 边框色 + 强调
 *   --ld-color-chart-1-fill  : bar 填充色（含 alpha）
 *   --ld-color-fg-primary    : 主文字色（轴标题 / legend）
 *   --ld-color-fg-muted      : 次要文字色（轴刻度）
 *   --ld-font-family-ui      : chart 文字字体（chart.js 用 chart-level
 *                              option 而非 Chart.defaults，避免多 chart
 *                              实例互相覆盖单例）
 * 漏注入时 fallback 中性灰，避免静默用上一个模板的品牌色。
 */
const rootRef = ref<HTMLElement | null>(null)
const bgColor = ref('rgba(128, 128, 128, 0.5)')
const borderColor = ref('#888888')
const textColor = ref('#333333')
const mutedColor = ref('#666666')
const fontFamily = ref('Microsoft YaHei, 微软雅黑, sans-serif')

onMounted(() => {
  if (!rootRef.value) return
  const s = getComputedStyle(rootRef.value)
  const bg = s.getPropertyValue('--ld-color-chart-1-fill').trim()
  const bd = s.getPropertyValue('--ld-color-chart-1').trim()
  const fg = s.getPropertyValue('--ld-color-fg-primary').trim()
  const muted = s.getPropertyValue('--ld-color-fg-muted').trim()
  const ff = s.getPropertyValue('--ld-font-family-ui').trim()
  if (bg) bgColor.value = bg
  if (bd) borderColor.value = bd
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
      backgroundColor: bgColor.value,
      borderColor: borderColor.value,
      borderWidth: 1,
      borderRadius: 4,
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
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
