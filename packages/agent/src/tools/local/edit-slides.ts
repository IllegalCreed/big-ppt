import type { ToolDef } from '../registry.js'
import { editSlides } from '../../slides-store/index.js'

export const editSlidesTool: ToolDef = {
  name: 'edit_slides',
  description:
    '精确替换 slides.md 中的某段内容。old_string 必须是文件中唯一存在的文本片段，如果匹配到多处会报错，请提供更长的上下文以唯一定位。',
  parameters: {
    type: 'object',
    properties: {
      old_string: { type: 'string', description: '要被替换的原文，必须是文件中唯一匹配的文本' },
      new_string: { type: 'string', description: '替换后的新内容' },
    },
    required: ['old_string', 'new_string'],
  },
  exec: async (args) => {
    const oldString = typeof args.old_string === 'string' ? args.old_string : ''
    const newString = typeof args.new_string === 'string' ? args.new_string : ''
    const result = await editSlides(oldString, newString)
    return JSON.stringify(result)
  },
}
