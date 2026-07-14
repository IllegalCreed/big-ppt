import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { __resetImageStyleRegistryForTesting } from '../src/image-styles/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { writeImageStyleFixture } from './_fixtures/image-style.js'

let tmpRoot: string
let imageStylesRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumideck-image-style-mount-'))
  imageStylesRoot = path.join(tmpRoot, 'image-styles')
  fs.mkdirSync(imageStylesRoot, { recursive: true })
  writeImageStyleFixture(imageStylesRoot, 'mounted-style')
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

describe('full app mount: public image style presets', () => {
  it('未登录 app.fetch 可读 list 与 preview，不受其他 sub-router auth middleware 影响', async () => {
    const list = await app.fetch(new Request('http://test/api/image-style-presets'))
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      success: true,
      presets: [{ id: 'mounted-style' }],
    })

    const preview = await app.fetch(
      new Request('http://test/api/image-style-presets/mounted-style/preview'),
    )
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/png')
  })
})
