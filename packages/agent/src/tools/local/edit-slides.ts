import type { ToolDef } from '../registry.js'
import { editSlides } from '../../slides-store/index.js'
import { withSlidesStoreGuard } from './utils.js'

/**
 * Phase 11.6 dogfood 后:edit_slides 加 old_string 长度上限,防 LLM 误用它改整段 / 多页内容。
 * 设计意图是「页内字符串小改」(改一个数字 / 词 / 短短语),长度 ≤ 300 char 足够覆盖。
 * 超过时引导用 update_slide(index, frontmatter, body, replaceFrontmatter) 整页替换。
 */
const OLD_STRING_MAX = 300

export const editSlidesTool: ToolDef = {
  name: 'edit_slides',
  description:
    '精确替换 slides.md 中的某段**短**字符串(改一个词 / 一个数字 / 一句短话)。old_string 必须是文件中**唯一**存在的文本片段且长度 ≤ 300 char。多处匹配 → 拒收(请加上下文唯一定位);超长 → 拒收(改整段 / 换 layout 请用 update_slide,不要用 edit_slides)。',
  parameters: {
    type: 'object',
    properties: {
      old_string: {
        type: 'string',
        minLength: 1,
        maxLength: OLD_STRING_MAX,
        description: `要被替换的原文,必须是文件中**唯一**匹配的文本片段,长度 ≤ ${OLD_STRING_MAX} char。超过说明这不是"小改"应该用 update_slide。`,
      },
      new_string: { type: 'string', description: '替换后的新内容' },
    },
    required: ['old_string', 'new_string'],
  },
  exec: async (args) => {
    const oldString = typeof args.old_string === 'string' ? args.old_string : ''
    const newString = typeof args.new_string === 'string' ? args.new_string : ''
    if (!oldString) {
      return JSON.stringify({ success: false, error: 'old_string 不能为空' })
    }
    if (oldString.length > OLD_STRING_MAX) {
      return JSON.stringify({
        success: false,
        error: `old_string 长度 ${oldString.length} > ${OLD_STRING_MAX} char。edit_slides 仅用于"改一个词 / 数字 / 短短语"等页内小改;改整段或换 layout 请用 update_slide(index, frontmatter, body, replaceFrontmatter: true)。`,
      })
    }
    const result = await withSlidesStoreGuard(() => editSlides(oldString, newString))
    return JSON.stringify(result)
  },
}
