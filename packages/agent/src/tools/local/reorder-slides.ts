import type { ToolDef } from '../registry.js'
import { reorderSlides } from '../../slides-store/index.js'
import { coerceIntArray } from './utils.js'

export const reorderSlidesTool: ToolDef = {
  name: 'reorder_slides',
  description:
    '按新顺序重排所有页。order 必须是当前页数 N 的 1..N 排列（无重复无缺失）。示例：当前 4 页 [A,B,C,D] 传 order=[1,3,2,4] 得到 [A,C,B,D]。',
  parameters: {
    type: 'object',
    properties: {
      order: {
        type: 'array',
        items: { type: 'integer', minimum: 1 },
        description:
          '新顺序数组，长度等于当前页数，每个元素是 1..N 的排列',
      },
    },
    required: ['order'],
  },
  exec: async (args) => {
    const order = coerceIntArray(args.order)
    if (order === null) {
      return JSON.stringify({ success: false, error: 'order 必须是整数数组' })
    }
    const result = reorderSlides(order)
    return JSON.stringify(result)
  },
}
