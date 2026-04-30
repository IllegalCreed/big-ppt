import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'LineChart',
  category: 'block',
  description: '折线图（带填充），接口同 BarChart',
  propsOrSlots: 'labels: string[] / values: number[] / label? / height?: number',
  example: `<LineChart :labels='["1月","2月","3月"]' :values='[10,28,55]' label="月活" />`,
}
