import { Hono } from 'hono'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt.js'
import { getManifest } from '../templates/registry.js'
import { authOptional, type AuthVars } from '../middleware/auth.js'
import { getImageLlmSettings } from '../db/image-llm-settings.js'

export const promptsRoute = new Hono<{ Variables: AuthVars }>()

/**
 * 返回当前模板对应的 system prompt 字符串。
 * Phase 6C：creator 启动时拉一次，作为 messages[0] 的 content。
 * Phase 11.6：登录用户配置了 image LLM 时,prompt 切到「图片优先」决策树。
 *
 * Query：
 *   - templateId（必填，缺省时返回 400）
 *   - mcpBadges（可选，CSV，如 "搜索,读网页"）
 *
 * authOptional：未登录也能拿 prompt（OFF 分支兼容老调用方），登录则按 imageLlmSettings 决定 ON/OFF。
 */
promptsRoute.use('/system-prompt', authOptional)
promptsRoute.get('/system-prompt', async (c) => {
  const templateId = c.req.query('templateId')?.trim()
  if (!templateId) {
    return c.json({ success: false, error: 'templateId 必填' }, 400)
  }
  if (!getManifest(templateId)) {
    return c.json({ success: false, error: `未知模板 ${templateId}` }, 404)
  }

  const badgesRaw = c.req.query('mcpBadges')?.trim()
  const mcpBadges = badgesRaw
    ? badgesRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const user = c.get('user')
  const imageGenEnabled = user ? !!(await getImageLlmSettings(user.id)) : false

  const prompt = buildSystemPrompt({ templateId, mcpBadges, imageGenEnabled })
  return c.json({ success: true, templateId, prompt, imageGenEnabled })
})
