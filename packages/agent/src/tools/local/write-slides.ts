import { Buffer } from 'node:buffer'
import type { ToolDef } from '../registry.js'
import { writeSlides } from '../../slides-store/index.js'
import type { WriteSlidesResponse } from '@big-ppt/shared'

export const writeSlidesTool: ToolDef = {
  name: 'write_slides',
  description: '用新内容完全替换 slides.md。仅在首次生成幻灯片时使用，修改已有内容请用 edit_slides。',
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
    writeSlides(content)
    const resp: WriteSlidesResponse = { success: true, bytes: Buffer.byteLength(content, 'utf-8') }
    return JSON.stringify(resp)
  },
}
