import type { ToolDef } from '../registry.js'
import { deleteSlide } from '../../slides-store/index.js'
import { coerceInt } from './utils.js'

export const deleteSlideTool: ToolDef = {
  name: 'delete_slide',
  description:
    '删除指定页。当前 slides.md 只有 1 页时拒绝（避免空 deck，如需清空用 /undo 回退）。',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'integer',
        minimum: 1,
        description: '要删除的页的 1-based 位置',
      },
    },
    required: ['index'],
  },
  exec: async (args) => {
    const index = coerceInt(args.index)
    if (index === null) {
      return JSON.stringify({ success: false, error: 'index 必须是整数' })
    }
    const result = deleteSlide(index)
    return JSON.stringify(result)
  },
}
