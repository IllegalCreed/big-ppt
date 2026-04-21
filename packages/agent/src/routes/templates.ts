import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { getPaths } from '../workspace.js'

const IGNORE_FILES = new Set(['DESIGN.md', 'README.md'])

export const templates = new Hono()

templates.get('/list-templates', (c) => {
  try {
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

    return c.json({
      success: true,
      templates: files,
      usage_guide,
      design_spec,
      available_images,
    })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

templates.post('/read-template', async (c) => {
  try {
    const { templatesDir } = getPaths()
    const { name } = await c.req.json<{ name?: string }>()
    if (!name) return c.json({ success: false, error: 'name 不能为空' }, 400)
    const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')
    if (!safeName.endsWith('.md')) {
      return c.json({ success: false, error: '只支持 .md 模板文件' }, 400)
    }
    const templatePath = path.join(templatesDir, safeName)
    // 保证解析后仍在 templatesDir 下（防路径穿越）
    const resolved = path.resolve(templatePath)
    if (!resolved.startsWith(path.resolve(templatesDir) + path.sep)) {
      return c.json({ success: false, error: '非法路径' }, 403)
    }
    if (!fs.existsSync(resolved)) {
      return c.json({ success: false, error: `模板 ${safeName} 不存在` }, 404)
    }
    const content = fs.readFileSync(resolved, 'utf-8')
    return c.json({ success: true, content })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
