import { Hono } from 'hono'
import { buildSystemPrompt } from '../prompts/buildSystemPrompt.js'
import { getManifest } from '../templates/registry.js'

export const promptsRoute = new Hono()

/**
 * 返回当前模板对应的 system prompt 字符串。
 * Phase 6C：creator 启动时拉一次，作为 messages[0] 的 content。
 *
 * Query：
 *   - templateId（必填，缺省时返回 400）
 *   - mcpBadges（可选，CSV，如 "搜索,读网页"）
 *
 * 不需要登录：prompt 内容本身不含敏感信息，纯结构 + 字段说明。
 */
promptsRoute.get('/system-prompt', (c) => {
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

  const prompt = buildSystemPrompt({ templateId, mcpBadges })
  return c.json({ success: true, templateId, prompt })
})
