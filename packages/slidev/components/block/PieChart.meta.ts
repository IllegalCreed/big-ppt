import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'PieChart',
  category: 'block',
  description: '饼图，多分片色阶来自品牌主色 / 深色 / 辅色 + 中性灰',
  propsOrSlots: 'labels: string[] / values: number[] / label? / height?: number',
  example: `<PieChart :labels='["Chrome","Safari","Firefox"]' :values='[62,18,20]' label="浏览器份额" />`,
}
