# Phase 2.2：通用 MCP 集成

> ⚠️ **已废弃（2026-04-21）**：本计划的实施基于"Vite middleware = 事实上的后端"前提。Phase 2 关闭时已决定把后端剥离成独立 `packages/agent`，MCP client 应跑在 agent 里。本文档保留作历史参考；实际实施延至 Phase 3 monorepo 完成后，见 `07-mcp-integration.md`（Phase 3 关闭后创建）。
>
> **REQUIRED SUB-SKILL:** `superpowers:executing-plans` — inline 顺序执行。

---

## Context

**现状与诉求：**
当前 agent（[creator/src/prompts/tools.ts](creator/src/prompts/tools.ts)）只有 5 个本地文件工具，完全无联网能力。用户有智谱的 4 个 MCP server（search / reader / vision / zread）可用，希望"让用户自己配置自己的 MCP"——即做通用 MCP 客户端，而不是硬编码智谱。

**路线图约束（[docs/requirements/roadmap.md](docs/requirements/roadmap.md) Phase 3）：**
规划了 monorepo 拆分，会新增 `packages/agent` Node.js 后端承担"Agent 主循环 + 工具执行 + LLM 调用"。**本轮 Phase 2.2 的 Vite middleware 就是未来 agent 后端的雏形**——MCP 客户端放在 middleware 里跑（Node.js 环境），Phase 3 直接搬进 `packages/agent`，无返工。

**用户决策（本轮已确认）：**

- 范围：做通用 MCP 客户端 + 配置 UI + 动态工具合并（方案 A）
- UX：**预置目录 + 一键启用**为主流程（用户勾选预置 MCP + 填 API Key 即可），"自定义 MCP"作为折叠的进阶选项（高级用户填 URL + 任意 headers）
- 认证：智谱 4 个 MCP 可共享 LLM 的智谱 API Key（UI 提供"复用"选项）；其他预置/自定义 server 各自管理 token

**目标产物：**

1. Vite middleware 里跑 MCP HTTP client，前端通过 `/api/mcp/*` 调
2. SettingsModal 拆 tabs，新增"MCP Servers"管理界面
3. LLM 工具列表 = 本地 5 个 + 所有启用 MCP server 的工具，统一调用入口
4. ChatPanel 现有 ThoughtChain 可视化天然生效

---

## 架构

```
┌──────────────────────┐                    ┌───────────────────────┐
│ creator (browser)    │                    │ Vite middleware (Node)│
│                      │                    │  = Phase 3 agent 雏形 │
│ ┌──────────────────┐ │   GET /api/mcp/    │  ┌────────────────┐   │
│ │ useMCP           │─┼──── servers ──────▶│  │ mcp-registry   │   │
│ │  (stores config) │ │                    │  │  (in-memory    │   │
│ │                  │ │   POST /api/mcp/   │  │   clients/     │   │
│ │                  │─┼─── :server/        │  │   session ids) │   │
│ └──────────────────┘ │     list-tools     │  └────────┬───────┘   │
│                      │                    │           │           │
│ ┌──────────────────┐ │   POST /api/mcp/   │           ▼           │
│ │ useAIChat        │─┼─── :server/        │  ┌────────────────┐   │
│ │  executeTool     │ │     call-tool      │  │ @modelcontext- │   │
│ └──────────────────┘ │                    │  │ protocol/sdk   │   │
│                      │                    │  │ StreamableHTTP │   │
└──────────────────────┘                    │  │   Transport    │   │
                                            │  └────────┬───────┘   │
                                            └───────────┼───────────┘
                                                        ▼
                                          https://open.bigmodel.cn/api/mcp/
                                          (或用户自配的任意 MCP server)
```

**关键设计：**

- MCP 客户端**只在 Vite middleware 跑**，解决 CORS + 复用官方 SDK（SDK 不支持浏览器）
- 前端只持有配置（URL / headers）+ 工具目录缓存，**不直接说 MCP 协议**
- MCP 会话(session) 的生命周期由 middleware 维护，前端无感
- 工具命名：`mcp__<serverName>__<toolName>`（借鉴 Claude Code 风格；SDK/LLM 侧都是合法 identifier）

---

## File Structure

| 操作   | 文件                                                                                                                             | 责任                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Create | [creator/src/composables/useMCP.ts](creator/src/composables/useMCP.ts)                                                           | MCP servers 配置的响应式 store（localStorage 持久化），封装 `listTools()` / `callTool()` 对 `/api/mcp/*` 的调用 |
| Create | [creator/src/prompts/mcpCatalog.ts](creator/src/prompts/mcpCatalog.ts)                                                           | 预置 MCP 目录（内置智谱 4 个 MCP 定义；后续可扩展）                                                             |
| Create | [creator/src/components/MCPCatalogItem.vue](creator/src/components/MCPCatalogItem.vue)                                           | 预置项的展示卡片（名称/说明/开关/apiKey 输入/复用 LLM key 勾选）                                                |
| Create | [creator/src/components/MCPCustomServer.vue](creator/src/components/MCPCustomServer.vue)                                         | 自定义 MCP 的进阶表单（URL / 自定义 headers），默认折叠                                                         |
| Modify | [creator/src/components/SettingsModal.vue](creator/src/components/SettingsModal.vue)                                             | 改成 tabs（LLM / MCP Servers），MCP tab 内：预置目录卡片列表 + "添加自定义 MCP"折叠区                           |
| Modify | [vite.config.creator.ts](vite.config.creator.ts)                                                                                 | 新增 `mcpProxyPlugin()`：维护 MCP clients registry + 3 个路由                                                   |
| Modify | [creator/src/composables/useAIChat.ts](creator/src/composables/useAIChat.ts)                                                     | `tools` 改 computed 合并本地 + MCP；`executeTool` 按名称前缀分流                                                |
| Modify | [creator/src/prompts/tools.ts](creator/src/prompts/tools.ts)                                                                     | 导出 `LOCAL_TOOLS` 常量；新增 `toolsForLLM(mcpTools)` 合并函数                                                  |
| Modify | [creator/src/prompts/buildSystemPrompt.ts](creator/src/prompts/buildSystemPrompt.ts)                                             | system prompt 补充：介绍可用的 MCP 工具类别，鼓励需要时效/事实信息时调用                                        |
| Modify | [package.json](package.json)                                                                                                     | 加 `@modelcontextprotocol/sdk` 到 dependencies                                                                  |
| Move   | /Users/zhangxu/.claude/plans/functional-juggling-clock.md → [docs/plans/04-mcp-integration.md](docs/plans/04-mcp-integration.md) | 归档到项目文档树（执行第一步即可完成）                                                                          |

---

## Task 1：安装 MCP SDK + Vite middleware 代理

**Files:**

- Modify: `package.json`
- Modify: `vite.config.creator.ts`

- [ ] **Step 1.1 — 安装 SDK**

```bash
pnpm add @modelcontextprotocol/sdk
```

校验：`pnpm ls @modelcontextprotocol/sdk` 输出版本。

- [ ] **Step 1.2 — 在 `vite.config.creator.ts` 新增 `mcpProxyPlugin`**

在 `slidesToolPlugin` 之后追加：

```ts
// MCP 代理：维护 client registry，暴露 list-tools / call-tool
function mcpProxyPlugin() {
  // 动态 import，避免影响 vite 启动速度
  type ClientEntry = {
    url: string
    headers: Record<string, string>
    client: any // Client 实例
    transport: any
    tools?: any[] // 缓存 tools/list 结果
  }
  const clients = new Map<string, ClientEntry>()

  async function ensureClient(name: string, url: string, headers: Record<string, string>) {
    const key = `${name}:${url}`
    const existing = clients.get(key)
    if (existing && existing.url === url) return existing

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } =
      await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    })
    const client = new Client({ name: 'big-ppt-creator', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport)

    const entry: ClientEntry = { url, headers, client, transport }
    clients.set(key, entry)
    return entry
  }

  function readJson(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (c: string) => (body += c))
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  }

  return {
    name: 'mcp-proxy',
    configureServer(server: any) {
      // 列出某个 MCP server 暴露的工具
      server.middlewares.use('/api/mcp/list-tools', async (req: any, res: any) => {
        try {
          const { name, url, headers } = await readJson(req)
          if (!name || !url) throw new Error('name 和 url 必填')
          const entry = await ensureClient(name, url, headers || {})
          if (!entry.tools) {
            const result = await entry.client.listTools()
            entry.tools = result.tools
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: true, tools: entry.tools }))
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })

      // 调用某个工具
      server.middlewares.use('/api/mcp/call-tool', async (req: any, res: any) => {
        try {
          const { name, url, headers, toolName, arguments: args } = await readJson(req)
          const entry = await ensureClient(name, url, headers || {})
          const result = await entry.client.callTool({ name: toolName, arguments: args || {} })
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: true, result }))
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ success: false, error: err.message }))
        }
      })
    },
  }
}
```

然后在 `plugins: [vue(), slidesToolPlugin()]` 追加 `mcpProxyPlugin()`。

- [ ] **Step 1.3 — 冒烟验证 middleware 正常起**

```bash
pnpm creator
```

在浏览器控制台跑：

```js
fetch('/api/mcp/list-tools', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'web-search-prime',
    url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
    headers: { Authorization: 'Bearer <你的 zhipu key>' },
  }),
})
  .then((r) => r.json())
  .then(console.log)
```

预期：`{ success: true, tools: [{ name: 'webSearchPrime', ... }] }`

如果失败：读 terminal 里 Vite 的日志，判断是 SDK 依赖问题还是 MCP server 返回异常。

- [ ] **Step 1.4 — commit**

```bash
git add package.json pnpm-lock.yaml vite.config.creator.ts
git commit -m "feat(mcp): 新增 MCP HTTP client 代理 middleware"
```

---

## Task 2：预置目录 + useMCP composable

**Files:**

- Create: `creator/src/prompts/mcpCatalog.ts`
- Create: `creator/src/composables/useMCP.ts`

- [ ] **Step 2.1 — 预置目录 `mcpCatalog.ts`**

```ts
export interface MCPCatalogEntry {
  id: string // 稳定 id（localStorage 引用它），同时兼做工具前缀
  displayName: string // UI 展示名
  description: string // 一句话说明
  url: string // MCP endpoint
  provider: 'zhipu' | 'custom' // 用来判断能否复用 LLM api key
  authMode: 'bearer' // 未来可扩展
  badge?: string // 角标，比如 "联网搜索" / "读网页" / "视觉"
}

export const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    id: 'zhipu-web-search',
    displayName: '联网搜索（智谱）',
    description: '基于智谱 MCP 的联网搜索，返回网页标题 / 摘要 / URL。',
    url: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp',
    provider: 'zhipu',
    authMode: 'bearer',
    badge: '搜索',
  },
  {
    id: 'zhipu-web-reader',
    displayName: '网页读取（智谱）',
    description: '抓取指定 URL 的网页正文，转为模型友好的 markdown。',
    url: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp',
    provider: 'zhipu',
    authMode: 'bearer',
    badge: '读网页',
  },
  {
    id: 'zhipu-vision',
    displayName: '视觉理解（智谱）',
    description: '对图片内容进行分析和理解。',
    url: 'https://open.bigmodel.cn/api/mcp/vision/mcp',
    provider: 'zhipu',
    authMode: 'bearer',
    badge: '视觉',
  },
  {
    id: 'zhipu-zread',
    displayName: 'GitHub 仓库读取（智谱 Zread）',
    description: '读取 GitHub 仓库结构、文件、搜索文档。',
    url: 'https://open.bigmodel.cn/api/mcp/zread/mcp',
    provider: 'zhipu',
    authMode: 'bearer',
    badge: 'GitHub',
  },
]

export function findCatalogEntry(id: string): MCPCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id)
}
```

> 实际 URL 以 [docs.bigmodel.cn/cn/coding-plan/mcp/\*](https://docs.bigmodel.cn/cn/coding-plan/mcp/) 为准；vision / zread 的 endpoint 在执行时要复核一下文档（本 plan 给出的是推测值，执行第一步要打开文档确认 4 个 URL 准确）。

- [ ] **Step 2.2 — `useMCP.ts`（数据模型区分目录项 / 自定义项）**

```ts
import { computed, ref } from 'vue'
import { findCatalogEntry, MCP_CATALOG } from '../prompts/mcpCatalog'

export interface MCPServerBase {
  id: string // 本地唯一 id（目录项直接用 catalogId；自定义项生成 uuid）
  enabled: boolean
}

/** 来自预置目录的 server，用户只需填 apiKey（或复用 LLM key） */
export interface CatalogServer extends MCPServerBase {
  kind: 'catalog'
  catalogId: string // 对应 MCP_CATALOG.id
  apiKey: string // 独立存储；若 reuseLLMKey，则此字段忽略
  reuseLLMKey?: boolean // provider === 'zhipu' 时允许
}

/** 自定义 MCP（进阶用户） */
export interface CustomServer extends MCPServerBase {
  kind: 'custom'
  name: string // 用作工具前缀
  url: string
  headers: Array<{ key: string; value: string }>
}

export type MCPServer = CatalogServer | CustomServer

export interface MCPTool {
  serverId: string
  serverName: string
  rawName: string
  fullName: string // mcp__<serverName>__<rawName>
  description?: string
  inputSchema?: any
}

const STORAGE_KEY = 'mcp-servers-v1' // 版本后缀，防旧数据冲突
const servers = ref<MCPServer[]>(loadServers())
const tools = ref<MCPTool[]>([])
const loadingServers = ref<Set<string>>(new Set())
const errors = ref<Record<string, string>>({})

function loadServers(): MCPServer[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers.value))
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'server'
}

/** 从 useAIChat 的 llm-settings 读智谱 key，用于 reuseLLMKey */
function getZhipuLLMKey(): string {
  try {
    const s = JSON.parse(localStorage.getItem('llm-settings') || '{}')
    return s.provider === 'zhipu' ? s.apiKey || '' : ''
  } catch {
    return ''
  }
}

function resolveRequest(server: MCPServer): {
  name: string
  url: string
  headers: Record<string, string>
} {
  if (server.kind === 'catalog') {
    const entry = findCatalogEntry(server.catalogId)
    if (!entry) throw new Error(`预置目录项 ${server.catalogId} 已失效`)
    const token = server.reuseLLMKey ? getZhipuLLMKey() : server.apiKey
    if (!token) throw new Error('未配置 API Key')
    return {
      name: entry.id,
      url: entry.url,
      headers: { Authorization: `Bearer ${token}` },
    }
  }
  // custom
  const headers: Record<string, string> = {}
  for (const h of server.headers) {
    if (h.key.trim()) headers[h.key.trim()] = h.value
  }
  return { name: sanitizeName(server.name), url: server.url, headers }
}

function serverPrefix(server: MCPServer): string {
  return server.kind === 'catalog' ? server.catalogId : sanitizeName(server.name)
}

export async function refreshServer(server: MCPServer): Promise<void> {
  if (!server.enabled) {
    tools.value = tools.value.filter((t) => t.serverId !== server.id)
    delete errors.value[server.id]
    return
  }
  loadingServers.value.add(server.id)
  try {
    const req = resolveRequest(server)
    const res = await fetch('/api/mcp/list-tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || '未知错误')

    const prefix = serverPrefix(server)
    const newTools: MCPTool[] = (data.tools || []).map((t: any) => ({
      serverId: server.id,
      serverName: prefix,
      rawName: t.name,
      fullName: `mcp__${prefix}__${t.name}`,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
    tools.value = [...tools.value.filter((t) => t.serverId !== server.id), ...newTools]
    delete errors.value[server.id]
  } catch (err: any) {
    errors.value[server.id] = err.message
    tools.value = tools.value.filter((t) => t.serverId !== server.id)
  } finally {
    loadingServers.value.delete(server.id)
  }
}

export async function callMCPTool(fullName: string, args: Record<string, any>): Promise<string> {
  const tool = tools.value.find((t) => t.fullName === fullName)
  if (!tool) throw new Error(`未找到工具 ${fullName}`)
  const server = servers.value.find((s) => s.id === tool.serverId)
  if (!server) throw new Error(`工具 ${fullName} 对应的 server 已被删除`)

  const req = resolveRequest(server)
  const res = await fetch('/api/mcp/call-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...req, toolName: tool.rawName, arguments: args }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'MCP 调用失败')

  const content = data.result?.content ?? []
  const textParts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text)
  return textParts.join('\n') || JSON.stringify(data.result)
}

export function useMCP() {
  /** 确保每个 catalog 条目都有一个 server 记录（初始 disabled），方便 UI 展示 */
  function ensureCatalogServers() {
    for (const entry of MCP_CATALOG) {
      if (!servers.value.some((s) => s.kind === 'catalog' && s.catalogId === entry.id)) {
        servers.value.push({
          id: entry.id,
          kind: 'catalog',
          catalogId: entry.id,
          enabled: false,
          apiKey: '',
          reuseLLMKey: entry.provider === 'zhipu',
        })
      }
    }
    persist()
  }

  function addCustomServer(): CustomServer {
    const server: CustomServer = {
      id: crypto.randomUUID(),
      kind: 'custom',
      name: 'new-mcp',
      url: '',
      enabled: false,
      headers: [{ key: 'Authorization', value: 'Bearer ' }],
    }
    servers.value.push(server)
    persist()
    return server
  }

  function updateServer(id: string, patch: Partial<MCPServer>) {
    const idx = servers.value.findIndex((s) => s.id === id)
    if (idx >= 0) {
      servers.value[idx] = { ...servers.value[idx], ...patch } as MCPServer
      persist()
    }
  }

  function removeServer(id: string) {
    // 仅允许删除 custom；catalog 只能 disable
    const s = servers.value.find((s) => s.id === id)
    if (!s || s.kind === 'catalog') return
    servers.value = servers.value.filter((s) => s.id !== id)
    tools.value = tools.value.filter((t) => t.serverId !== id)
    delete errors.value[id]
    persist()
  }

  async function refreshAll() {
    await Promise.all(servers.value.filter((s) => s.enabled).map(refreshServer))
  }

  const catalogServers = computed(() =>
    servers.value.filter((s): s is CatalogServer => s.kind === 'catalog'),
  )
  const customServers = computed(() =>
    servers.value.filter((s): s is CustomServer => s.kind === 'custom'),
  )

  return {
    servers,
    catalogServers,
    customServers,
    tools: computed(() => tools.value),
    errors,
    loadingServers,
    ensureCatalogServers,
    addCustomServer,
    updateServer,
    removeServer,
    refreshServer,
    refreshAll,
  }
}
```

- [ ] **Step 2.3 — commit**

```bash
git add creator/src/prompts/mcpCatalog.ts creator/src/composables/useMCP.ts
git commit -m "feat(mcp): 预置目录 + useMCP composable (catalog/custom 双模式)"
```

---

## Task 3：动态合并工具 + 分流执行

**Files:**

- Modify: `creator/src/prompts/tools.ts`
- Modify: `creator/src/composables/useAIChat.ts`
- Modify: `creator/src/prompts/buildSystemPrompt.ts`

- [ ] **Step 3.1 — 拆分 tools.ts**

顶部改名 `export const tools` → `export const LOCAL_TOOLS`，文件尾部追加：

```ts
import type { MCPTool } from '../composables/useMCP'

export type LLMTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: any
  }
}

export function toolsForLLM(mcpTools: MCPTool[]): LLMTool[] {
  const mcpLlmTools: LLMTool[] = mcpTools.map((t) => ({
    type: 'function',
    function: {
      name: t.fullName,
      description: t.description || `MCP 工具：${t.rawName}`,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }))
  return [...(LOCAL_TOOLS as any as LLMTool[]), ...mcpLlmTools]
}
```

- [ ] **Step 3.2 — `useAIChat.ts` 动态合并工具**

顶部 import：

```ts
import { LOCAL_TOOLS, toolsForLLM } from '../prompts/tools'
import { callMCPTool, useMCP } from './useMCP'
```

删除原 `import { tools } from '../prompts/tools'`。

在 `useAIChat()` 内部新增：

```ts
const { tools: mcpTools } = useMCP()
const effectiveTools = computed(() => toolsForLLM(mcpTools.value))
```

`callLLMStream` 调用处（body 里 `tools` 字段）改为：

```ts
body: JSON.stringify({
  model: getModel(),
  messages,
  tools: effectiveTools.value,  // ← 改这里
  stream: true,
}),
```

注意：`callLLMStream` 当前在闭包外层，读不到 `effectiveTools`。选方案之一：

- **A（最小改）**：把 `tools` 作为新参数传进 `callLLMStream` / `callLLMWithRetry`
- **B（小重构）**：把 LLM 调用逻辑一起挪进 `useAIChat` 闭包

**推荐 A**，保持改动聚焦。`callLLMStream` 签名改为：

```ts
async function callLLMStream(
  messages: ChatMessage[],
  tools: LLMTool[], // ← 新增
  signal: AbortSignal,
  onTextChunk: (chunk: string) => void,
)
```

`body` 里 `tools` 用参数；`callLLMWithRetry` 透传。`sendMessage` 里调用处传 `effectiveTools.value`。

- [ ] **Step 3.3 — `executeTool` 分流**

原 switch 改成：

```ts
async function executeTool(call: ToolCall): Promise<string> {
  const args = JSON.parse(call.function.arguments || '{}')
  const name = call.function.name

  if (name.startsWith('mcp__')) {
    return await callMCPTool(name, args)
  }

  switch (name) {
    case 'read_slides':
      return await fetchToolResult('/api/read-slides')
    case 'write_slides':
      return await fetchToolResult('/api/write-slides', args)
    case 'edit_slides':
      return await fetchToolResult('/api/edit-slides', args)
    case 'read_template':
      return await fetchToolResult('/api/read-template', args)
    case 'list_templates':
      return await fetchToolResult('/api/list-templates')
    default:
      return JSON.stringify({ success: false, error: `未知工具: ${name}` })
  }
}
```

- [ ] **Step 3.4 — 思维链 label 支持 MCP 工具**

`TOOL_STATUS_MAP` 旁边加兜底逻辑。在 `step.label` 赋值处：

```ts
label: TOOL_STATUS_MAP[tc.function.name]
  || (tc.function.name.startsWith('mcp__')
        ? `MCP：${tc.function.name.replace(/^mcp__[^_]+__/, '')}`
        : `调用工具：${tc.function.name}`),
```

- [ ] **Step 3.5 — system prompt 补充 MCP 提示**

`buildSystemPrompt.ts` 末尾追加一段（如果已有工具说明区，合并进去）：

```
当用户需要时效性信息（新闻、财报、最新数据）或需要读取外部网页/仓库时，
如果可用工具列表里出现 mcp__ 开头的工具，可以使用它们获取实时信息，
而不是基于训练数据猜测。
```

- [ ] **Step 3.6 — commit**

```bash
git add creator/src/prompts/tools.ts creator/src/prompts/buildSystemPrompt.ts creator/src/composables/useAIChat.ts
git commit -m "feat(mcp): 动态合并 MCP 工具进 LLM 工具集并按前缀分流执行"
```

---

## Task 4：SettingsModal 加 MCP Servers tab（目录式）

UX 目标：

- 打开设置 → MCP Servers tab → 看到 4 张预置卡片（智谱 4 个 MCP）
- 每张卡片：名称 + 一句话说明 + 开关 + API Key 输入框 + "复用 LLM key" 勾选（智谱专属）
- 开关开启后自动连一次 `list-tools`，成功则显示已加载的工具名；失败显示红色错误
- 目录下方折叠区"自定义 MCP"，默认收起；展开后可添加/编辑/删除通用 URL+headers 的自定义 server

**Files:**

- Create: `creator/src/components/MCPCatalogItem.vue`
- Create: `creator/src/components/MCPCustomServer.vue`
- Modify: `creator/src/components/SettingsModal.vue`

- [ ] **Step 4.1 — `MCPCatalogItem.vue`（预置条目卡片）**

```vue
<script setup lang="ts">
import { computed, watch } from 'vue'
import type { CatalogServer } from '../composables/useMCP'
import { findCatalogEntry } from '../prompts/mcpCatalog'
import { useMCP } from '../composables/useMCP'

const props = defineProps<{ server: CatalogServer }>()
const { updateServer, refreshServer, errors, loadingServers, tools } = useMCP()

const entry = computed(() => findCatalogEntry(props.server.catalogId)!)
const isLoading = computed(() => loadingServers.value.has(props.server.id))
const error = computed(() => errors.value[props.server.id])
const serverTools = computed(() => tools.value.filter((t) => t.serverId === props.server.id))

function patch<K extends keyof CatalogServer>(key: K, value: CatalogServer[K]) {
  updateServer(props.server.id, { [key]: value } as any)
}

// 开关开启 / apiKey 变更 / reuseLLMKey 切换时，自动刷新一次
watch(
  () => [props.server.enabled, props.server.apiKey, props.server.reuseLLMKey] as const,
  () => {
    if (props.server.enabled) refreshServer(props.server)
  },
)
</script>

<template>
  <div class="catalog-item" :class="{ enabled: server.enabled }">
    <div class="head">
      <div class="meta">
        <span class="name">{{ entry.displayName }}</span>
        <span v-if="entry.badge" class="badge">{{ entry.badge }}</span>
      </div>
      <label class="toggle">
        <input
          type="checkbox"
          :checked="server.enabled"
          @change="patch('enabled', ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </div>
    <div class="desc">{{ entry.description }}</div>

    <div v-if="server.enabled" class="body">
      <label v-if="entry.provider === 'zhipu'" class="reuse">
        <input
          type="checkbox"
          :checked="!!server.reuseLLMKey"
          @change="patch('reuseLLMKey', ($event.target as HTMLInputElement).checked)"
        />
        复用 LLM 的智谱 API Key
      </label>

      <input
        v-if="!server.reuseLLMKey"
        class="key-input"
        type="password"
        placeholder="API Key"
        :value="server.apiKey"
        @input="patch('apiKey', ($event.target as HTMLInputElement).value)"
      />

      <div v-if="isLoading" class="hint">加载工具中...</div>
      <div v-else-if="error" class="hint error">错误：{{ error }}</div>
      <div v-else-if="serverTools.length > 0" class="hint">
        已加载
        <span v-for="t in serverTools" :key="t.fullName" class="tool-chip">{{ t.rawName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.catalog-item {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 12px 14px;
  transition: border-color 0.2s;
}
.catalog-item.enabled {
  border-color: #91caff;
  background: #f5fbff;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-weight: 600;
  font-size: 14px;
}
.badge {
  font-size: 11px;
  padding: 1px 6px;
  background: #e6f4ff;
  color: #1677ff;
  border-radius: 3px;
}
.desc {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}
.body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.reuse {
  font-size: 12px;
  color: #333;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.key-input {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: #666;
}
.hint.error {
  color: #ff4d4f;
}
.tool-chip {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  background: #fff;
  border: 1px solid #91caff;
  border-radius: 3px;
  color: #1677ff;
  font-size: 11px;
}
.toggle input {
  width: 36px;
  height: 20px;
}
</style>
```

- [ ] **Step 4.2 — `MCPCustomServer.vue`（进阶：自定义 MCP 表单）**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { CustomServer } from '../composables/useMCP'
import { useMCP } from '../composables/useMCP'

const props = defineProps<{ server: CustomServer }>()
const { updateServer, removeServer, refreshServer, errors, loadingServers, tools } = useMCP()

const isLoading = computed(() => loadingServers.value.has(props.server.id))
const error = computed(() => errors.value[props.server.id])
const serverTools = computed(() => tools.value.filter((t) => t.serverId === props.server.id))

function patch<K extends keyof CustomServer>(key: K, value: CustomServer[K]) {
  updateServer(props.server.id, { [key]: value } as any)
}

function updateHeader(i: number, k: 'key' | 'value', v: string) {
  const copy = [...props.server.headers]
  copy[i] = { ...copy[i], [k]: v }
  patch('headers', copy)
}

function addHeader() {
  patch('headers', [...props.server.headers, { key: '', value: '' }])
}
function removeHeader(i: number) {
  patch(
    'headers',
    props.server.headers.filter((_, idx) => idx !== i),
  )
}
</script>

<template>
  <div class="custom">
    <div class="row">
      <input
        class="name-input"
        placeholder="名称"
        :value="server.name"
        @input="patch('name', ($event.target as HTMLInputElement).value)"
      />
      <label class="toggle">
        <input
          type="checkbox"
          :checked="server.enabled"
          @change="patch('enabled', ($event.target as HTMLInputElement).checked)"
        />
        启用
      </label>
      <button class="btn-test" :disabled="isLoading" @click="refreshServer(server)">
        {{ isLoading ? '...' : '测试' }}
      </button>
      <button class="btn-del" @click="removeServer(server.id)">删除</button>
    </div>

    <input
      class="url-input"
      placeholder="MCP endpoint URL（https://...）"
      :value="server.url"
      @input="patch('url', ($event.target as HTMLInputElement).value)"
    />

    <div class="headers">
      <div class="headers-title">自定义 Headers</div>
      <div v-for="(h, i) in server.headers" :key="i" class="header-row">
        <input
          placeholder="Key"
          :value="h.key"
          @input="updateHeader(i, 'key', ($event.target as HTMLInputElement).value)"
        />
        <input
          placeholder="Value"
          type="password"
          :value="h.value"
          @input="updateHeader(i, 'value', ($event.target as HTMLInputElement).value)"
        />
        <button @click="removeHeader(i)">×</button>
      </div>
      <button class="btn-add-header" @click="addHeader">+ 添加 Header</button>
    </div>

    <div v-if="error" class="hint error">错误：{{ error }}</div>
    <div v-else-if="serverTools.length > 0" class="hint">
      已加载 {{ serverTools.length }} 个工具
    </div>
  </div>
</template>

<style scoped>
.custom {
  border: 1px dashed #d9d9d9;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.name-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.url-input {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.toggle {
  font-size: 12px;
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.btn-test,
.btn-del,
.btn-add-header {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.btn-del {
  color: #ff4d4f;
  border-color: #ffa39e;
}
.headers-title {
  font-size: 12px;
  color: #666;
}
.header-row {
  display: flex;
  gap: 4px;
}
.header-row input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 12px;
}
.hint {
  font-size: 12px;
  color: #666;
}
.hint.error {
  color: #ff4d4f;
}
</style>
```

- [ ] **Step 4.3 — SettingsModal 改 tabs + 目录布局**

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { LLMSettings } from '../composables/useAIChat'
import { useMCP } from '../composables/useMCP'
import MCPCatalogItem from './MCPCatalogItem.vue'
import MCPCustomServer from './MCPCustomServer.vue'

// ...原 LLMSettings / loadSettings / save 逻辑保持不变...

const activeTab = ref<'llm' | 'mcp'>('llm')
const showCustom = ref(false)

const { catalogServers, customServers, ensureCatalogServers, addCustomServer, refreshAll } =
  useMCP()

onMounted(() => {
  ensureCatalogServers()
  refreshAll()
})

// 打开设置时刷新一次（避免外部更改后不同步）
watch(
  () => props.open,
  (val) => {
    if (val) {
      settings.value = loadSettings()
      ensureCatalogServers()
    }
  },
)
</script>
```

template（仅 modal-body 区新增 tab 切换）：

```vue
<div class="tabs">
  <button :class="['tab', { active: activeTab === 'llm' }]" @click="activeTab = 'llm'">LLM</button>
  <button :class="['tab', { active: activeTab === 'mcp' }]" @click="activeTab = 'mcp'">MCP Servers</button>
</div>

<div v-if="activeTab === 'llm'" class="modal-body">
  <!-- 保留原 LLM 三个 form-group -->
</div>

<div v-else class="modal-body">
  <div class="section-title">预置 MCP</div>
  <MCPCatalogItem
    v-for="s in catalogServers"
    :key="s.id"
    :server="s"
  />

  <div class="custom-section">
    <button class="section-toggle" @click="showCustom = !showCustom">
      <span>{{ showCustom ? '▼' : '▶' }}</span>
      自定义 MCP（进阶）
      <span v-if="customServers.length > 0" class="count">{{ customServers.length }}</span>
    </button>
    <div v-if="showCustom" class="custom-list">
      <MCPCustomServer
        v-for="s in customServers"
        :key="s.id"
        :server="s"
      />
      <button class="btn-add" @click="addCustomServer">+ 添加自定义 MCP</button>
    </div>
  </div>
</div>
```

样式补：

```css
.tabs {
  display: flex;
  border-bottom: 1px solid #f0f0f0;
  padding: 0 20px;
}
.tab {
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: #666;
  border-bottom: 2px solid transparent;
}
.tab.active {
  color: #1677ff;
  border-bottom-color: #1677ff;
}
.modal-body {
  max-height: 60vh;
  overflow-y: auto;
}
.section-title {
  font-size: 12px;
  color: #999;
  font-weight: 500;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.custom-section {
  margin-top: 12px;
  border-top: 1px dashed #e8e8e8;
  padding-top: 12px;
}
.section-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.section-toggle:hover {
  color: #1677ff;
}
.count {
  font-size: 11px;
  padding: 0 6px;
  background: #f0f0f0;
  border-radius: 8px;
}
.custom-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.btn-add {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px dashed #1677ff;
  background: #fff;
  color: #1677ff;
  border-radius: 6px;
  cursor: pointer;
}
```

> SettingsModal 需要扩 max-width（现在 420px，MCP 内容较多），改为 `width: 520px`。

- [ ] **Step 4.4 — commit**

```bash
git add creator/src/components/MCPCatalogItem.vue creator/src/components/MCPCustomServer.vue creator/src/components/SettingsModal.vue
git commit -m "feat(mcp): SettingsModal 新增 MCP 预置目录 + 自定义进阶面板"
```

---

## 验证（Verification）

端到端测试步骤：

1. **冷启动**：`pnpm creator`，打开 http://localhost:3030
2. **配置 LLM**：设置 → LLM tab → 智谱 API Key
3. **启用 MCP**：设置 → MCP Servers tab → 看到 4 张预置卡片
   - 点开"联网搜索（智谱）"的开关
   - 默认勾选"复用 LLM 的智谱 API Key"
   - 卡片自动连接，应显示"已加载 webSearchPrime"
4. **关闭"复用"测试独立 key**：取消勾选"复用"→ 出现独立 apiKey 输入框 → 填入同一个 key → 自动刷新后同样显示已加载
5. **进阶折叠区**：展开"自定义 MCP"→ 点"+ 添加"→ 确认可以手填 URL + headers（但本次不必真连第三方）
6. **关闭设置**，对话"请搜索 2026 年最新的 Vue 3 发布进展并做一页幻灯片"
7. **预期：** 消息区出现两个 ThoughtChain 节点：
   - "MCP：webSearchPrime"（调 MCP 搜索）→ success
   - "正在读取当前幻灯片..." 或 "正在生成幻灯片..."（本地工具）→ success
8. **查看最终 slides.md**：应包含搜索返回的真实信息（而非 LLM 编造）
9. **退出再进**：关闭浏览器/刷新页面 → 设置里 MCP 卡片状态应持久（localStorage）

**构建校验：**

```bash
pnpm exec vite build --config vite.config.creator.ts
```

预期：exit 0，无 TS 错误。

**类型校验：**

```bash
pnpm exec tsc --noEmit --strict --target es2020 --module esnext --moduleResolution bundler --jsx preserve --types vite/client --skipLibCheck \
  creator/src/composables/useMCP.ts creator/src/composables/useAIChat.ts
```

预期：无输出。

---

## 风险与回退

| 风险                                                 | 应对                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| MCP SDK 在 Vite SSR 环境装载异常（CJS/ESM 兼容）     | 已用动态 `import()` 避开 Vite config eager 加载；若仍异常，改用 `noExternal` 配置或裸 JSON-RPC          |
| `StreamableHTTPClientTransport` session 跨请求失效   | `clients` map 按 `name:url` 持久化 client 实例；Vite 热重载会清空 map，此时再次调用会重建 session，透明 |
| 浏览器 localStorage 存 Bearer token 的安全性         | 与现有 `llm-settings` 同等风险；README 补说明；Phase 3 后端化后可迁移到 session cookie                  |
| MCP server 工具数量多、schema 大，system prompt 过长 | Phase 2.2 不处理，Phase 4 再引入按需/按需求声明激活；当前用户可在 SettingsModal 通过 `enabled` 开关裁剪 |

**回退：** 每个 Task 独立 commit，`git revert` 任一 commit 不影响其他。最稳妥的纯回退是 `git revert` Task 1 的 commit（删掉 middleware），前端依然能跑，只是 MCP 工具列表为空。
