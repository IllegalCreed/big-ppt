import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { tools as toolsRoute } from '../src/routes/tools.js'
import { __resetRegistry, register } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'

function buildApp() {
  const app = new Hono()
  app.route('/api', toolsRoute)
  return app
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(path.join(slidevDir, 'templates/company-standard'), { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# t\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_HISTORY_DIR = path.join(tmpRoot, 'slides-history')
  __resetPathsForTesting()
  __resetRegistry()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_HISTORY_DIR
  __resetPathsForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/tools', () => {
  it('空 registry 返回空数组', async () => {
    const res = await buildApp().request('/api/tools')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, tools: [] })
  })

  it('注册本地工具后返回 10 项（含四件套 + switch_template）', async () => {
    registerLocalTools()
    const res = await buildApp().request('/api/tools')
    const json = await res.json()
    expect(json.tools).toHaveLength(10)
    expect(json.tools.map((t: any) => t.function.name).sort()).toEqual([
      'create_slide',
      'delete_slide',
      'edit_slides',
      'list_templates',
      'read_slides',
      'read_template',
      'reorder_slides',
      'switch_template',
      'update_slide',
      'write_slides',
    ])
  })
})

describe('POST /api/call-tool', () => {
  it('未知工具返回 404', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nope', args: {} }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('缺 name 返回 400', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('调用本地 read_slides 返回 result 字符串', async () => {
    registerLocalTools()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, result: '# t\n' })
  })

  it('工具 exec 抛错时返回 success=false', async () => {
    register({
      name: 'boom',
      description: '',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        throw new Error('oops')
      },
    })
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'boom', args: {} }),
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('oops')
  })
})
