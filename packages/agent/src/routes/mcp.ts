// packages/agent/src/routes/mcp.ts
import { Hono } from 'hono'
import type {
  CreateMcpServerRequest,
  GetMcpServersResponse,
  McpServerConfig,
  MutateMcpServerResponse,
  UpdateMcpServerRequest,
} from '@big-ppt/shared'
import { getRepo, McpRepoNotFoundError } from '../mcp-server-repo/index.js'
import { getRegistry } from '../mcp-registry/index.js'

export const mcp = new Hono()

mcp.get('/mcp/servers', async (c) => {
  try {
    const repo = getRepo()
    const registry = getRegistry()
    const configs = await repo.list()
    const servers = configs.map((cfg) => ({
      ...cfg,
      status: registry.getStatus(cfg.id),
    }))
    const payload: GetMcpServersResponse = { success: true, servers }
    return c.json(payload)
  } catch (err) {
    const resp: GetMcpServersResponse = { success: false, error: (err as Error).message }
    return c.json(resp, 500)
  }
})

mcp.post('/mcp/servers', async (c) => {
  let body: CreateMcpServerRequest
  try {
    body = await c.req.json<CreateMcpServerRequest>()
  } catch {
    const resp: MutateMcpServerResponse = { success: false, error: '请求体必须是合法 JSON' }
    return c.json(resp, 400)
  }
  try {
    if (!body.id || !body.displayName || !body.url) {
      const resp: MutateMcpServerResponse = { success: false, error: 'id / displayName / url 必填' }
      return c.json(resp, 400)
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(body.id)) {
      const resp: MutateMcpServerResponse = { success: false, error: 'id 只能包含字母、数字、- 和 _' }
      return c.json(resp, 400)
    }
    const repo = getRepo()
    const existing = await repo.get(body.id)
    if (existing) {
      const resp: MutateMcpServerResponse = { success: false, error: `server id 已存在: ${body.id}` }
      return c.json(resp, 409)
    }
    const config: McpServerConfig = {
      id: body.id,
      displayName: body.displayName,
      description: body.description ?? '',
      url: body.url,
      headers: body.headers ?? {},
      enabled: false,
      preset: false,
      badge: body.badge,
    }
    await repo.create(config)
    const resp: MutateMcpServerResponse = { success: true }
    return c.json(resp)
  } catch (err) {
    const resp: MutateMcpServerResponse = { success: false, error: (err as Error).message }
    return c.json(resp, 500)
  }
})

mcp.patch('/mcp/servers/:id', async (c) => {
  const id = c.req.param('id')
  let patch: UpdateMcpServerRequest
  try {
    patch = await c.req.json<UpdateMcpServerRequest>()
  } catch {
    const resp: MutateMcpServerResponse = { success: false, error: '请求体必须是合法 JSON' }
    return c.json(resp, 400)
  }
  try {
    const repo = getRepo()
    const registry = getRegistry()
    const updated = await repo.update(id, patch)
    await registry.sync(updated)
    const resp: MutateMcpServerResponse = { success: true }
    return c.json(resp)
  } catch (err) {
    if (err instanceof McpRepoNotFoundError) {
      const resp: MutateMcpServerResponse = { success: false, error: err.message }
      return c.json(resp, 404)
    }
    const resp: MutateMcpServerResponse = { success: false, error: (err as Error).message }
    return c.json(resp, 500)
  }
})

mcp.delete('/mcp/servers/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const repo = getRepo()
    const registry = getRegistry()
    const existing = await repo.get(id)
    if (!existing) {
      const resp: MutateMcpServerResponse = { success: false, error: 'not found' }
      return c.json(resp, 404)
    }
    if (existing.preset) {
      const resp: MutateMcpServerResponse = { success: false, error: '预置 MCP 不可删除,可禁用' }
      return c.json(resp, 403)
    }
    await registry.sync({ ...existing, enabled: false })
    await repo.delete(id)
    const resp: MutateMcpServerResponse = { success: true }
    return c.json(resp)
  } catch (err) {
    const resp: MutateMcpServerResponse = { success: false, error: (err as Error).message }
    return c.json(resp, 500)
  }
})
