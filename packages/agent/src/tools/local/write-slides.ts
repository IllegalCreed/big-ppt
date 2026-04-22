import { Buffer } from 'node:buffer'
import type { ToolDef } from '../registry.js'
import { writeSlides } from '../../slides-store/index.js'
import type { WriteSlidesResponse } from '@big-ppt/shared'

export const writeSlidesTool: ToolDef = {
  name: 'write_slides',
  description:
    '用新内容**完全替换** slides.md。**仅**用于首次生成 / 模板重置（slides.md 为空）；若已存在 ≥1 页会被拒绝。修改已有内容请用 create_slide / update_slide / delete_slide / reorder_slides 四件套，页内小改用 edit_slides。',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '完整的 slides markdown 内容，包括 frontmatter 和所有页面',
      },
    },
    required: ['content'],
  },
  exec: async (args) => {
    const content = typeof args.content === 'string' ? args.content : ''
    if (!content) {
      const resp: WriteSlidesResponse = { success: false, error: 'content 不能为空' }
      return JSON.stringify(resp)
    }
    const result = writeSlides(content)
    const resp: WriteSlidesResponse = result.success
      ? { success: true, bytes: Buffer.byteLength(content, 'utf-8') }
      : { success: false, error: result.error }
    return JSON.stringify(resp)
  },
}
