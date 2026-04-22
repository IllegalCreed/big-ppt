import type { ToolDef } from '../registry.js'
import { updateSlide } from '../../slides-store/index.js'
import { coerceInt } from './utils.js'

export const updateSlideTool: ToolDef = {
  name: 'update_slide',
  description:
    '修改指定页的 frontmatter 和/或 body。用于整页范围的改动（换布局、换标题、替换整段正文）。小范围替换（改一个词 / 数字）用 edit_slides 更安全。不要在 body 里写 <style> 块或硬编码颜色。',
  parameters: {
    type: 'object',
    properties: {
      index: {
        type: 'integer',
        minimum: 1,
        description: '要修改的页的 1-based 位置',
      },
      frontmatter: {
        type: 'object',
        description:
          '新 frontmatter。默认与现有字段合并（覆盖同名），replaceFrontmatter=true 时完全替换。',
        additionalProperties: true,
      },
      body: {
        type: 'string',
        description: '新 body（整段替换）。缺省表示 body 不变。',
      },
      replaceFrontmatter: {
        type: 'boolean',
        description: '为 true 时完全替换 frontmatter（删掉所有未列出的键），默认 false 合并',
      },
    },
    required: ['index'],
  },
  exec: async (args) => {
    const index = coerceInt(args.index)
    if (index === null) {
      return JSON.stringify({ success: false, error: 'index 必须是整数' })
    }
    const frontmatter =
      args.frontmatter && typeof args.frontmatter === 'object'
        ? (args.frontmatter as Record<string, unknown>)
        : undefined
    const body = typeof args.body === 'string' ? args.body : undefined
    const replaceFrontmatter = args.replaceFrontmatter === true
    const result = updateSlide({ index, frontmatter, body, replaceFrontmatter })
    return JSON.stringify(result)
  },
}
