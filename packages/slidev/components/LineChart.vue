<script setup lang="ts">
import { Line } from 'vue-chartjs'
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

const chartData = {
  labels: props.labels,
  datasets: [
    {
      label: props.label ?? '数值',
      data: props.values,
      borderColor: '#d00d14',
      backgroundColor: 'rgba(208, 13, 20, 0.15)',
      borderWidth: 3,
      pointBackgroundColor: '#d00d14',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 5,
      fill: true,
      tension: 0.35,
    },
  ],
}

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
  <div :style="{ height: `${height ?? 340}px`, width: '100%' }">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
