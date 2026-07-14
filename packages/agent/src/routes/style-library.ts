/** Phase 17: image style library HTTP endpoints. Mounted by app.ts at `/api`. */
import { Hono, type Context } from 'hono'
import type {
  ApplyImageStyleRequest,
  ExploreImageStylesResponse,
  SaveImageStylePresetRequest,
} from '@big-ppt/shared'
import type { AuthVars } from '../middleware/auth.js'
import {
  applyImageStyle,
  getImageStyleLibrary,
  saveImageStylePreset,
  selectFreeImageStyle,
  StyleLibraryError,
} from '../style-library/service.js'
import {
  startStyleExploreJob,
  StyleExploreDeckError,
  StyleExploreLimitError,
  StyleExploreRunningError,
} from '../style-library/job.js'
import {
  deleteUserStylePreset,
  getUserStylePreset,
  renameUserStylePreset,
  UserStylePresetQuotaError,
  UserStylePresetSourceError,
} from '../db/user-style-presets.js'
import { logServerEvent } from '../logger/server-log.js'

export const styleLibraryRoute = new Hono<{ Variables: AuthVars }>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SYSTEM_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function styleError(c: Context, err: unknown) {
  if (err instanceof StyleLibraryError) {
    return c.json({ error: err.message, code: err.code }, err.status)
  }
  if (err instanceof UserStylePresetQuotaError) {
    const status =
      err.code === 'preset-too-large' || err.code === 'preset-storage-exceeded' ? 413 : 409
    return c.json({ error: err.message, code: err.code }, status)
  }
  if (err instanceof UserStylePresetSourceError) {
    const status = err.code === 'deck-not-found' ? 404 : 400
    return c.json({ error: err.message, code: err.code }, status)
  }
  console.error('[style-library] route failed:', err)
  return c.json({ error: '风格库操作失败，请稍后重试' }, 500)
}

styleLibraryRoute.get('/decks/:id{[0-9]+}/style-library', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  try {
    return c.json(await getImageStyleLibrary(user.id, Number(c.req.param('id'))))
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.post('/decks/:id{[0-9]+}/style-library/apply', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const body: Partial<ApplyImageStyleRequest> = await c.req
    .json<Partial<ApplyImageStyleRequest>>()
    .catch((): Partial<ApplyImageStyleRequest> => ({}))
  if (body.source !== 'system' && body.source !== 'user' && body.source !== 'explore') {
    return c.json({ error: 'source 必须是 system | user | explore' }, 400)
  }
  const id = body.id?.trim()
  if (!id) return c.json({ error: 'id 必填' }, 400)
  if (body.source === 'system' ? !SYSTEM_ID_RE.test(id) : !UUID_RE.test(id)) {
    return c.json({ error: '风格 id 格式不合法' }, 400)
  }
  try {
    return c.json(
      await applyImageStyle(user.id, Number(c.req.param('id')), {
        source: body.source,
        id,
      }),
    )
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.post('/decks/:id{[0-9]+}/style-library/save', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const body: Partial<SaveImageStylePresetRequest> = await c.req
    .json<Partial<SaveImageStylePresetRequest>>()
    .catch((): Partial<SaveImageStylePresetRequest> => ({}))
  const assetId = body.assetId?.trim()
  if (!assetId || !UUID_RE.test(assetId)) {
    return c.json({ error: 'assetId 必填且必须是 uuid' }, 400)
  }
  if (body.name !== undefined && (!body.name.trim() || body.name.trim().length > 80)) {
    return c.json({ error: 'name 必须是 1-80 个字符' }, 400)
  }
  try {
    const result = await saveImageStylePreset({
      userId: user.id,
      deckId: Number(c.req.param('id')),
      assetId,
      name: body.name?.trim(),
    })
    return c.json(result, 201)
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.post('/decks/:id{[0-9]+}/style-library/free', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  try {
    await selectFreeImageStyle(user.id, Number(c.req.param('id')))
    return c.json({ active: { mode: 'free' as const } })
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.post('/decks/:id{[0-9]+}/style-library/explore', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  try {
    const result: ExploreImageStylesResponse = await startStyleExploreJob(user.id, deckId)
    return c.json(result, 202)
  } catch (err) {
    if (err instanceof StyleExploreRunningError) {
      return c.json({ error: err.message, code: 'explore-running' }, 409)
    }
    if (err instanceof StyleExploreLimitError) {
      return c.json({ error: err.message, code: 'explore-limit' }, 429)
    }
    if (err instanceof StyleExploreDeckError) {
      const status = /内容为空/.test(err.message) ? 400 : 404
      return c.json({ error: err.message, code: 'deck-not-ready' }, status)
    }
    return styleError(c, err)
  }
})

styleLibraryRoute.patch('/style-presets/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'preset id 格式不合法' }, 400)
  const body: { name?: string } = await c.req
    .json<{ name?: string }>()
    .catch((): { name?: string } => ({}))
  const name = body.name?.trim()
  if (!name || name.length > 80) return c.json({ error: 'name 必须是 1-80 个字符' }, 400)
  try {
    if (!(await renameUserStylePreset(user.id, id, name))) {
      return c.json({ error: 'preset 不存在' }, 404)
    }
    logServerEvent({
      category: 'style-library',
      event: 'preset-renamed',
      userId: user.id,
      presetId: id,
    })
    return c.json({ ok: true })
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.delete('/style-presets/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'preset id 格式不合法' }, 400)
  try {
    if (!(await deleteUserStylePreset(user.id, id))) {
      return c.json({ error: 'preset 不存在' }, 404)
    }
    logServerEvent({
      category: 'style-library',
      event: 'preset-deleted',
      userId: user.id,
      presetId: id,
    })
    return c.json({ ok: true })
  } catch (err) {
    return styleError(c, err)
  }
})

styleLibraryRoute.get('/style-presets/:id/image', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'not found' }, 404)
  const preset = await getUserStylePreset(user.id, id)
  if (!preset) return c.json({ error: 'not found' }, 404)
  const bytes = new Uint8Array(preset.data.byteLength)
  bytes.set(preset.data)
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': preset.mimeType,
      'Content-Length': String(preset.bytesSize),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
