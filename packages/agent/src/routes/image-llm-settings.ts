/**
 * Phase 11.5：生图模型配置 REST 路由。
 *
 * GET  /api/image-llm-settings → { provider, baseUrl, model, hasApiKey }（不返 apiKey 明文）
 * PUT  /api/image-llm-settings → 加密写入 users.image_llm_settings
 *
 * v1 仅支持 provider='openai';PUT 严格校验白名单,后续加 provider 改 enum 即可。
 */
import { Hono } from 'hono'
import type { ImageLlmSettings } from '@big-ppt/shared'
import { type AuthVars } from '../middleware/auth.js'
import {
  getImageLlmSettings,
  setImageLlmSettings,
} from '../db/image-llm-settings.js'
import { errorResponse } from '../utils/error-response.js'

type ImageLlmProvider = ImageLlmSettings['provider']
const SUPPORTED_PROVIDERS: readonly ImageLlmProvider[] = ['openai'] as const

type ImageLlmBody = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
}

export const imageLlmSettingsRoute = new Hono<{ Variables: AuthVars }>()

imageLlmSettingsRoute.get('/image-llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  try {
    const settings = await getImageLlmSettings(user.id)
    if (!settings) {
      return c.json({ provider: null, baseUrl: null, model: null, hasApiKey: false })
    }
    return c.json({
      provider: settings.provider,
      baseUrl: settings.baseUrl ?? null,
      model: settings.model ?? null,
      hasApiKey: !!settings.apiKey,
    })
  } catch (err) {
    return errorResponse(c, err, { publicMessage: '生图模型配置读取失败' })
  }
})

imageLlmSettingsRoute.put('/image-llm-settings', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json<ImageLlmBody>().catch((): ImageLlmBody => ({}))

  const rawProvider = body.provider?.trim() || 'openai'
  if (!SUPPORTED_PROVIDERS.includes(rawProvider as ImageLlmProvider)) {
    return c.json({ error: `不支持的 provider: ${rawProvider}` }, 400)
  }
  const provider = rawProvider as ImageLlmProvider

  // 若未给 apiKey:要求已存在旧值,保留旧 apiKey 只更新其他字段(同 llm-settings 行为)
  let apiKey = body.apiKey?.trim() ?? ''
  if (!apiKey) {
    try {
      const prev = await getImageLlmSettings(user.id)
      apiKey = prev?.apiKey ?? ''
    } catch (err) {
      return errorResponse(c, err, { publicMessage: '旧生图模型配置读取失败' })
    }
    if (!apiKey) return c.json({ error: 'apiKey 为空' }, 400)
  }

  const baseUrl = body.baseUrl?.trim() || undefined
  const model = body.model?.trim() || undefined

  try {
    const settings: ImageLlmSettings = { provider, apiKey, baseUrl, model }
    await setImageLlmSettings(user.id, settings)
    return c.json({ ok: true })
  } catch (err) {
    return errorResponse(c, err, { publicMessage: '生图模型配置保存失败' })
  }
})
