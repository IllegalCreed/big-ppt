import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetImageStyleRegistryForTesting } from '../src/image-styles/registry.js'
import { imageStylePresetsRoute } from '../src/routes/image-style-presets.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { PNG_1X1, writeImageStyleFixture } from './_fixtures/image-style.js'

function buildApp() {
  const app = new Hono()
  app.route('/api', imageStylePresetsRoute)
  return app
}

let tmpRoot: string
let imageStylesRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumideck-image-style-routes-'))
  imageStylesRoot = path.join(tmpRoot, 'image-styles')
  fs.mkdirSync(imageStylesRoot, { recursive: true })
  process.env.BIG_PPT_IMAGE_STYLES_ROOT = imageStylesRoot
  __resetPathsForTesting()
  __resetImageStyleRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_IMAGE_STYLES_ROOT
  __resetPathsForTesting()
  __resetImageStyleRegistryForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('public image style preset routes', () => {
  it('list 返回排序后的安全 DTO，不泄露 prompt、文件名或绝对路径', async () => {
    writeImageStyleFixture(imageStylesRoot, 'later-style', { manifest: { order: 20 } })
    writeImageStyleFixture(imageStylesRoot, 'first-style', { manifest: { order: 1 } })
    const response = await buildApp().request('/api/image-style-presets')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('max-age=300')
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.presets.map((preset: { id: string }) => preset.id)).toEqual([
      'first-style',
      'later-style',
    ])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('private prompt')
    expect(serialized).not.toContain('reference.png')
    expect(serialized).not.toContain(imageStylesRoot)
  })

  it('preview 与 reference 只按 preset id/index 返回已验证图片', async () => {
    writeImageStyleFixture(imageStylesRoot, 'flat-style')

    const preview = await buildApp().request('/api/image-style-presets/flat-style/preview')
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/png')
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(PNG_1X1)

    const reference = await buildApp().request('/api/image-style-presets/flat-style/references/0')
    expect(reference.status).toBe(200)
    expect(Buffer.from(await reference.arrayBuffer())).toEqual(PNG_1X1)
  })

  it('未知 preset/reference 返回 404，非法 index 返回 400', async () => {
    writeImageStyleFixture(imageStylesRoot, 'flat-style')
    expect((await buildApp().request('/api/image-style-presets/unknown/preview')).status).toBe(404)
    expect((await buildApp().request('/api/image-style-presets/unknown/references/0')).status).toBe(
      404,
    )
    expect(
      (await buildApp().request('/api/image-style-presets/flat-style/references/2')).status,
    ).toBe(404)
    expect(
      (await buildApp().request('/api/image-style-presets/flat-style/references/-1')).status,
    ).toBe(400)
  })

  it('资源损坏时 500 响应不泄露服务端绝对路径', async () => {
    const response = await buildApp().request('/api/image-style-presets')
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ success: false, error: '系统配图风格资源不可用' })
    expect(JSON.stringify(body)).not.toContain(imageStylesRoot)
  })
})
