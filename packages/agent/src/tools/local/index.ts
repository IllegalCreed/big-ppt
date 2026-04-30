import { register } from '../registry.js'
import { readSlidesTool } from './read-slides.js'
import { writeSlidesTool } from './write-slides.js'
import { editSlidesTool } from './edit-slides.js'
import { createSlideTool } from './create-slide.js'
import { updateSlideTool } from './update-slide.js'
import { deleteSlideTool } from './delete-slide.js'
import { reorderSlidesTool } from './reorder-slides.js'
import { readTemplateTool } from './read-template.js'
import { switchTemplateTool } from './switch-template.js'
import { generateSlideImageTool } from './generate-slide-image.js'

/**
 * Phase 11.6 dogfood 后:删除 list_templates 工具(跨模板返回所有 manifest 触发污染:
 * beitou deck 出 jingyeda layout)。能力被替代:
 * - 当前模板 manifest layouts 段 → system prompt 已含(buildSystemPrompt 拼装)
 * - design_spec / DESIGN.md → 用 read_template name=DESIGN.md 读
 * - available_images 白名单 → system prompt 加段直接列出当前模板图片
 * - 模板 .md 文件清单 → LLM 用 read_template 时按 cover.md / starter.md / DESIGN.md 等
 *   常见名调用,system prompt 决策树会引导
 */
export function registerLocalTools(): void {
  register(readSlidesTool)
  register(writeSlidesTool)
  register(editSlidesTool)
  register(createSlideTool)
  register(updateSlideTool)
  register(deleteSlideTool)
  register(reorderSlidesTool)
  register(readTemplateTool)
  register(switchTemplateTool)
  register(generateSlideImageTool)
}
