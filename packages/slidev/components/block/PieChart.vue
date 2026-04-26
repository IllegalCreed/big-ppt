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
 * Phase 7.5E：饼图。直接读 5 色色板 token，分片 i 取 chart-((i % 5) + 1)。
 * 色板由模板 tokens.css 设计——以品牌色为锚 + 错峰异色，保证多分片区分度。
 *   --ld-color-chart-1..5    : 5 色色板
 *   --ld-color-fg-primary    : 标签文字
 *   --ld-color-bg-page       : 切片之间的描边色（贴页面底）
 *   --ld-font-family-ui      : chart 文字
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
  const c1 = s.getPropertyValue('--ld-color-chart-1').trim()
  const c2 = s.getPropertyValue('--ld-color-chart-2').trim()
  const c3 = s.getPropertyValue('--ld-color-chart-3').trim()
  const c4 = s.getPropertyValue('--ld-color-chart-4').trim()
  const c5 = s.getPropertyValue('--ld-color-chart-5').trim()
  const fg = s.getPropertyValue('--ld-color-fg-primary').trim()
  const ff = s.getPropertyValue('--ld-font-family-ui').trim()
  const bg = s.getPropertyValue('--ld-color-bg-page').trim()

  if (c1 && c2 && c3 && c4 && c5) {
    palette.value = [c1, c2, c3, c4, c5]
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
