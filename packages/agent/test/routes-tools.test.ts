import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { tools as toolsRoute } from '../src/routes/tools.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { __resetRegistry, register } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'

useTestDb()

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', toolsRoute)
  return app
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(path.join(slidevDir, 'templates/beitou-standard'), { recursive: true })
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
  it('未登录 → 401（Phase 9-B 防工具枚举）', async () => {
    const res = await buildApp().request('/api/tools')
    expect(res.status).toBe(401)
  })

  it('登录后空 registry 返回空数组', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/tools', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, tools: [] })
  })

  it('登录后注册本地工具后返回 11 项（含四件套 + switch_template + generate_slide_image）', async () => {
    registerLocalTools()
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/tools', { headers: { Cookie: cookie } })
    const json = await res.json()
    expect(json.tools).toHaveLength(10)
    expect(json.tools.map((t: any) => t.function.name).sort()).toEqual([
      'create_slide',
      'delete_slide',
      'edit_slides',
      'generate_slide_image',
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
  it('未登录 → 401（Phase 9-B 防未授权工具调用）', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(401)
  })

  it('登录后未知工具返回 404', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'nope', args: {} }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('登录后缺 name 返回 400', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ args: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('登录后调用本地 read_slides 返回 result 字符串', async () => {
    registerLocalTools()
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, result: '# t\n' })
  })

  it('登录后工具 exec 抛错时返回 success=false', async () => {
    register({
      name: 'boom',
      description: '',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        throw new Error('oops')
      },
    })
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'boom', args: {} }),
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('oops')
  })
})
