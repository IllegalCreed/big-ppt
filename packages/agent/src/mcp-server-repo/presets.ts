// packages/agent/src/mcp-server-repo/presets.ts
import type { McpServerConfig } from '@big-ppt/shared'

/**
 * 预置 MCP 目录(智谱 3 个 StreamableHTTP)。
 * 首次启动时 seed 进 user_mcp_servers,enabled=false;用户在 Settings 勾选启用 +
 * 填 API key 或勾"复用 LLM Key"。
 *
 * **headers 默认 sentinel(Phase 12.5 hotfix)**:智谱 MCP 端点(web_reader / web_search_prime
 * / zread)要求 `Authorization: Bearer <key>` header(curl 实测无此 header 返
 * `{"code":1001,"msg":"Header中未收到Authorization参数..."}` → MCP SDK zod 校验
 * union 全 fail,raw error 喷到 UI)。所以 preset 默认带 `$LLM_KEY` sentinel,
 * routes/mcp.ts:headersContainSentinel 据此推 reuseLlmKey=true,
 * mcp-registry/registry.ts:activate() connect 前替换 sentinel 为 user 活跃 provider 的真 apiKey。
 * 新用户首次 seed 即正确(仅需把智谱设为活跃 provider 并配 key)。
 *
 * 已核对(2026-04-28 https://docs.bigmodel.cn/cn/coding-plan/mcp/):
 * - zhipu-web-search / zhipu-web-reader / zhipu-zread: StreamableHTTP, URL 正确
 * - zhipu-vision: 智谱**只提供 npx(stdio)**,无 HTTP endpoint。当前架构
 *   (StreamableHTTPClientTransport) 不支持 stdio,故 vision **暂不在 preset**;
 *   等 Phase 11+ 加 stdio transport 后再放回。
 *   老用户 DB 里若残留 zhipu-vision 行,routes/mcp.ts 用 UNSUPPORTED_SERVER_IDS
 *   过滤,不返给前端,避免 enable 后报 JSON-RPC schema 错。
 */
export const PRESET_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'zhipu-web-search',
    displayName: '联网搜索(智谱)',
    description: '基于智谱 MCP 的联网搜索,返回网页标题 / 摘要 / URL。',
    url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
    headers: { Authorization: 'Bearer $LLM_KEY' },
    enabled: false,
    preset: true,
    badge: '搜索',
  },
  {
    id: 'zhipu-web-reader',
    displayName: '网页读取(智谱)',
    description: '抓取指定 URL 的网页正文,转为模型友好的 markdown。',
    url: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
    headers: { Authorization: 'Bearer $LLM_KEY' },
    enabled: false,
    preset: true,
    badge: '读网页',
  },
  {
    id: 'zhipu-zread',
    displayName: 'GitHub 仓库读取(智谱 Zread)',
    description: '读取 GitHub 仓库结构、文件、搜索文档。',
    url: 'https://open.bigmodel.cn/api/mcp/zread/mcp',
    headers: { Authorization: 'Bearer $LLM_KEY' },
    enabled: false,
    preset: true,
    badge: 'GitHub',
  },
]

/**
 * 当前架构(仅 StreamableHTTP)不支持的 server id 黑名单。
 * routes/mcp.ts 在 GET 时过滤这些 id(老用户 DB 残留),PATCH 时拒绝(防御性)。
 * 解封条件:Phase 11+ 加 stdio transport 后从这里删除并恢复 PRESET 项。
 */
export const UNSUPPORTED_SERVER_IDS = new Set<string>(['zhipu-vision'])
