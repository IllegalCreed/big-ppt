import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'MetricCard',
  category: 'block',
  description: '单数字卡（value + unit + label），3 种 variant',
  propsOrSlots: 'value: string|number / unit? / label / variant?: "fill"|"subtle"|"outline"',
  example: '<MetricCard value="89" unit="%" label="客户留存率" />',
}
