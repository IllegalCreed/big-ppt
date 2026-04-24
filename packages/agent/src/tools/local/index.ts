import { register } from '../registry.js'
import { readSlidesTool } from './read-slides.js'
import { writeSlidesTool } from './write-slides.js'
import { editSlidesTool } from './edit-slides.js'
import { createSlideTool } from './create-slide.js'
import { updateSlideTool } from './update-slide.js'
import { deleteSlideTool } from './delete-slide.js'
import { reorderSlidesTool } from './reorder-slides.js'
import { listTemplatesTool } from './list-templates.js'
import { readTemplateTool } from './read-template.js'
import { switchTemplateTool } from './switch-template.js'

export function registerLocalTools(): void {
  register(readSlidesTool)
  register(writeSlidesTool)
  register(editSlidesTool)
  register(createSlideTool)
  register(updateSlideTool)
  register(deleteSlideTool)
  register(reorderSlidesTool)
  register(listTemplatesTool)
  register(readTemplateTool)
  register(switchTemplateTool)
}
