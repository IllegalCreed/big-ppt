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
