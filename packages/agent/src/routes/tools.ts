import { Hono } from 'hono'
import { getTool, listTools } from '../tools/registry.js'
import { setTurnId } from '../context.js'
import { requireAuth, type AuthVars } from '../middleware/auth.js'
import { getRegistry } from '../mcp-registry/index.js'
import type { CallToolRequest, CallToolResponse, GetToolsResponse } from '@big-ppt/shared'

export const tools = new Hono<{ Variables: AuthVars }>()

// Phase 9-B（A01）：未登录禁止枚举工具列表 / 调用工具
// （/call-tool 未守卫将允许任意人调 write_slides / delete_slide / mcp__* 等敏感工具）
tools.use('/tools', requireAuth)
tools.use('/call-tool', requireAuth)

// Phase 9-F：listTools / getTool 按 ctx.user.id 路由——本地工具全用户可见，
// MCP 工具仅本人可见 / 调用（A01 修复）。
tools.get('/tools', async (c) => {
  const userId = c.get('user')!.id
  // 确保 MCP server 工具注册到 user 分区（首次访问时 connect + register）
  await getRegistry(userId).ensureInitialized()
  const payload: GetToolsResponse = { success: true, tools: listTools(userId) }
  return c.json(payload)
})

tools.post('/call-tool', async (c) => {
  let name: string | undefined
  let args: Record<string, unknown> = {}
  let turnId: string | undefined
  try {
    const body = await c.req.json<Partial<CallToolRequest>>()
    name = body.name
    args = body.args ?? {}
    turnId = typeof body.turnId === 'string' && body.turnId ? body.turnId : undefined
  } catch {
    const resp: CallToolResponse = { success: false, error: '请求体必须是合法 JSON' }
    return c.json(resp, 400)
  }
  if (!name || typeof name !== 'string') {
    const resp: CallToolResponse = { success: false, error: 'name 不能为空' }
    return c.json(resp, 400)
  }
  const userId = c.get('user')!.id
  const tool = getTool(name, userId)
  if (!tool) {
    const resp: CallToolResponse = { success: false, error: `未知工具: ${name}` }
    return c.json(resp, 404)
  }
  try {
    // 把 turnId 注入请求级 context，slides-store 的 appendHistory 与 persistVersion 都会读到
    if (turnId) setTurnId(turnId)
    const result = await tool.exec(args)
    const resp: CallToolResponse = { success: true, result }
    return c.json(resp)
  } catch (err) {
    const resp: CallToolResponse = { success: false, error: (err as Error).message }
    return c.json(resp, 500)
  }
})
