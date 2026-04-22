import type { ToolDef } from '../registry.js'
import { createSlide } from '../../slides-store/index.js'
import { coerceIndex } from './utils.js'

export const createSlideTool: ToolDef = {
  name: 'create_slide',
  description:
    '在幻灯片的指定位置插入一张新页。调用时必须传 layout 名；frontmatter 提供 layout 所需的字段（见 read_template 输出）；body 为 markdown 正文。不要在 body 里写 <style> 块或硬编码颜色 —— 视觉由 layout + tokens 决定。',
  parameters: {
    type: 'object',
    properties: {
      index: {
        description:
          '新页插入位置，1-based。传 "end" 或省略则追加到末尾。示例：index=3 表示插在原第 3 页的位置，原第 3 页及之后的页顺延。',
        oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string', enum: ['end'] }],
      },
      layout: {
        type: 'string',
        description: 'layout 名（cover / toc / content / two-col / data / image-content / back-cover 等）',
      },
      frontmatter: {
        type: 'object',
        description: 'layout 所需的额外 frontmatter 键值对（如 heading / leftTitle / items 等）',
        additionalProperties: true,
      },
      body: {
        type: 'string',
        description: 'markdown 正文。两栏 layout 可用 "::left::" / "::right::" 分隔命名 slot。',
      },
    },
    required: ['layout'],
  },
  exec: async (args) => {
    const index = coerceIndex(args.index)
    if (index === null) {
      return JSON.stringify({ success: false, error: 'index 必须是整数或 "end"' })
    }
    const layout = typeof args.layout === 'string' ? args.layout : ''
    const frontmatter =
      args.frontmatter && typeof args.frontmatter === 'object'
        ? (args.frontmatter as Record<string, unknown>)
        : undefined
    const body = typeof args.body === 'string' ? args.body : ''
    const result = createSlide({ index, layout, frontmatter, body })
    return JSON.stringify(result)
  },
}
