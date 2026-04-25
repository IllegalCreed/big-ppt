import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { getPaths } from '../workspace.js'
import {
  listManifests,
  getManifest,
  readStarter,
} from '../templates/registry.js'

const IGNORE_FILES = new Set(['DESIGN.md', 'README.md', 'manifest.json', 'starter.md'])

/**
 * 构造一份 list-templates 响应体。
 * Phase 6A 升级：
 *  - 新增 `manifests` 字段承载 Template Manifest 清单（含 layouts + starterSlidesPath）
 *  - 保留 `templates` / `usage_guide` / `design_spec` / `available_images` 字段以向后兼容旧 tool 调用方
 *  - `manifest.json` / `starter.md` 从 layout `.md` 列表里排除（它们不是 layout）
 */
export function buildListTemplatesPayload(): {
  success: true
  manifests: ReturnType<typeof listManifests>
  templates: Array<{ name: string; path: string }>
  usage_guide: string
  design_spec: string
  available_images: string[]
} {
  const { templatesDir } = getPaths()
  const all = fs.readdirSync(templatesDir)
  const files = all
    .filter((f) => f.endsWith('.md') && !IGNORE_FILES.has(f))
    .map((f) => ({ name: f, path: `beitou-standard/${f}` }))

  const readmePath = path.join(templatesDir, 'README.md')
  const usage_guide = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, 'utf-8')
    : ''

  const designPath = path.join(templatesDir, 'DESIGN.md')
  const design_spec = fs.existsSync(designPath)
    ? fs.readFileSync(designPath, 'utf-8')
    : ''

  const available_images = all
    .filter((f) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
    .map((f) => `/templates/beitou-standard/${f}`)

  return {
    success: true,
    manifests: listManifests(),
    templates: files,
    usage_guide,
    design_spec,
    available_images,
  }
}

export const templates = new Hono()

templates.get('/list-templates', (c) => {
  try {
    return c.json(buildListTemplatesPayload())
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

templates.get('/templates/:id/starter', (c) => {
  const id = c.req.param('id')
  if (!getManifest(id)) {
    return c.json({ success: false, error: `模板 ${id} 不存在` }, 404)
  }
  try {
    const content = readStarter(id)
    return c.json({ success: true, templateId: id, content })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

/** 静态资源路由：缩略图 / logo 等模板目录里的图片文件。
 *  路径：GET /api/templates/:id/:filename
 *  安全：filename 白名单后缀（png/jpg/jpeg/svg/webp）+ 阻止 .. / 路径分隔符 + 解析后必须落在模板目录里。
 *  Content-Type 按后缀映射，否则按二进制返回。
 */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

templates.get('/templates/:id/:filename', (c) => {
  const id = c.req.param('id')
  const filename = c.req.param('filename')

  // 1. 模板存在
  if (!getManifest(id)) {
    return c.json({ success: false, error: `模板 ${id} 不存在` }, 404)
  }

  // 2. filename 后缀白名单 + 禁路径分隔/相对路径符
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return c.json({ success: false, error: '非法文件名' }, 400)
  }
  const ext = path.extname(filename).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) {
    return c.json({ success: false, error: '只支持图片文件（png/jpg/svg/webp）' }, 400)
  }

  // 3. 解析路径必须落在 templatesRoot/<id>/ 下（防 traversal）
  const { templatesRoot } = getPaths()
  const templateDir = path.join(templatesRoot, id)
  const filePath = path.join(templateDir, filename)
  const resolvedFile = path.resolve(filePath)
  const resolvedDir = path.resolve(templateDir)
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
    return c.json({ success: false, error: '非法路径' }, 403)
  }

  // 4. 文件存在
  if (!fs.existsSync(resolvedFile)) {
    return c.json({ success: false, error: `${filename} 不存在` }, 404)
  }

  // 5. 直接返回二进制
  const buf = fs.readFileSync(resolvedFile)
  return c.body(buf, 200, {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=300', // 5min；新增模板手跑 gen:thumbnails 后浏览器一刷就更新
  })
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
