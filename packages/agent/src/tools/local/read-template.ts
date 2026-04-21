import fs from 'node:fs'
import path from 'node:path'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'

export const readTemplateTool: ToolDef = {
  name: 'read_template',
  description: '读取指定模板文件的 markdown 内容，用于了解模板的结构和语法。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '模板文件名，如 cover.md、toc.md、content.md' },
    },
    required: ['name'],
  },
  exec: async (args) => {
    const name = typeof args.name === 'string' ? args.name : ''
    if (!name) return JSON.stringify({ success: false, error: 'name 不能为空' })
    const { templatesDir } = getPaths()
    const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')
    if (!safeName.endsWith('.md')) {
      return JSON.stringify({ success: false, error: '只支持 .md 模板文件' })
    }
    const templatePath = path.join(templatesDir, safeName)
    const resolved = path.resolve(templatePath)
    if (!resolved.startsWith(path.resolve(templatesDir) + path.sep)) {
      return JSON.stringify({ success: false, error: '非法路径' })
    }
    if (!fs.existsSync(resolved)) {
      return JSON.stringify({ success: false, error: `模板 ${safeName} 不存在` })
    }
    return JSON.stringify({ success: true, content: fs.readFileSync(resolved, 'utf-8') })
  },
}
