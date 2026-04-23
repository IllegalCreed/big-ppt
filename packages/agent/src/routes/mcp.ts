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
import { requireAuth, type AuthVars } from '../middleware/auth.js'

export const mcp = new Hono<{ Variables: AuthVars }>()

// 所有 /mcp/servers* 必须登录。未登录 → 401（避免外网访问泄漏 Authorization headers）
mcp.use('/mcp/servers', requireAuth)
mcp.use('/mcp/servers/*', requireAuth)

/**
 * 脱敏规则：返回给前端时 headers 的 key 保留（UI 需要显示 Authorization / X-Api-Key 的名字），
 * value 一律改成 REDACTED_VALUE。前端若要保留旧值就在 PATCH 时原样发 `***`，
 * 后端识别为"保留"并从 repo 读回 plaintext。
 */
const REDACTED_VALUE = '***'

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = v === '' ? '' : REDACTED_VALUE
  }
  return out
}

/**
 * 合并用户提交的 patch.headers 和已存的明文 headers：
 * - value === REDACTED_VALUE  → 保留旧值
 * - value 是其他字符串         → 视为新值（含空串 = 清空）
 * - key 在 patch 里但旧 headers 没有 → 当新 key 写入（不可能是保留，因为无旧可保）
 * - key 在旧 headers 有但 patch 里没有 → 被删（整体替换语义，和原 repo 行为一致）
 */
function mergeHeadersPatch(
  incoming: Record<string, string>,
  existing: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === REDACTED_VALUE && k in existing) {
      merged[k] = existing[k]! // 保留旧值
    } else {
      merged[k] = v
    }
  }
  return merged
}

mcp.get('/mcp/servers', async (c) => {
  try {
    const repo = getRepo()
    const registry = getRegistry()
    const configs = await repo.list()
    const servers = configs.map((cfg) => ({
      ...cfg,
      headers: redactHeaders(cfg.headers ?? {}),
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
    // 新建时 *** 无对应旧值可保留；直接视为空串
    const sanitized: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.headers ?? {})) {
      sanitized[k] = v === REDACTED_VALUE ? '' : v
    }
    const config: McpServerConfig = {
      id: body.id,
      displayName: body.displayName,
      description: body.description ?? '',
      url: body.url,
      headers: sanitized,
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
    // 如果 patch.headers 里有 ***，去 repo 拿已存的明文做合并
    let resolvedPatch = patch
    if (patch.headers) {
      const existing = await repo.get(id)
      if (!existing) {
        const resp: MutateMcpServerResponse = { success: false, error: 'not found' }
        return c.json(resp, 404)
      }
      resolvedPatch = {
        ...patch,
        headers: mergeHeadersPatch(patch.headers, existing.headers ?? {}),
      }
    }
    const updated = await repo.update(id, resolvedPatch)
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
