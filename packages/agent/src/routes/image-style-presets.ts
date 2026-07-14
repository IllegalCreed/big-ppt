import { Hono } from 'hono'
import {
  getImageStyle,
  listImageStylePresetSummaries,
  readImageStylePreview,
  readImageStyleReference,
  type ReadImageStyleAsset,
} from '../image-styles/registry.js'

export const imageStylePresetsRoute = new Hono()

function publicAssetHeaders(asset: ReadImageStyleAsset): Record<string, string> {
  return {
    'Content-Type': asset.mimeType,
    'Content-Length': String(asset.data.byteLength),
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }
}

/** Hono's body type requires an ArrayBuffer-backed view; Buffer may be SharedArrayBuffer-backed. */
function publicAssetBody(asset: ReadImageStyleAsset): Uint8Array<ArrayBuffer> {
  return new Uint8Array(asset.data)
}

imageStylePresetsRoute.get('/image-style-presets', (c) => {
  try {
    return c.json({ success: true as const, presets: listImageStylePresetSummaries() }, 200, {
      'Cache-Control': 'public, max-age=300',
    })
  } catch (error) {
    // The detailed path-bearing error is useful on the server but must not leak in the DTO.
    console.error('[image-styles] public list failed:', error)
    return c.json({ success: false as const, error: '系统配图风格资源不可用' }, 500)
  }
})

imageStylePresetsRoute.get('/image-style-presets/:presetId/preview', (c) => {
  try {
    const presetId = c.req.param('presetId')
    const asset = readImageStylePreview(presetId)
    if (!asset) {
      return c.json({ success: false as const, error: '系统配图风格不存在' }, 404)
    }
    return c.body(publicAssetBody(asset), 200, publicAssetHeaders(asset))
  } catch (error) {
    console.error('[image-styles] public preview failed:', error)
    return c.json({ success: false as const, error: '系统配图风格资源不可用' }, 500)
  }
})

imageStylePresetsRoute.get('/image-style-presets/:presetId/references/:index', (c) => {
  const rawIndex = c.req.param('index')
  if (!/^(?:0|[1-9]\d*)$/.test(rawIndex)) {
    return c.json({ success: false as const, error: 'reference index 必须是非负整数' }, 400)
  }

  try {
    const presetId = c.req.param('presetId')
    if (!getImageStyle(presetId)) {
      return c.json({ success: false as const, error: '系统配图风格不存在' }, 404)
    }
    const asset = readImageStyleReference(presetId, Number(rawIndex))
    if (!asset) {
      return c.json({ success: false as const, error: '系统配图风格 reference 不存在' }, 404)
    }
    return c.body(publicAssetBody(asset), 200, publicAssetHeaders(asset))
  } catch (error) {
    console.error('[image-styles] public reference failed:', error)
    return c.json({ success: false as const, error: '系统配图风格资源不可用' }, 500)
  }
})
