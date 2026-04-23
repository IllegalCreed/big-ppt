import { Hono } from 'hono'
import { getTool, listTools } from '../tools/registry.js'
import { setTurnId } from '../context.js'
import type { CallToolRequest, CallToolResponse, GetToolsResponse } from '@big-ppt/shared'

export const tools = new Hono()

tools.get('/tools', (c) => {
  const payload: GetToolsResponse = { success: true, tools: listTools() }
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
  const tool = getTool(name)
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
