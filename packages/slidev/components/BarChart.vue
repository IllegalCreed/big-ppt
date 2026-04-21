<script setup lang="ts">
import { Bar } from 'vue-chartjs'
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

const chartData = {
  labels: props.labels,
  datasets: [
    {
      label: props.label ?? '数值',
      data: props.values,
      backgroundColor: 'rgba(208, 13, 20, 0.85)',
      borderColor: '#a8090e',
      borderWidth: 1,
      borderRadius: 4,
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
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
