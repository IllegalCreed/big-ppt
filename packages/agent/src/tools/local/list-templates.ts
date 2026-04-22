import fs from 'node:fs'
import path from 'node:path'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'

const IGNORE_FILES = new Set(['DESIGN.md', 'README.md'])

export const listTemplatesTool: ToolDef = {
  name: 'list_templates',
  description: '列出所有可用的页面模板，返回模板文件列表、usage_guide、design_spec 和可用图片路径。',
  parameters: { type: 'object', properties: {} },
  exec: async () => {
    const { templatesDir } = getPaths()
    const all = fs.readdirSync(templatesDir)
    const files = all
      .filter((f) => f.endsWith('.md') && !IGNORE_FILES.has(f))
      .map((f) => ({ name: f, path: `company-standard/${f}` }))
    const readmePath = path.join(templatesDir, 'README.md')
    const usage_guide = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf-8') : ''
    const designPath = path.join(templatesDir, 'DESIGN.md')
    const design_spec = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf-8') : ''
    const available_images = all
      .filter((f) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
      .map((f) => `/templates/company-standard/${f}`)
    return JSON.stringify({ success: true, templates: files, usage_guide, design_spec, available_images })
  },
}
