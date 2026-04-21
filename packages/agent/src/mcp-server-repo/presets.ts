// packages/agent/src/mcp-server-repo/presets.ts
import type { McpServerConfig } from '@big-ppt/shared'

/**
 * 预置 MCP 目录(智谱 4 个)。
 * 首次启动时 seed 进 data/mcp.json,enabled=false;用户在 Settings 勾选启用 + 填 API key。
 *
 * TODO(executor): 启动 Task 5 前打开 https://docs.bigmodel.cn/cn/coding-plan/mcp/ 核对 4 个 URL,
 *   尤其是 vision 与 zread 的路径(04 原计划的值是推测)。
 */
export const PRESET_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'zhipu-web-search',
    displayName: '联网搜索(智谱)',
    description: '基于智谱 MCP 的联网搜索,返回网页标题 / 摘要 / URL。',
    url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
    headers: {},
    enabled: false,
    preset: true,
    badge: '搜索',
  },
  {
    id: 'zhipu-web-reader',
    displayName: '网页读取(智谱)',
    description: '抓取指定 URL 的网页正文,转为模型友好的 markdown。',
    url: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
    headers: {},
    enabled: false,
    preset: true,
    badge: '读网页',
  },
  {
    id: 'zhipu-vision',
    displayName: '视觉理解(智谱)',
    description: '对图片内容进行分析和理解。',
    url: 'https://open.bigmodel.cn/api/mcp/vision/mcp',
    headers: {},
    enabled: false,
    preset: true,
    badge: '视觉',
  },
  {
    id: 'zhipu-zread',
    displayName: 'GitHub 仓库读取(智谱 Zread)',
    description: '读取 GitHub 仓库结构、文件、搜索文档。',
    url: 'https://open.bigmodel.cn/api/mcp/zread/mcp',
    headers: {},
    enabled: false,
    preset: true,
    badge: 'GitHub',
  },
]
