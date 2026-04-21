import { register } from '../registry.js'
import { readSlidesTool } from './read-slides.js'
import { writeSlidesTool } from './write-slides.js'
import { editSlidesTool } from './edit-slides.js'
import { listTemplatesTool } from './list-templates.js'
import { readTemplateTool } from './read-template.js'

export function registerLocalTools(): void {
  register(readSlidesTool)
  register(writeSlidesTool)
  register(editSlidesTool)
  register(listTemplatesTool)
  register(readTemplateTool)
}
