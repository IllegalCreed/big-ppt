import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'BarChart',
  category: 'block',
  description: '柱状图，数据可视化必选；颜色读 ld-chart token',
  propsOrSlots: 'labels: string[] / values: number[] / label? / height?: number',
  example: `<BarChart :labels='["Q1","Q2","Q3","Q4"]' :values='[120,180,150,210]' label="季度营收" />`,
}
