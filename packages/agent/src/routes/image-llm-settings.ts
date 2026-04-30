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

  // **关键**:apiKey / baseUrl / model 全部对称 —— 字段在 body 中"未提供"
  //(undefined / 不存在)= 保留旧值;字段提供且非空 = 写入新值;
  // **空字符串显式表示清空**(用户主动想去掉 baseUrl / model)。
  // apiKey 例外:空字符串仍保留旧值(防误清,加密 key 没法回看修正)。
  let prev: ImageLlmSettings | null = null
  try {
    prev = await getImageLlmSettings(user.id)
  } catch (err) {
    return errorResponse(c, err, { publicMessage: '旧生图模型配置读取失败' })
  }

  // apiKey:空 / 未传 → 保留旧值;非空 → 覆盖
  const apiKey = body.apiKey?.trim() || prev?.apiKey || ''
  if (!apiKey) return c.json({ error: 'apiKey 为空' }, 400)

  // baseUrl:body 字段未提供(undefined)→ 保留旧值;提供(包括空串)→ 用户意图清空或更新
  const baseUrl =
    body.baseUrl === undefined ? prev?.baseUrl : body.baseUrl.trim() || undefined
  const model =
    body.model === undefined ? prev?.model : body.model.trim() || undefined

  try {
    const settings: ImageLlmSettings = { provider, apiKey, baseUrl, model }
    await setImageLlmSettings(user.id, settings)
    return c.json({ ok: true })
  } catch (err) {
    return errorResponse(c, err, { publicMessage: '生图模型配置保存失败' })
  }
})
