import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { templates as templatesRoute } from '../src/routes/templates.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'

function buildApp() {
  const app = new Hono()
  app.route('/api', templatesRoute)
  return app
}

let tmpRoot: string
let templatesRoot: string
let csDir: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-tpl-route-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  csDir = path.join(templatesRoot, 'beitou-standard')
  fs.mkdirSync(csDir, { recursive: true })
  fs.writeFileSync(
    path.join(csDir, 'manifest.json'),
    JSON.stringify({
      id: 'beitou-standard',
      name: '公司标准模板',
      description: 'fixture',
      thumbnail: 'cover.png',
      logos: { primary: 'logo.png' },
      promptPersona: '商务正式',
      starterSlidesPath: 'starter.md',
      layouts: [
        {
          name: 'cover',
          description: '封面',
          frontmatterSchema: {
            type: 'object',
            required: ['mainTitle'],
            properties: {
              mainTitle: { type: 'string', description: '主标题' },
            },
          },
        },
      ],
    }),
  )
  fs.writeFileSync(
    path.join(csDir, 'starter.md'),
    '---\nlayout: cover\nmainTitle: 请填写标题\n---\n',
  )
  fs.writeFileSync(path.join(csDir, 'cover.md'), '<cover>封面</cover>\n')
  fs.writeFileSync(path.join(csDir, 'README.md'), 'USAGE\n')
  fs.writeFileSync(path.join(csDir, 'cover.png'), 'PNG')

  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  process.env.BIG_PPT_TEMPLATES_DIR = csDir
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  delete process.env.BIG_PPT_TEMPLATES_DIR
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/list-templates', () => {
  it('返回 manifests 清单 + 向后兼容字段', async () => {
    const res = await buildApp().request('/api/list-templates')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.manifests).toHaveLength(1)
    expect(json.manifests[0].id).toBe('beitou-standard')
    expect(json.manifests[0].starterSlidesPath).toBe('starter.md')
    expect(json.manifests[0].layouts[0].name).toBe('cover')
    // 向后兼容：老字段仍在
    expect(json.templates).toEqual([
      { name: 'cover.md', path: 'beitou-standard/cover.md' },
    ])
    expect(json.usage_guide).toBe('USAGE\n')
    expect(json.available_images).toEqual([
      '/templates/beitou-standard/cover.png',
    ])
  })

  it('manifest.json / starter.md 不出现在 templates 列表里', async () => {
    const res = await buildApp().request('/api/list-templates')
    const json = await res.json()
    const names = (json.templates as Array<{ name: string }>).map((t) => t.name)
    expect(names).not.toContain('manifest.json')
    expect(names).not.toContain('starter.md')
  })
})

describe('GET /api/templates/:id/starter', () => {
  it('已存在模板返回 starter 内容', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/starter')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.templateId).toBe('beitou-standard')
    expect(json.content).toContain('mainTitle: 请填写标题')
  })

  it('未知 id 返回 404', async () => {
    const res = await buildApp().request('/api/templates/does-not-exist/starter')
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
  })
})

describe('GET /api/templates/:id/:filename（静态资源 — 缩略图 / logo）', () => {
  it('已存在的 png 文件返回 200 + image/png + 真实字节', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/cover.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toMatch(/max-age/)
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.toString('utf-8')).toBe('PNG') // fixture 内容
  })

  it('未知模板 id 返回 404', async () => {
    const res = await buildApp().request('/api/templates/no-such/thumbnail.png')
    expect(res.status).toBe(404)
  })

  it('已知模板但文件不存在返回 404', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/missing.png')
    expect(res.status).toBe(404)
  })

  it('非图片后缀返回 400（防止误读 manifest/starter）', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/manifest.json')
    expect(res.status).toBe(400)
  })

  it('filename 含 .. 返回 400（防 path traversal）', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/..%2Fother.png')
    expect(res.status).toBe(400)
  })

  it('filename 含路径分隔符返回 400', async () => {
    const res = await buildApp().request('/api/templates/beitou-standard/sub%2Fimg.png')
    expect(res.status).toBe(400)
  })

  it('jpg / svg / webp 后缀都支持，content-type 正确', async () => {
    fs.writeFileSync(path.join(csDir, 'a.jpg'), 'JPG-DATA')
    fs.writeFileSync(path.join(csDir, 'b.svg'), '<svg/>')
    fs.writeFileSync(path.join(csDir, 'c.webp'), 'WEBP')

    const jpg = await buildApp().request('/api/templates/beitou-standard/a.jpg')
    expect(jpg.status).toBe(200)
    expect(jpg.headers.get('content-type')).toBe('image/jpeg')

    const svg = await buildApp().request('/api/templates/beitou-standard/b.svg')
    expect(svg.status).toBe(200)
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')

    const webp = await buildApp().request('/api/templates/beitou-standard/c.webp')
    expect(webp.status).toBe(200)
    expect(webp.headers.get('content-type')).toBe('image/webp')
  })
})
