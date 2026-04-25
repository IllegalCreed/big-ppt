# Phase 3.5 — MCP 集成 + 工具链后端化 实施文档

> **状态**：✅ 已关闭（2026-04-21）
> **前置阶段**：Phase 3 Monorepo 拆分（[06-phase3-closeout.md](06-phase3-closeout.md)）
> **后续阶段**：Phase 3.6 前端美化（[08](08-phase36-frontend-polish.md)）→ Phase 4 编辑器
> **路线图**：[roadmap.md Phase 3.5](../requirements/roadmap.md)
> **执行子技能**：`superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，所有 step 用 `- [ ]` checkbox 跟踪
> **替代**：[04-mcp-integration.md](04-mcp-integration.md)（已废弃）

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- MCP server headers 含 token / API key 等敏感凭据：本 Phase 落地为 `JsonFileRepo` 明文存储；**Phase 5 的 P2-4 task 升级为 AES-256-GCM 加密**（已闭环）
- `data/mcp.json` 不进 git（`.gitignore` 已覆盖 `data/`）
- 每次 `git commit` 前 `git status` 人工检查，禁用 `git add -A`

**Goal**:在独立的 `packages/agent` 服务里接入 MCP HTTP client,把"本地 5 个工具"与"启用的 MCP 工具"统一到 agent `tool-registry`,前端通过 `GET /api/tools` 动态拉取、`POST /api/call-tool` 统一执行;彻底清零 P1-2 技术债,并给 Phase 5 的"用户系统 + DB"留好迁移口。

**Architecture**:
- 配置 **source of truth 在后端**(`packages/agent/data/mcp.json`,可被 `BIG_PPT_MCP_CONFIG` 环境变量覆盖)
- agent 引入 `McpServerRepo` 接口 + `JsonFileRepo` 实现;Phase 5 换成 `DrizzleRepo` 即可,其它代码零改动
- agent 启动时对 `enabled=true` 的 server 并发 connect,失败不阻塞;PATCH 切换 `enabled` 或 `headers` 触发增量 `McpRegistry.sync()`
- MCP 工具以 `mcp__<serverId>__<toolName>` 名义 register 进统一 `tool-registry`,`POST /api/call-tool` 按前缀分流
- 前端 `useMCP` 变成标准 REST client(CRUD),不再持有 URL/headers;`useAIChat` 第一次 send 前 lazy `GET /api/tools`

**Tech Stack**:Hono 4 · `@modelcontextprotocol/sdk` · Vitest · Vue 3 Composition API(`<script setup lang="ts">`) · Vite

---

## Context

[06-phase3-closeout.md](06-phase3-closeout.md) 关闭时明确留给本 Phase 的遗留项:

1. **P1-2 后半段** —— 本地工具仍在前端静态声明([packages/creator/src/prompts/tools.ts](../../packages/creator/src/prompts/tools.ts)),没 register 进已建好的 [packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts) 骨架;前端 `executeTool` 还在用 `switch(call.function.name)` 手工分流
2. **MCP 本身** —— 04 原计划寄生在 Vite middleware,Phase 3 把后端独立后整体作废;07 基于 agent 独立服务重写
3. **命名空间规范(P3-5)** —— 工具名前缀 `mcp__<server>__<tool>` 沿用 Claude Code 风格,顺带落定

## 架构决策(2026-04-22 brainstorming)

| 决策 | 选择 | 理由 |
|---|---|---|
| MVP 范围 | 预置目录 + 自定义 URL/headers(04 原语义) | 最小闭环是"预置一键启用",自定义供进阶用户,UX 分层清晰 |
| 配置存储 | agent 文件 `data/mcp.json` + `JsonFileRepo` 抽象 | 倒装式为 Phase 5 DB 留口:只换 repo 实现,前端和 registry 都不动;用多写一层换 Phase 5 的零重构 |
| API 形态 | 统一 `tool-registry` + `GET /api/tools` + `POST /api/call-tool` | 前端 `useAIChat.executeTool` 收敛为一行 fetch;本地/MCP 工具对 LLM 透明 |
| 凭证加密 | Phase 3.5 明文 JSON(本地单机 dev) | 与现有 localStorage LLM key 同等级;Phase 5 加密列一起做;代码里埋 `// TODO(phase-5): encrypt at rest` 标记 |

## 不做什么(范围围栏)

- ❌ Phase 4 的工具拆分(`create_slide` / `update_slide` / `delete_slide` / `reorder_slides`)
- ❌ Phase 4 的 `slides.md` 架构升级(`global.css` / layout 组件)
- ❌ Phase 5 的 SQLite / Drizzle / users 表 / API key 后端化(P3-2)
- ❌ MCP stdio / SSE transport(只做 StreamableHTTP 一种)
- ❌ MCP server 健康心跳(session 在下次 callTool 失败时被动发现 + 重连)

## File Structure

> 所有路径以 monorepo 根 [/Users/zhangxu/workspace/big-ppt/](../../) 为基。

### `packages/shared/`

| 操作 | 文件 | 责任 |
|---|---|---|
| Modify | [src/api.ts](../../packages/shared/src/api.ts) | 追加 `McpServerConfig` / `McpServerStatus` / `McpServerWithStatus` / 各 MCP CRUD req-resp / `GetToolsResponse` / `CallToolRequest` / `CallToolResponse` |

### `packages/agent/`

| 操作 | 文件 | 责任 |
|---|---|---|
| Modify | [src/tools/registry.ts](../../packages/agent/src/tools/registry.ts) | 新增 `unregister(name)` 函数(MCP 禁用/重连时清理) |
| Create | `src/tools/local/index.ts` | `registerLocalTools()` 显式把 5 个本地工具 register 进 registry |
| Create | `src/tools/local/read-slides.ts` | ToolDef for `read_slides`,委托 [slides-store/readSlides](../../packages/agent/src/slides-store/index.ts) |
| Create | `src/tools/local/write-slides.ts` | ToolDef for `write_slides` |
| Create | `src/tools/local/edit-slides.ts` | ToolDef for `edit_slides` |
| Create | `src/tools/local/list-templates.ts` | ToolDef for `list_templates`(直接调 fs,沿用 [routes/templates.ts](../../packages/agent/src/routes/templates.ts) 的读法) |
| Create | `src/tools/local/read-template.ts` | ToolDef for `read_template`,含路径穿越守卫 |
| Create | `src/routes/tools.ts` | `GET /api/tools` + `POST /api/call-tool` |
| Create | `src/mcp-server-repo/types.ts` | `McpServerRepo` interface + `McpServerConfig` 类型 |
| Create | `src/mcp-server-repo/presets.ts` | 4 个智谱预置 MCP 的 seed 常量 |
| Create | `src/mcp-server-repo/json-file-repo.ts` | JSON 文件实现,原子写入,环境变量覆盖路径 |
| Create | `src/mcp-server-repo/index.ts` | `getRepo()` 单例 + `__resetRepoForTesting()` |
| Create | `src/mcp-registry/session.ts` | `McpSession` 封装 sdk `Client` + `Transport` + tools 缓存 + status |
| Create | `src/mcp-registry/registry.ts` | `McpRegistry` 类:initialize / sync / getStatus |
| Create | `src/mcp-registry/index.ts` | `getRegistry()` 单例 + `__resetRegistryForTesting()` |
| Create | `src/routes/mcp.ts` | `GET/POST/PATCH/DELETE /api/mcp/servers[/:id]` |
| Modify | [src/index.ts](../../packages/agent/src/index.ts) | 启动时 `registerLocalTools()` → 初始化 repo → 初始化 registry → mount 3 条新路由 |
| Create | `data/.gitignore` | 忽略 `mcp.json`(含明文 token,不入库);.gitignore 本身被追踪,天然保留目录 |
| Modify | [package.json](../../packages/agent/package.json) | 新增 `@modelcontextprotocol/sdk` 依赖 |
| Create | `test/tools-local.test.ts` | 本地 5 工具 register + exec 单测 |
| Create | `test/routes-tools.test.ts` | GET /api/tools + POST /api/call-tool 路由单测 |
| Create | `test/mcp-server-repo.test.ts` | repo CRUD + seed + 原子写并发单测 |
| Create | `test/mcp-registry.test.ts` | registry 生命周期单测(vi.mock sdk) |
| Create | `test/routes-mcp.test.ts` | MCP CRUD 路由单测 |

### `packages/creator/`

| 操作 | 文件 | 责任 |
|---|---|---|
| Delete | [src/prompts/tools.ts](../../packages/creator/src/prompts/tools.ts) | 静态工具数组,已被 `GET /api/tools` 替代 |
| Modify | [src/composables/useAIChat.ts](../../packages/creator/src/composables/useAIChat.ts) | `tools` 改 `ref<LLMTool[]>` + `ensureTools()` lazy fetch;`executeTool` 收敛为 POST `/api/call-tool` |
| Create | `src/composables/useMCP.ts` | MCP servers 的响应式 store,CRUD 封装 |
| Modify | [src/components/SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue) | 拆 tabs:"LLM" / "MCP Servers" |
| Create | `src/components/MCPCatalogItem.vue` | 预置卡片(启用 switch + apiKey 输入 + "复用 LLM key" 勾选) |
| Create | `src/components/MCPCustomServer.vue` | 折叠的自定义 MCP 表单(URL + 自定义 headers) |
| Modify | [src/prompts/buildSystemPrompt.ts](../../packages/creator/src/prompts/buildSystemPrompt.ts) | 接收已启用 MCP 的 `badge` 列表,追加一段"你还可以使用这些扩展工具:..." |
| Modify | [test/shared-contract.test.ts](../../packages/creator/test/shared-contract.test.ts) | 追加 MCP 契约类型编译守门 |

---

## Tasks

每个 Task 结尾 commit 一次(7 个 commit,commit message 用中文,与项目历史一致)。

### Task 0:扩展 `@big-ppt/shared` 契约类型

**Files:**
- Modify: [packages/shared/src/api.ts](../../packages/shared/src/api.ts)
- Modify: [packages/creator/test/shared-contract.test.ts](../../packages/creator/test/shared-contract.test.ts)

- [ ] **Step 0.1 — 在 `api.ts` 末尾追加 MCP / 工具契约类型**

在 `export type { ChatMessage, ToolCall, LLMTool, LogPayload }` 之前插入:

```ts
// === MCP server 配置(后端持久化) ===

export interface McpServerConfig {
  /** 稳定 id,同时作为 `mcp__<id>__<tool>` 的前缀,必须符合 [a-zA-Z0-9_-]+ */
  id: string
  displayName: string
  description: string
  /** StreamableHTTP endpoint,如 https://open.bigmodel.cn/api/mcp/web_search_prime/mcp */
  url: string
  /** 连接时透传的 HTTP headers(含 Authorization) */
  headers: Record<string, string>
  enabled: boolean
  /** 预置(代码里 seed)/ 用户新增。预置不可删,只可禁用 */
  preset: boolean
  badge?: string
}

export type McpServerState = 'disabled' | 'connecting' | 'ok' | 'error'

export interface McpServerStatus {
  state: McpServerState
  toolCount?: number
  error?: string
  /** ISO string */
  connectedAt?: string
}

export interface McpServerWithStatus extends McpServerConfig {
  status: McpServerStatus
}

// === /api/mcp/servers ===

export interface GetMcpServersResponse {
  success: boolean
  servers?: McpServerWithStatus[]
  error?: string
}

export interface CreateMcpServerRequest {
  id: string
  displayName: string
  description?: string
  url: string
  headers?: Record<string, string>
  badge?: string
}

export interface UpdateMcpServerRequest {
  enabled?: boolean
  headers?: Record<string, string>
  displayName?: string
  description?: string
  badge?: string
}

export interface MutateMcpServerResponse {
  success: boolean
  error?: string
}

// === /api/tools ===

export interface GetToolsResponse {
  success: boolean
  tools?: LLMTool[]
  error?: string
}

// === /api/call-tool ===

export interface CallToolRequest {
  name: string
  args: Record<string, unknown>
}

export interface CallToolResponse {
  success: boolean
  /** 统一序列化成字符串,前端原样喂回 `tool` role 的 content */
  result?: string
  error?: string
}
```

- [ ] **Step 0.2 — 在契约测试里守门这些新类型**

编辑 [packages/creator/test/shared-contract.test.ts](../../packages/creator/test/shared-contract.test.ts),在文件末尾追加:

```ts
import { expectTypeOf, test } from 'vitest'
import type {
  McpServerConfig,
  McpServerStatus,
  McpServerWithStatus,
  GetMcpServersResponse,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  GetToolsResponse,
  CallToolRequest,
  CallToolResponse,
} from '@big-ppt/shared'

test('McpServerWithStatus = McpServerConfig & { status }', () => {
  const x: McpServerWithStatus = {
    id: 'demo',
    displayName: 'Demo',
    description: '',
    url: 'https://example.com',
    headers: {},
    enabled: false,
    preset: false,
    status: { state: 'disabled' },
  }
  expectTypeOf(x).toMatchTypeOf<McpServerConfig>()
  expectTypeOf(x.status).toEqualTypeOf<McpServerStatus>()
})

test('CreateMcpServerRequest 的 headers/description/badge 可选', () => {
  const minimal: CreateMcpServerRequest = {
    id: 'x',
    displayName: 'X',
    url: 'https://x',
  }
  expectTypeOf(minimal).toMatchTypeOf<CreateMcpServerRequest>()
})

test('UpdateMcpServerRequest 所有字段可选', () => {
  const empty: UpdateMcpServerRequest = {}
  expectTypeOf(empty).toMatchTypeOf<UpdateMcpServerRequest>()
})

test('CallToolResponse.result 是字符串', () => {
  const r: CallToolResponse = { success: true, result: 'ok' }
  expectTypeOf(r.result).toEqualTypeOf<string | undefined>()
})

test('GetToolsResponse.tools 是 LLMTool[]', () => {
  expectTypeOf<GetToolsResponse['tools']>().toMatchTypeOf<Array<{ type: 'function' }> | undefined>()
})
```

- [ ] **Step 0.3 — 跑测试确认编译 + 契约通过**

Run: `pnpm exec turbo run test --filter=@big-ppt/creator`
Expected: `PASS`,新增的契约测试作为编译守门被计入 test 数量。

- [ ] **Step 0.4 — commit**

```bash
git add packages/shared/src/api.ts packages/creator/test/shared-contract.test.ts
git commit -m "feat(shared): 新增 MCP 配置与工具调用的 API 契约类型"
```

---

### Task 1:本地工具 register 进 agent tool-registry

**Files:**
- Modify: [packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts)
- Create: `packages/agent/src/tools/local/read-slides.ts`
- Create: `packages/agent/src/tools/local/write-slides.ts`
- Create: `packages/agent/src/tools/local/edit-slides.ts`
- Create: `packages/agent/src/tools/local/list-templates.ts`
- Create: `packages/agent/src/tools/local/read-template.ts`
- Create: `packages/agent/src/tools/local/index.ts`
- Create: `packages/agent/test/tools-local.test.ts`

- [ ] **Step 1.1 — registry 新增 `unregister(name)`**

Edit [packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts),在 `hasTool` 之后追加:

```ts
export function unregister(name: string): boolean {
  return registry.delete(name)
}
```

然后 Edit [packages/agent/test/tool-registry.test.ts](../../packages/agent/test/tool-registry.test.ts):把文件顶部的 `import { ... } from '../src/tools/registry.js'` 追加 `unregister`;在最后一个 `it(...)` 之后追加:

```ts
it('unregister 删除已注册工具并返回 true', () => {
  register({
    name: 'tmp_tool',
    description: 't',
    parameters: { type: 'object', properties: {} },
    exec: async () => 'ok',
  })
  expect(hasTool('tmp_tool')).toBe(true)
  expect(unregister('tmp_tool')).toBe(true)
  expect(hasTool('tmp_tool')).toBe(false)
  expect(unregister('tmp_tool')).toBe(false)
})
```

- [ ] **Step 1.2 — 跑 tool-registry 测试确认 5 → 5 unchanged,新 case 过**

Run: `pnpm exec vitest run -t "unregister" --project=@big-ppt/agent`
Expected: 1 PASS。

- [ ] **Step 1.3 — 写 `local/read-slides.ts`**

```ts
// packages/agent/src/tools/local/read-slides.ts
import type { ToolDef } from '../registry.js'
import { readSlides } from '../../slides-store/index.js'

export const readSlidesTool: ToolDef = {
  name: 'read_slides',
  description: '读取当前 slides.md 的完整内容。在修改幻灯片之前,应先调用此工具了解当前内容。',
  parameters: { type: 'object', properties: {} },
  exec: async () => readSlides(),
}
```

- [ ] **Step 1.4 — 写 `local/write-slides.ts`**

```ts
// packages/agent/src/tools/local/write-slides.ts
import { Buffer } from 'node:buffer'
import type { ToolDef } from '../registry.js'
import { writeSlides } from '../../slides-store/index.js'
import type { WriteSlidesResponse } from '@big-ppt/shared'

export const writeSlidesTool: ToolDef = {
  name: 'write_slides',
  description: '用新内容完全替换 slides.md。仅在首次生成幻灯片时使用,修改已有内容请用 edit_slides。',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '完整的 slides markdown 内容,包括 frontmatter 和所有页面',
      },
    },
    required: ['content'],
  },
  exec: async (args) => {
    const content = typeof args.content === 'string' ? args.content : ''
    if (!content) {
      const resp: WriteSlidesResponse = { success: false, error: 'content 不能为空' }
      return JSON.stringify(resp)
    }
    writeSlides(content)
    const resp: WriteSlidesResponse = { success: true, bytes: Buffer.byteLength(content, 'utf-8') }
    return JSON.stringify(resp)
  },
}
```

- [ ] **Step 1.5 — 写 `local/edit-slides.ts`**

```ts
// packages/agent/src/tools/local/edit-slides.ts
import type { ToolDef } from '../registry.js'
import { editSlides } from '../../slides-store/index.js'

export const editSlidesTool: ToolDef = {
  name: 'edit_slides',
  description:
    '精确替换 slides.md 中的某段内容。old_string 必须是文件中唯一存在的文本片段,如果匹配到多处会报错,请提供更长的上下文以唯一定位。',
  parameters: {
    type: 'object',
    properties: {
      old_string: { type: 'string', description: '要被替换的原文,必须是文件中唯一匹配的文本' },
      new_string: { type: 'string', description: '替换后的新内容' },
    },
    required: ['old_string', 'new_string'],
  },
  exec: async (args) => {
    const oldString = typeof args.old_string === 'string' ? args.old_string : ''
    const newString = typeof args.new_string === 'string' ? args.new_string : ''
    const result = editSlides(oldString, newString)
    return JSON.stringify(result)
  },
}
```

- [ ] **Step 1.6 — 写 `local/list-templates.ts` 与 `local/read-template.ts`**

`list-templates.ts` —— 把 [routes/templates.ts](../../packages/agent/src/routes/templates.ts) 里 `list-templates` handler 的内部逻辑抽出到 tool exec:

```ts
// packages/agent/src/tools/local/list-templates.ts
import fs from 'node:fs'
import path from 'node:path'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'

const IGNORE_FILES = new Set(['DESIGN.md', 'README.md'])

export const listTemplatesTool: ToolDef = {
  name: 'list_templates',
  description: '列出所有可用的页面模板,返回模板文件列表、usage_guide、design_spec 和可用图片路径。',
  parameters: { type: 'object', properties: {} },
  exec: async () => {
    const { templatesDir } = getPaths()
    const all = fs.readdirSync(templatesDir)
    const files = all
      .filter((f) => f.endsWith('.md') && !IGNORE_FILES.has(f))
      .map((f) => ({ name: f, path: `company-standard/${f}` }))
    const readmePath = path.join(templatesDir, 'README.md')
    const usage_guide = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf-8') : ''
    const designPath = path.join(templatesDir, 'DESIGN.md')
    const design_spec = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf-8') : ''
    const available_images = all
      .filter((f) => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
      .map((f) => `/templates/company-standard/${f}`)
    return JSON.stringify({ success: true, templates: files, usage_guide, design_spec, available_images })
  },
}
```

`read-template.ts`:

```ts
// packages/agent/src/tools/local/read-template.ts
import fs from 'node:fs'
import path from 'node:path'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'

export const readTemplateTool: ToolDef = {
  name: 'read_template',
  description: '读取指定模板文件的 markdown 内容,用于了解模板的结构和语法。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '模板文件名,如 cover.md、toc.md、content.md' },
    },
    required: ['name'],
  },
  exec: async (args) => {
    const name = typeof args.name === 'string' ? args.name : ''
    if (!name) return JSON.stringify({ success: false, error: 'name 不能为空' })
    const { templatesDir } = getPaths()
    const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')
    if (!safeName.endsWith('.md')) {
      return JSON.stringify({ success: false, error: '只支持 .md 模板文件' })
    }
    const templatePath = path.resolve(templatesDir, safeName)
    if (!templatePath.startsWith(path.resolve(templatesDir) + path.sep)) {
      return JSON.stringify({ success: false, error: '非法路径' })
    }
    if (!fs.existsSync(templatePath)) {
      return JSON.stringify({ success: false, error: `模板 ${safeName} 不存在` })
    }
    return JSON.stringify({ success: true, content: fs.readFileSync(templatePath, 'utf-8') })
  },
}
```

- [ ] **Step 1.7 — 写 `local/index.ts` 聚合 `registerLocalTools()`**

```ts
// packages/agent/src/tools/local/index.ts
import { register } from '../registry.js'
import { readSlidesTool } from './read-slides.js'
import { writeSlidesTool } from './write-slides.js'
import { editSlidesTool } from './edit-slides.js'
import { listTemplatesTool } from './list-templates.js'
import { readTemplateTool } from './read-template.js'

export function registerLocalTools(): void {
  register(readSlidesTool)
  register(writeSlidesTool)
  register(editSlidesTool)
  register(listTemplatesTool)
  register(readTemplateTool)
}
```

- [ ] **Step 1.8 — 写失败测试 `test/tools-local.test.ts`**

```ts
// packages/agent/test/tools-local.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __resetRegistry, getTool, hasTool, listTools } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-local-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  const templatesDir = path.join(slidevDir, 'templates/company-standard')
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# hello\n')
  fs.writeFileSync(path.join(templatesDir, 'cover.md'), '<cover>封面</cover>\n')
  fs.writeFileSync(path.join(templatesDir, 'README.md'), 'USAGE\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  __resetPathsForTesting()
  __resetRegistry()
  registerLocalTools()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  __resetPathsForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('registerLocalTools', () => {
  it('注册 5 个本地工具', () => {
    expect(hasTool('read_slides')).toBe(true)
    expect(hasTool('write_slides')).toBe(true)
    expect(hasTool('edit_slides')).toBe(true)
    expect(hasTool('list_templates')).toBe(true)
    expect(hasTool('read_template')).toBe(true)
    expect(listTools()).toHaveLength(5)
  })

  it('read_slides 返回 slides.md 原文', async () => {
    const tool = getTool('read_slides')!
    const out = await tool.exec({})
    expect(out).toBe('# hello\n')
  })

  it('write_slides 空内容返回 success=false', async () => {
    const out = await getTool('write_slides')!.exec({})
    expect(JSON.parse(out)).toEqual({ success: false, error: 'content 不能为空' })
  })

  it('write_slides 写成功后 read_slides 反映新内容', async () => {
    await getTool('write_slides')!.exec({ content: '# new\n' })
    const out = await getTool('read_slides')!.exec({})
    expect(out).toBe('# new\n')
  })

  it('edit_slides 定位唯一字符串并替换', async () => {
    await getTool('write_slides')!.exec({ content: '# hello\nworld\n' })
    await getTool('edit_slides')!.exec({ old_string: 'world', new_string: 'vitest' })
    const out = await getTool('read_slides')!.exec({})
    expect(out).toBe('# hello\nvitest\n')
  })

  it('list_templates 返回 cover.md 与 usage_guide', async () => {
    const raw = await getTool('list_templates')!.exec({})
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(true)
    expect(parsed.templates).toEqual([{ name: 'cover.md', path: 'company-standard/cover.md' }])
    expect(parsed.usage_guide).toBe('USAGE\n')
  })

  it('read_template 读 cover.md 正文', async () => {
    const raw = await getTool('read_template')!.exec({ name: 'cover.md' })
    expect(JSON.parse(raw)).toEqual({ success: true, content: '<cover>封面</cover>\n' })
  })

  it('read_template 拒绝非 md 后缀', async () => {
    const raw = await getTool('read_template')!.exec({ name: '../../../etc/passwd' })
    const parsed = JSON.parse(raw)
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 1.9 — 跑本地工具测试**

Run: `pnpm exec vitest run test/tools-local.test.ts --project=@big-ppt/agent`
Expected: 8 PASS。

- [ ] **Step 1.10 — commit**

```bash
git add packages/agent/src/tools/ packages/agent/test/tools-local.test.ts packages/agent/test/tool-registry.test.ts
git commit -m "feat(agent): 把本地 5 工具 register 进 tool-registry + 新增 unregister"
```

---

### Task 2:`GET /api/tools` + `POST /api/call-tool` 路由

**Files:**
- Create: `packages/agent/src/routes/tools.ts`
- Modify: [packages/agent/src/index.ts](../../packages/agent/src/index.ts)
- Create: `packages/agent/test/routes-tools.test.ts`

- [ ] **Step 2.1 — 写失败测试 `test/routes-tools.test.ts`**

```ts
// packages/agent/test/routes-tools.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { tools as toolsRoute } from '../src/routes/tools.js'
import { __resetRegistry, register } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'

function buildApp() {
  const app = new Hono()
  app.route('/api', toolsRoute)
  return app
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(path.join(slidevDir, 'templates/company-standard'), { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# t\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  __resetPathsForTesting()
  __resetRegistry()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  __resetPathsForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/tools', () => {
  it('空 registry 返回空数组', async () => {
    const res = await buildApp().request('/api/tools')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, tools: [] })
  })

  it('注册本地工具后返回 5 项', async () => {
    registerLocalTools()
    const res = await buildApp().request('/api/tools')
    const json = await res.json()
    expect(json.tools).toHaveLength(5)
    expect(json.tools.map((t: any) => t.function.name).sort()).toEqual(
      ['edit_slides', 'list_templates', 'read_slides', 'read_template', 'write_slides'],
    )
  })
})

describe('POST /api/call-tool', () => {
  it('未知工具返回 404', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nope', args: {} }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('缺 name 返回 400', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('调用本地 read_slides 返回 result 字符串', async () => {
    registerLocalTools()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, result: '# t\n' })
  })

  it('工具 exec 抛错时返回 success=false', async () => {
    register({
      name: 'boom',
      description: '',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        throw new Error('oops')
      },
    })
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'boom', args: {} }),
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('oops')
  })
})
```

- [ ] **Step 2.2 — 确认测试失败**

Run: `pnpm exec vitest run test/routes-tools.test.ts --project=@big-ppt/agent`
Expected: FAIL,"Cannot find module '../src/routes/tools.js'"。

- [ ] **Step 2.3 — 实现 `src/routes/tools.ts`**

```ts
// packages/agent/src/routes/tools.ts
import { Hono } from 'hono'
import { getTool, listTools } from '../tools/registry.js'

export const tools = new Hono()

tools.get('/tools', (c) => {
  return c.json({ success: true, tools: listTools() })
})

tools.post('/call-tool', async (c) => {
  let name: string | undefined
  let args: Record<string, unknown> = {}
  try {
    const body = await c.req.json<{ name?: string; args?: Record<string, unknown> }>()
    name = body.name
    args = body.args ?? {}
  } catch {
    return c.json({ success: false, error: '请求体必须是合法 JSON' }, 400)
  }
  if (!name || typeof name !== 'string') {
    return c.json({ success: false, error: 'name 不能为空' }, 400)
  }
  const tool = getTool(name)
  if (!tool) {
    return c.json({ success: false, error: `未知工具: ${name}` }, 404)
  }
  try {
    const result = await tool.exec(args)
    return c.json({ success: true, result })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
```

- [ ] **Step 2.4 — 挂到 agent 启动 + 启动时注册本地工具**

Edit [packages/agent/src/index.ts](../../packages/agent/src/index.ts):

```ts
// 顶部 import 区
import { tools as toolsRoute } from './routes/tools.js'
import { registerLocalTools } from './tools/local/index.js'
```

在 `getPaths()` eager 解析之后,`serve(...)` 之前插入:

```ts
// 注册本地工具到 agent tool-registry
registerLocalTools()
```

`app.route('/api', log)` 之后追加:

```ts
app.route('/api', toolsRoute)
```

- [ ] **Step 2.5 — 跑测试确认全绿**

Run: `pnpm exec vitest run test/routes-tools.test.ts --project=@big-ppt/agent`
Expected: 5 PASS。

再跑全套:`pnpm exec turbo run test`
Expected: 所有 test 绿,相对 Phase 3 的 31 条基线约 +15 条(tools-local 8 + routes-tools 6 + unregister 1)。

- [ ] **Step 2.6 — commit**

```bash
git add packages/agent/src/routes/tools.ts packages/agent/src/index.ts packages/agent/test/routes-tools.test.ts
git commit -m "feat(agent): 新增 GET /api/tools + POST /api/call-tool 统一入口"
```

---

### Task 3:前端切换到动态工具列表

**Files:**
- Modify: [packages/creator/src/composables/useAIChat.ts](../../packages/creator/src/composables/useAIChat.ts)
- Delete: [packages/creator/src/prompts/tools.ts](../../packages/creator/src/prompts/tools.ts)

- [ ] **Step 3.1 — `useAIChat.ts` 改为 lazy 拉 `/api/tools`**

替换文件顶部 `import { tools } from '../prompts/tools'` 为:

```ts
import type { LLMTool } from '@big-ppt/shared'
```

在 `MAX_CONTEXT_MESSAGES` 常量之后追加模块级缓存:

```ts
let cachedTools: LLMTool[] | null = null
let toolsLoadPromise: Promise<LLMTool[]> | null = null

async function ensureTools(): Promise<LLMTool[]> {
  if (cachedTools) return cachedTools
  if (!toolsLoadPromise) {
    toolsLoadPromise = (async () => {
      const res = await fetch('/api/tools')
      const json = (await res.json()) as { success: boolean; tools?: LLMTool[]; error?: string }
      if (!res.ok || !json.success || !json.tools) {
        toolsLoadPromise = null
        throw new Error(json.error || `GET /api/tools failed: ${res.status}`)
      }
      cachedTools = json.tools
      return cachedTools
    })()
  }
  return toolsLoadPromise
}

export function __clearToolsCacheForTesting() {
  cachedTools = null
  toolsLoadPromise = null
}
```

- [ ] **Step 3.2 — 重写 `executeTool`**

替换原 `executeTool` + `fetchToolResult` 两个函数为:

```ts
async function executeTool(call: ToolCall): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    // LLM 偶发吐出非法 JSON,原样透传给后端会收到 400,这里直接当空对象
  }
  const res = await fetch('/api/call-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: call.function.name, args }),
  })
  const json = (await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }))) as {
    success: boolean
    result?: string
    error?: string
  }
  if (!res.ok || !json.success) {
    return JSON.stringify({ success: false, error: json.error || `HTTP ${res.status}` })
  }
  return json.result ?? ''
}
```

- [ ] **Step 3.3 — `callLLMStream` 改用传入的 tools**

把函数签名改为:

```ts
async function callLLMStream(
  messages: ChatMessage[],
  signal: AbortSignal,
  toolsList: LLMTool[],
  onTextChunk: (chunk: string) => void,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
```

把 body 中 `tools` 改为 `tools: toolsList`。同步更新 `callLLMWithRetry` 签名:

```ts
async function callLLMWithRetry(
  messages: ChatMessage[],
  signal: AbortSignal,
  toolsList: LLMTool[],
  onTextChunk: (chunk: string) => void,
  retries = 2,
): Promise<{ toolCalls: ToolCall[]; content: string }> {
  try {
    return await callLLMStream(messages, signal, toolsList, onTextChunk)
  } catch (err: any) {
    if (err.name === 'AbortError') throw err
    if (err.message?.includes('API Key')) throw err
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return callLLMWithRetry(messages, signal, toolsList, onTextChunk, retries - 1)
    }
    throw err
  }
}
```

- [ ] **Step 3.4 — `sendMessage` 内第一件事拉工具 + 带进两次调用**

在 `sendMessage` 顶部(`if (status.value !== 'idle') return` 之后):

```ts
let liveTools: LLMTool[]
try {
  liveTools = await ensureTools()
} catch (err: any) {
  chatMessages.value.push({ role: 'assistant', content: `无法加载工具列表:${err.message}` })
  return
}
```

循环里 `logEvent({... tools_count: tools.length ...})` 与 `payload: { messages: trimmed, tools, model: getModel() }` 的 `tools` 全部改为 `liveTools`;`callLLMWithRetry(trimmed, ...)` 改为 `callLLMWithRetry(trimmed, abortController.signal, liveTools, ...)`。

完整改后的调用片段:

```ts
logEvent({
  session,
  turn: i + 1,
  kind: 'llm_request',
  messages_count: trimmed.length,
  tools_count: liveTools.length,
  model: getModel(),
  payload: { messages: trimmed, tools: liveTools, model: getModel() },
})

const { toolCalls, content } = await callLLMWithRetry(
  trimmed,
  abortController.signal,
  liveTools,
  (chunk) => {
    if (status.value !== 'streaming') {
      status.value = 'streaming'
      statusText.value = ''
    }
    fullContent += chunk
    streamingContent.value = fullContent
  },
)
```

- [ ] **Step 3.5 — 删除 `TOOL_STATUS_MAP` 的硬编码?不,保留**

`TOOL_STATUS_MAP` 是本地工具在 ThoughtChain 上显示的中文提示,保留即可。MCP 工具进来的时候 `TOOL_STATUS_MAP[name]` 会 undefined,会落到默认的 `调用工具:${name}`,体验可接受。

- [ ] **Step 3.6 — 删除前端静态工具声明**

```bash
rm packages/creator/src/prompts/tools.ts
```

- [ ] **Step 3.7 — 运行 creator 的 build 确认类型 + 编译通过**

Run: `pnpm exec turbo run build --filter=@big-ppt/creator`
Expected: build OK。如果报 `tools.ts` 还被某处 import,grep 删掉相关 import 即可。

快速兜底搜一次:

Run: `grep -r "from '../prompts/tools'" packages/creator/src || true`
Expected: 无输出。

- [ ] **Step 3.8 — 手测 E2E**

起整套:`pnpm dev`(三服务并行)。在浏览器 http://localhost:3030 发一条 prompt 例如"给我做一个 3 页关于向日葵的演示",验证:

1. devtools Network 看到一次 `GET /api/tools`,200
2. LLM 返回 tool_calls 后,`POST /api/call-tool` 代替过去的多条 `/api/read-slides` / `/api/write-slides` 直连
3. ThoughtChain 正常显示"正在读取/生成/修改..."
4. 最终页面成功渲染在 :3031 的 iframe 内

- [ ] **Step 3.9 — commit**

```bash
git add packages/creator/src/composables/useAIChat.ts
git rm packages/creator/src/prompts/tools.ts
git commit -m "feat(creator): 切换到 GET /api/tools + POST /api/call-tool 动态工具链"
```

---

### Task 4:`McpServerRepo`(JsonFileRepo + 预置 seed)

**Files:**
- Create: `packages/agent/src/mcp-server-repo/types.ts`
- Create: `packages/agent/src/mcp-server-repo/presets.ts`
- Create: `packages/agent/src/mcp-server-repo/json-file-repo.ts`
- Create: `packages/agent/src/mcp-server-repo/index.ts`
- Create: `packages/agent/data/.gitignore`
- Modify: [packages/agent/src/workspace.ts](../../packages/agent/src/workspace.ts) (只加一个 paths 字段)
- Create: `packages/agent/test/mcp-server-repo.test.ts`

- [ ] **Step 4.1 — `workspace.ts` 新增 `mcpConfigPath`**

Edit [packages/agent/src/workspace.ts](../../packages/agent/src/workspace.ts)。两处改动:

**(a)** `Paths` interface 追加 `mcpConfigPath: string`,改后:

```ts
export interface Paths {
  root: string
  slidesPath: string
  slidesBak: string
  templatesDir: string
  logsDir: string
  mcpConfigPath: string
}
```

**(b)** `getPaths()` 里在 `logsDir` 后追加一段,并在 `cached = { ... }` 里加上该字段:

```ts
  const mcpConfigPath = process.env.BIG_PPT_MCP_CONFIG
    ? path.resolve(process.env.BIG_PPT_MCP_CONFIG)
    : path.join(root, 'packages/agent/data/mcp.json')
  cached = {
    root,
    slidesPath,
    slidesBak: `${slidesPath}.bak`,
    templatesDir,
    logsDir,
    mcpConfigPath,
  }
```

- [ ] **Step 4.2 — 建目录 + `data/.gitignore`**

```bash
mkdir -p packages/agent/data
```

写 `packages/agent/data/.gitignore`(一行):

```gitignore
mcp.json
```

> `.gitignore` 本身会被追踪,天然保证目录存在于 git history。`mcp.json` 首次启动时自动 seed 生成,被此规则忽略。

- [ ] **Step 4.3 — `types.ts`**

```ts
// packages/agent/src/mcp-server-repo/types.ts
import type { McpServerConfig } from '@big-ppt/shared'

export type { McpServerConfig }

export interface McpServerRepo {
  list(): Promise<McpServerConfig[]>
  get(id: string): Promise<McpServerConfig | undefined>
  create(config: McpServerConfig): Promise<void>
  update(id: string, patch: Partial<McpServerConfig>): Promise<McpServerConfig>
  delete(id: string): Promise<void>
}
```

- [ ] **Step 4.4 — `presets.ts`(4 个智谱 MCP)**

```ts
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
```

- [ ] **Step 4.5 — 写失败测试 `test/mcp-server-repo.test.ts`**

```ts
// packages/agent/test/mcp-server-repo.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonFileRepo } from '../src/mcp-server-repo/json-file-repo.js'
import { PRESET_MCP_SERVERS } from '../src/mcp-server-repo/presets.js'

let tmpFile: string

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-repo-'))
  tmpFile = path.join(dir, 'mcp.json')
})

afterEach(() => {
  try { fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }) } catch {}
})

describe('JsonFileRepo', () => {
  it('首次读不存在的文件会 seed 预置目录', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const list = await repo.list()
    expect(list).toHaveLength(PRESET_MCP_SERVERS.length)
    expect(list.map((c) => c.id).sort()).toEqual(PRESET_MCP_SERVERS.map((c) => c.id).sort())
    expect(fs.existsSync(tmpFile)).toBe(true)
  })

  it('get 返回指定 id', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const cfg = await repo.get('zhipu-web-search')
    expect(cfg?.displayName).toBe('联网搜索(智谱)')
  })

  it('create 新增自定义 server,list 能看到', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await repo.create({
      id: 'my-mcp',
      displayName: 'Mine',
      description: '',
      url: 'https://x.example/mcp',
      headers: { Authorization: 'Bearer k' },
      enabled: true,
      preset: false,
    })
    const list = await repo.list()
    expect(list.find((c) => c.id === 'my-mcp')?.enabled).toBe(true)
  })

  it('create 重复 id 抛错', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await expect(
      repo.create({
        id: 'zhipu-web-search',
        displayName: 'Dup',
        description: '',
        url: 'x',
        headers: {},
        enabled: false,
        preset: false,
      }),
    ).rejects.toThrow(/already exists/i)
  })

  it('update 合并 patch 并返回新配置', async () => {
    const repo = new JsonFileRepo(tmpFile)
    const updated = await repo.update('zhipu-web-search', {
      enabled: true,
      headers: { Authorization: 'Bearer abc' },
    })
    expect(updated.enabled).toBe(true)
    expect(updated.headers.Authorization).toBe('Bearer abc')
    expect((await repo.get('zhipu-web-search'))!.enabled).toBe(true)
  })

  it('update 不存在的 id 抛错', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await expect(repo.update('nope', { enabled: true })).rejects.toThrow(/not found/i)
  })

  it('delete 非预置,预置不能删', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await repo.create({
      id: 'to-delete',
      displayName: 'D',
      description: '',
      url: 'x',
      headers: {},
      enabled: false,
      preset: false,
    })
    await repo.delete('to-delete')
    expect(await repo.get('to-delete')).toBeUndefined()
    await expect(repo.delete('zhipu-web-search')).rejects.toThrow(/preset/i)
  })

  it('并发 5 个 update 最终状态一致', async () => {
    const repo = new JsonFileRepo(tmpFile)
    await Promise.all([
      repo.update('zhipu-web-search', { displayName: '一' }),
      repo.update('zhipu-web-search', { displayName: '二' }),
      repo.update('zhipu-web-search', { displayName: '三' }),
      repo.update('zhipu-web-search', { displayName: '四' }),
      repo.update('zhipu-web-search', { displayName: '五' }),
    ])
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'))
    expect(raw.find((c: any) => c.id === 'zhipu-web-search').displayName).toMatch(/[一二三四五]/)
  })

  it('持久化:第二个 repo 实例读得到第一个 repo 的写', async () => {
    const a = new JsonFileRepo(tmpFile)
    await a.update('zhipu-web-search', { enabled: true })
    const b = new JsonFileRepo(tmpFile)
    expect((await b.get('zhipu-web-search'))!.enabled).toBe(true)
  })
})
```

- [ ] **Step 4.6 — 确认测试失败**

Run: `pnpm exec vitest run test/mcp-server-repo.test.ts --project=@big-ppt/agent`
Expected: FAIL,找不到 `json-file-repo.js`。

- [ ] **Step 4.7 — 实现 `json-file-repo.ts`**

```ts
// packages/agent/src/mcp-server-repo/json-file-repo.ts
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import type { McpServerConfig } from '@big-ppt/shared'
import type { McpServerRepo } from './types.js'
import { PRESET_MCP_SERVERS } from './presets.js'

export class JsonFileRepo implements McpServerRepo {
  /** 串行化写入,避免并发 patch 相互覆盖 */
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<McpServerConfig[]> {
    return this.load()
  }

  async get(id: string): Promise<McpServerConfig | undefined> {
    return (await this.load()).find((c) => c.id === id)
  }

  async create(config: McpServerConfig): Promise<void> {
    await this.enqueueWrite(async (all) => {
      if (all.some((c) => c.id === config.id)) {
        throw new Error(`MCP server ${config.id} already exists`)
      }
      // TODO(phase-5): encrypt config.headers before writing
      all.push(config)
      return all
    })
  }

  async update(id: string, patch: Partial<McpServerConfig>): Promise<McpServerConfig> {
    let result!: McpServerConfig
    await this.enqueueWrite(async (all) => {
      const idx = all.findIndex((c) => c.id === id)
      if (idx < 0) throw new Error(`MCP server ${id} not found`)
      // TODO(phase-5): encrypt patch.headers before writing
      const merged: McpServerConfig = {
        ...all[idx]!,
        ...patch,
        id: all[idx]!.id, // id 不允许改
        preset: all[idx]!.preset, // preset 不允许改
        headers: patch.headers ?? all[idx]!.headers,
      }
      all[idx] = merged
      result = merged
      return all
    })
    return result
  }

  async delete(id: string): Promise<void> {
    await this.enqueueWrite(async (all) => {
      const idx = all.findIndex((c) => c.id === id)
      if (idx < 0) return all
      if (all[idx]!.preset) throw new Error('cannot delete preset MCP server')
      all.splice(idx, 1)
      return all
    })
  }

  // ---- 内部 ----

  private enqueueWrite(
    mutator: (all: McpServerConfig[]) => Promise<McpServerConfig[]> | McpServerConfig[],
  ): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const all = await this.load()
      const updated = await mutator(all)
      await this.persist(updated)
    })
    // 队列不能因为一次失败就卡死:失败路径上用 catch 吞掉传播,下一次独立开始
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  private async load(): Promise<McpServerConfig[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('mcp.json must be an array')
      return parsed as McpServerConfig[]
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // 首次启动:seed 预置并落盘,之后 load 能正常走
        const seed = structuredClone(PRESET_MCP_SERVERS)
        await this.persist(seed)
        return seed
      }
      throw err
    }
  }

  private async persist(all: McpServerConfig[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf-8')
    // rename 在同一 FS 下原子
    try {
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      // Windows 上如果目标被占用会失败,fallback copy+unlink
      fsSync.copyFileSync(tmp, this.filePath)
      fsSync.unlinkSync(tmp)
      void err
    }
  }
}
```

- [ ] **Step 4.8 — `index.ts` 导出单例**

```ts
// packages/agent/src/mcp-server-repo/index.ts
import { JsonFileRepo } from './json-file-repo.js'
import type { McpServerRepo } from './types.js'
import { getPaths } from '../workspace.js'

let instance: McpServerRepo | null = null

export function getRepo(): McpServerRepo {
  if (!instance) {
    instance = new JsonFileRepo(getPaths().mcpConfigPath)
  }
  return instance
}

/** 仅测试用 */
export function __resetRepoForTesting(): void {
  instance = null
}

export type { McpServerRepo, McpServerConfig } from './types.js'
```

- [ ] **Step 4.9 — 跑测试确认全绿**

Run: `pnpm exec vitest run test/mcp-server-repo.test.ts --project=@big-ppt/agent`
Expected: 9 PASS。

- [ ] **Step 4.10 — commit**

```bash
git add packages/agent/src/mcp-server-repo/ packages/agent/src/workspace.ts packages/agent/data/ packages/agent/test/mcp-server-repo.test.ts
git commit -m "feat(agent): 新增 McpServerRepo(JsonFileRepo 实现 + 预置智谱 4 MCP seed)"
```

---

### Task 5:`McpRegistry`(SDK session 管理 + 工具注入)

**Files:**
- Modify: [packages/agent/package.json](../../packages/agent/package.json)
- Create: `packages/agent/src/mcp-registry/session.ts`
- Create: `packages/agent/src/mcp-registry/registry.ts`
- Create: `packages/agent/src/mcp-registry/index.ts`
- Modify: [packages/agent/src/index.ts](../../packages/agent/src/index.ts)
- Create: `packages/agent/test/mcp-registry.test.ts`

- [ ] **Step 5.1 — 对齐 SDK API**

查 context7 或 https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md 确认:

- `new Client({ name, version }, { capabilities: {} })` 与 `client.connect(transport)` 签名
- `StreamableHTTPClientTransport` 的构造:`new StreamableHTTPClientTransport(url: URL, opts?: { requestInit?: RequestInit; ... })`
- `client.listTools()` 返回 `{ tools: Array<{ name, description?, inputSchema: JsonSchema }> }`
- `client.callTool({ name, arguments })` 返回 `{ content: Array<{ type: 'text'|'image'|..., text?, data?, mimeType? }>, isError?: boolean }`
- `client.close()` 存在

若签名与本 plan 中示例不一致,以 SDK 文档为准修正下面几步的类型注解和调用参数。

- [ ] **Step 5.2 — 安装 SDK**

```bash
pnpm -F @big-ppt/agent add @modelcontextprotocol/sdk
```

校验:

```bash
pnpm -F @big-ppt/agent ls @modelcontextprotocol/sdk
```

Expected: 打出版本号。

- [ ] **Step 5.3 — 写失败测试 `test/mcp-registry.test.ts`(mock sdk)**

```ts
// packages/agent/test/mcp-registry.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@big-ppt/shared'
import { __resetRegistry, getTool, hasTool, listTools } from '../src/tools/registry.js'

// ---- mock @modelcontextprotocol/sdk ----
// vi.mock 工厂会被 hoist 到文件顶部,普通 const 变量在那时尚未初始化,
// 必须用 vi.hoisted() 把 mock 句柄一起提升,工厂闭包才能取到。
const mocks = vi.hoisted(() => ({
  listTools: vi.fn(),
  callTool: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor(public meta: unknown, public caps: unknown) {}
    connect = mocks.connect
    listTools = mocks.listTools
    callTool = mocks.callTool
    close = mocks.close
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(public url: URL, public opts: unknown) {}
  },
}))

// 被测模块必须在 vi.mock 之后 import
const { McpRegistry } = await import('../src/mcp-registry/registry.js')

// ---- fake repo ----
class FakeRepo {
  constructor(private servers: McpServerConfig[]) {}
  list = async () => this.servers
  get = async (id: string) => this.servers.find((s) => s.id === id)
  create = async () => { throw new Error('not used') }
  update = async () => { throw new Error('not used') }
  delete = async () => { throw new Error('not used') }
}

function mkConfig(over: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv',
    displayName: 'S',
    description: '',
    url: 'https://x.example/mcp',
    headers: {},
    enabled: true,
    preset: false,
    ...over,
  }
}

beforeEach(() => {
  mocks.listTools.mockReset()
  mocks.callTool.mockReset()
  mocks.connect.mockReset()
  mocks.close.mockReset()
  __resetRegistry()
})
afterEach(() => {
  __resetRegistry()
})

describe('McpRegistry.initialize', () => {
  it('enabled=true 的 server connect 成功后,工具以 mcp__<id>__<tool> 注入 tool-registry', async () => {
    mocks.connect.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [
        { name: 'search', description: '搜索', inputSchema: { type: 'object', properties: {} } },
      ],
    })
    const repo = new FakeRepo([mkConfig({ id: 'zhipu-web-search' })])
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(hasTool('mcp__zhipu-web-search__search')).toBe(true)
    expect(registry.getStatus('zhipu-web-search').state).toBe('ok')
    expect(registry.getStatus('zhipu-web-search').toolCount).toBe(1)
  })

  it('enabled=false 的 server 不 connect', async () => {
    const repo = new FakeRepo([mkConfig({ enabled: false })])
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(registry.getStatus('srv').state).toBe('disabled')
    expect(listTools()).toEqual([])
  })

  it('一个 server connect 失败不影响其他 server', async () => {
    mocks.connect
      .mockRejectedValueOnce(new Error('401 Unauthorized'))
      .mockResolvedValueOnce(undefined)
    mocks.listTools.mockResolvedValue({ tools: [] })
    const repo = new FakeRepo([
      mkConfig({ id: 'bad', enabled: true }),
      mkConfig({ id: 'good', enabled: true }),
    ])
    const registry = new McpRegistry(repo as any)
    await registry.initialize()
    expect(registry.getStatus('bad').state).toBe('error')
    expect(registry.getStatus('bad').error).toMatch(/401/)
    expect(registry.getStatus('good').state).toBe('ok')
  })
})

describe('McpRegistry.sync', () => {
  it('启用时增量 connect + 注入工具', async () => {
    mocks.connect.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([]) as any)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch')).toBe(false)
    await registry.sync(mkConfig({ id: 'srv', enabled: true }))
    expect(hasTool('mcp__srv__fetch')).toBe(true)
  })

  it('禁用时 close + 注销工具', async () => {
    mocks.connect.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()
    expect(hasTool('mcp__srv__fetch')).toBe(true)
    await registry.sync(mkConfig({ id: 'srv', enabled: false }))
    expect(hasTool('mcp__srv__fetch')).toBe(false)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(registry.getStatus('srv').state).toBe('disabled')
  })
})

describe('McpRegistry callTool 委派', () => {
  it('通过 tool-registry 调用 mcp__srv__fetch 会落到 session.callTool', async () => {
    mocks.connect.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello from mcp' }],
      isError: false,
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()

    const tool = getTool('mcp__srv__fetch')!
    const out = await tool.exec({ url: 'https://x' })
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(true)
    expect(parsed.result).toContain('hello from mcp')
    expect(mocks.callTool).toHaveBeenCalledWith({ name: 'fetch', arguments: { url: 'https://x' } })
  })

  it('isError=true 时 result.success=false', async () => {
    mocks.connect.mockResolvedValue(undefined)
    mocks.listTools.mockResolvedValue({
      tools: [{ name: 'fetch', inputSchema: { type: 'object', properties: {} } }],
    })
    mocks.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'upstream 500' }],
      isError: true,
    })
    const registry = new McpRegistry(new FakeRepo([mkConfig({ id: 'srv' })]) as any)
    await registry.initialize()

    const out = await getTool('mcp__srv__fetch')!.exec({})
    expect(JSON.parse(out).success).toBe(false)
  })
})
```

- [ ] **Step 5.4 — 确认测试失败**

Run: `pnpm exec vitest run test/mcp-registry.test.ts --project=@big-ppt/agent`
Expected: FAIL(模块不存在)。

- [ ] **Step 5.5 — 实现 `session.ts`**

```ts
// packages/agent/src/mcp-registry/session.ts
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'

/** MCP 会话的最小抽象:connect -> listTools -> callTool -> close */
export interface McpToolDef {
  name: string
  description?: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
}

export class McpSession {
  private client: unknown = null
  tools: McpToolDef[] = []
  status: McpServerStatus = { state: 'disabled' }

  constructor(public readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    this.status = { state: 'connecting' }
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      )
      const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: { headers: this.config.headers },
      })
      const client: any = new Client(
        { name: 'big-ppt-agent', version: '0.1.0' },
        { capabilities: {} },
      )
      await client.connect(transport)
      const res: { tools: McpToolDef[] } = await client.listTools()
      this.tools = res.tools ?? []
      this.client = client
      this.status = {
        state: 'ok',
        toolCount: this.tools.length,
        connectedAt: new Date().toISOString(),
      }
    } catch (err) {
      this.status = { state: 'error', error: (err as Error).message }
      this.tools = []
      this.client = null
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      return JSON.stringify({
        success: false,
        error: `MCP session ${this.config.id} 未连接:${this.status.error ?? '未知原因'}`,
      })
    }
    try {
      const res: {
        content?: Array<{ type: string; text?: string; mimeType?: string }>
        isError?: boolean
      } = await (this.client as any).callTool({ name, arguments: args })
      const parts: string[] = []
      for (const item of res.content ?? []) {
        if (item.type === 'text') parts.push(item.text ?? '')
        else if (item.type === 'image') parts.push(`[image: ${item.mimeType ?? 'image'}]`)
        else parts.push(`[${item.type}]`)
      }
      return JSON.stringify({ success: !res.isError, result: parts.join('\n') })
    } catch (err) {
      return JSON.stringify({ success: false, error: (err as Error).message })
    }
  }

  async close(): Promise<void> {
    try {
      await (this.client as any)?.close?.()
    } catch {
      // 主动关连接的失败都忽略,下一次 connect 会自建新 client
    }
    this.client = null
    this.tools = []
    this.status = { state: 'disabled' }
  }
}
```

- [ ] **Step 5.6 — 实现 `registry.ts`**

```ts
// packages/agent/src/mcp-registry/registry.ts
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'
import type { McpServerRepo } from '../mcp-server-repo/types.js'
import { register, unregister } from '../tools/registry.js'
import { McpSession } from './session.js'

export class McpRegistry {
  private sessions = new Map<string, McpSession>()

  constructor(private readonly repo: McpServerRepo) {}

  async initialize(): Promise<void> {
    const all = await this.repo.list()
    await Promise.all(all.filter((c) => c.enabled).map((c) => this.activate(c)))
  }

  /** 配置变化后同步 session + 注册表 */
  async sync(config: McpServerConfig): Promise<void> {
    const existing = this.sessions.get(config.id)
    if (existing) {
      this.unregisterSessionTools(existing)
      await existing.close()
      this.sessions.delete(config.id)
    }
    if (config.enabled) {
      await this.activate(config)
    }
  }

  getStatus(id: string): McpServerStatus {
    return this.sessions.get(id)?.status ?? { state: 'disabled' }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.unregisterSessionTools(session)
      await session.close()
    }
    this.sessions.clear()
  }

  // ---- 内部 ----

  private async activate(config: McpServerConfig): Promise<void> {
    const session = new McpSession(config)
    this.sessions.set(config.id, session)
    await session.connect()
    if (session.status.state !== 'ok') return
    for (const t of session.tools) {
      register({
        name: `mcp__${config.id}__${t.name}`,
        description: t.description,
        parameters: t.inputSchema,
        exec: async (args) => session.callTool(t.name, args),
      })
    }
  }

  private unregisterSessionTools(session: McpSession): void {
    for (const t of session.tools) {
      unregister(`mcp__${session.config.id}__${t.name}`)
    }
  }
}
```

- [ ] **Step 5.7 — 实现 `index.ts` 导出单例**

```ts
// packages/agent/src/mcp-registry/index.ts
import { getRepo } from '../mcp-server-repo/index.js'
import { McpRegistry } from './registry.js'

let instance: McpRegistry | null = null

export function getRegistry(): McpRegistry {
  if (!instance) {
    instance = new McpRegistry(getRepo())
  }
  return instance
}

export function __resetRegistryForTesting(): void {
  instance = null
}

export { McpRegistry }
```

- [ ] **Step 5.8 — agent 启动时初始化**

Edit [packages/agent/src/index.ts](../../packages/agent/src/index.ts),在 `registerLocalTools()` 之后、`serve(...)` 之前插入:

```ts
import { getRegistry } from './mcp-registry/index.js'

// ... registerLocalTools() 之后
await getRegistry()
  .initialize()
  .catch((err) => {
    console.warn('[agent] MCP registry init 部分失败,已忽略:', (err as Error).message)
  })
```

> 注意 agent 当前 `index.ts` 顶层不是 async,需要把启动流程包成 IIFE 或把 `initialize` 放在 `serve(...)` 回调里 `void getRegistry().initialize()`。选后者更稳:不阻塞 HTTP 端口开启。

具体:把 `serve(...)` 改为:

```ts
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent] listening on http://localhost:${info.port}`)
  void getRegistry()
    .initialize()
    .then(() => console.log('[agent] MCP registry initialized'))
    .catch((err) => console.warn('[agent] MCP init partial failure:', (err as Error).message))
})
```

- [ ] **Step 5.9 — 跑测试确认全绿**

Run: `pnpm exec vitest run test/mcp-registry.test.ts --project=@big-ppt/agent`
Expected: 7 PASS。

再跑全套 + build:

Run: `pnpm exec turbo run test build`
Expected: 所有 PASS,agent build 成功(注意 `@modelcontextprotocol/sdk` 被打进依赖)。

- [ ] **Step 5.10 — commit**

```bash
git add packages/agent/src/mcp-registry/ packages/agent/src/index.ts packages/agent/package.json pnpm-lock.yaml packages/agent/test/mcp-registry.test.ts
git commit -m "feat(agent): 新增 McpRegistry(SDK session 管理 + mcp__<id>__<tool> 注入)"
```

---

### Task 6:`/api/mcp/servers` CRUD 路由

**Files:**
- Create: `packages/agent/src/routes/mcp.ts`
- Modify: [packages/agent/src/index.ts](../../packages/agent/src/index.ts)
- Create: `packages/agent/test/routes-mcp.test.ts`

- [ ] **Step 6.1 — 写失败测试 `test/routes-mcp.test.ts`**

```ts
// packages/agent/test/routes-mcp.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn().mockResolvedValue(undefined)
    listTools = vi.fn().mockResolvedValue({ tools: [] })
    callTool = vi.fn().mockResolvedValue({ content: [], isError: false })
    close = vi.fn().mockResolvedValue(undefined)
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor() {}
  },
}))

const { mcp: mcpRoute } = await import('../src/routes/mcp.js')
const { __resetRepoForTesting } = await import('../src/mcp-server-repo/index.js')
const { __resetRegistryForTesting } = await import('../src/mcp-registry/index.js')
const { __resetPathsForTesting } = await import('../src/workspace.js')

function buildApp() {
  const app = new Hono()
  app.route('/api', mcpRoute)
  return app
}

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-mcp-'))
  process.env.BIG_PPT_MCP_CONFIG = path.join(tmpDir, 'mcp.json')
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_MCP_CONFIG
  __resetPathsForTesting()
  __resetRepoForTesting()
  __resetRegistryForTesting()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/mcp/servers', () => {
  it('返回预置 4 个 + status', async () => {
    const res = await buildApp().request('/api/mcp/servers')
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.servers.map((s: any) => s.id).sort()).toEqual([
      'zhipu-vision',
      'zhipu-web-reader',
      'zhipu-web-search',
      'zhipu-zread',
    ])
    for (const s of json.servers) expect(s.status.state).toBe('disabled')
  })
})

describe('POST /api/mcp/servers', () => {
  it('新增自定义 server 成功', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c.example/mcp' }),
    })
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers')).json()
    expect(list.servers.some((s: any) => s.id === 'custom' && s.preset === false)).toBe(true)
  })

  it('重复 id 返回 409', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'zhipu-web-search', displayName: 'Dup', url: 'https://x' }),
    })
    expect(res.status).toBe(409)
  })

  it('缺字段返回 400', async () => {
    const res = await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/mcp/servers/:id', () => {
  it('enabled=true 触发 registry 激活', async () => {
    const res = await buildApp().request('/api/mcp/servers/zhipu-web-search', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, headers: { Authorization: 'Bearer t' } }),
    })
    expect(res.status).toBe(200)
    const list = await (await buildApp().request('/api/mcp/servers')).json()
    const found = list.servers.find((s: any) => s.id === 'zhipu-web-search')
    expect(found.enabled).toBe(true)
    expect(found.status.state).toBe('ok')
  })
})

describe('DELETE /api/mcp/servers/:id', () => {
  it('预置返回 403', async () => {
    const res = await buildApp().request('/api/mcp/servers/zhipu-web-search', {
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  it('自定义删除成功', async () => {
    await buildApp().request('/api/mcp/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'custom', displayName: 'C', url: 'https://c' }),
    })
    const res = await buildApp().request('/api/mcp/servers/custom', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 6.2 — 确认测试失败**

Run: `pnpm exec vitest run test/routes-mcp.test.ts --project=@big-ppt/agent`
Expected: FAIL,找不到 `routes/mcp.js`。

- [ ] **Step 6.3 — 实现 `src/routes/mcp.ts`**

```ts
// packages/agent/src/routes/mcp.ts
import { Hono } from 'hono'
import type {
  CreateMcpServerRequest,
  McpServerConfig,
  UpdateMcpServerRequest,
} from '@big-ppt/shared'
import { getRepo } from '../mcp-server-repo/index.js'
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
    return c.json({ success: true, servers })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

mcp.post('/mcp/servers', async (c) => {
  try {
    const body = await c.req.json<CreateMcpServerRequest>()
    if (!body.id || !body.displayName || !body.url) {
      return c.json({ success: false, error: 'id / displayName / url 必填' }, 400)
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(body.id)) {
      return c.json({ success: false, error: 'id 只能包含字母、数字、- 和 _' }, 400)
    }
    const repo = getRepo()
    const existing = await repo.get(body.id)
    if (existing) {
      return c.json({ success: false, error: `server id 已存在: ${body.id}` }, 409)
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
    return c.json({ success: true })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

mcp.patch('/mcp/servers/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const patch = await c.req.json<UpdateMcpServerRequest>()
    const repo = getRepo()
    const registry = getRegistry()
    const updated = await repo.update(id, patch)
    await registry.sync(updated)
    return c.json({ success: true })
  } catch (err) {
    const msg = (err as Error).message
    const status = /not found/i.test(msg) ? 404 : 500
    return c.json({ success: false, error: msg }, status)
  }
})

mcp.delete('/mcp/servers/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const repo = getRepo()
    const registry = getRegistry()
    const existing = await repo.get(id)
    if (!existing) return c.json({ success: false, error: 'not found' }, 404)
    if (existing.preset) {
      return c.json({ success: false, error: '预置 MCP 不可删除,可禁用' }, 403)
    }
    await registry.sync({ ...existing, enabled: false })
    await repo.delete(id)
    return c.json({ success: true })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
```

- [ ] **Step 6.4 — 挂到 agent 启动**

Edit [packages/agent/src/index.ts](../../packages/agent/src/index.ts),追加:

```ts
import { mcp as mcpRoute } from './routes/mcp.js'
// ...
app.route('/api', mcpRoute)
```

- [ ] **Step 6.5 — 跑测试确认全绿**

Run: `pnpm exec vitest run test/routes-mcp.test.ts --project=@big-ppt/agent`
Expected: 7 PASS。

Run: `pnpm exec turbo run test`
Expected: 所有测试绿;相对 Phase 3 基线累计约 +40 条(本 Task 贡献 7 条)。

- [ ] **Step 6.6 — commit**

```bash
git add packages/agent/src/routes/mcp.ts packages/agent/src/index.ts packages/agent/test/routes-mcp.test.ts
git commit -m "feat(agent): 新增 /api/mcp/servers CRUD + 自动触发 registry.sync"
```

---

### Task 7:前端 `useMCP` + SettingsModal tabs + MCP UI + 收尾

**Files:**
- Create: `packages/creator/src/composables/useMCP.ts`
- Create: `packages/creator/src/components/MCPCatalogItem.vue`
- Create: `packages/creator/src/components/MCPCustomServer.vue`
- Modify: [packages/creator/src/components/SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue)
- Modify: [packages/creator/src/prompts/buildSystemPrompt.ts](../../packages/creator/src/prompts/buildSystemPrompt.ts)
- Modify: [docs/requirements/roadmap.md](../requirements/roadmap.md)
- Modify: [docs/plans/99-tech-debt.md](99-tech-debt.md)

- [ ] **Step 7.1 — `useMCP.ts` composable**

```ts
// packages/creator/src/composables/useMCP.ts
import { ref } from 'vue'
import type {
  CreateMcpServerRequest,
  McpServerWithStatus,
  UpdateMcpServerRequest,
} from '@big-ppt/shared'

const servers = ref<McpServerWithStatus[]>([])
const loading = ref(false)
const lastError = ref<string | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  lastError.value = null
  try {
    const res = await fetch('/api/mcp/servers')
    const json = (await res.json()) as { success: boolean; servers?: McpServerWithStatus[]; error?: string }
    if (!res.ok || !json.success || !json.servers) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    servers.value = json.servers
  } catch (err) {
    lastError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function create(req: CreateMcpServerRequest): Promise<void> {
  const res = await fetch('/api/mcp/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

async function update(id: string, patch: UpdateMcpServerRequest): Promise<void> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

async function remove(id: string): Promise<void> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`)
  await refresh()
}

export function useMCP() {
  return { servers, loading, lastError, refresh, create, update, remove }
}
```

- [ ] **Step 7.2 — `MCPCatalogItem.vue`(预置卡片)**

```vue
<!-- packages/creator/src/components/MCPCatalogItem.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'

const props = defineProps<{ server: McpServerWithStatus; llm: LLMSettings }>()
const emit = defineEmits<{ update: [patch: UpdateMcpServerRequest] }>()

const bearerFromAuth = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : (h ?? ''))
const apiKey = ref(bearerFromAuth(props.server.headers.Authorization))
const reuseLlmKey = ref(
  apiKey.value !== '' && apiKey.value === props.llm.apiKey && props.server.id.startsWith('zhipu-'),
)

watch(
  () => props.server.headers.Authorization,
  (v) => (apiKey.value = bearerFromAuth(v)),
)

const canReuse = computed(
  () => props.server.id.startsWith('zhipu-') && props.llm.provider === 'zhipu' && !!props.llm.apiKey,
)
const effectiveKey = computed(() => (reuseLlmKey.value && canReuse.value ? props.llm.apiKey : apiKey.value))

function applyKey() {
  emit('update', {
    headers: effectiveKey.value ? { Authorization: `Bearer ${effectiveKey.value}` } : {},
  })
}

function toggleEnabled(v: boolean) {
  if (v && !effectiveKey.value) {
    alert('请先填入 API Key 或勾选"复用 LLM Key"')
    return
  }
  emit('update', {
    enabled: v,
    headers: effectiveKey.value ? { Authorization: `Bearer ${effectiveKey.value}` } : {},
  })
}

const statusText = computed(() => {
  switch (props.server.status.state) {
    case 'ok':
      return `已连接(${props.server.status.toolCount ?? 0} 个工具)`
    case 'connecting':
      return '连接中...'
    case 'error':
      return `错误:${props.server.status.error ?? ''}`
    case 'disabled':
    default:
      return '未启用'
  }
})
</script>

<template>
  <div class="mcp-card" :class="`mcp-card--${server.status.state}`">
    <div class="mcp-card__head">
      <div class="mcp-card__title">
        <span>{{ server.displayName }}</span>
        <span v-if="server.badge" class="mcp-badge">{{ server.badge }}</span>
      </div>
      <label class="mcp-switch">
        <input
          type="checkbox"
          :checked="server.enabled"
          @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ server.enabled ? '已启用' : '未启用' }}</span>
      </label>
    </div>

    <p class="mcp-card__desc">{{ server.description }}</p>

    <div class="mcp-card__form">
      <label v-if="canReuse" class="mcp-reuse">
        <input v-model="reuseLlmKey" type="checkbox" @change="applyKey" />
        复用 LLM API Key(智谱)
      </label>
      <input
        v-if="!reuseLlmKey"
        v-model="apiKey"
        type="password"
        placeholder="输入此 MCP 的 API Key"
        @blur="applyKey"
      />
    </div>

    <div class="mcp-card__status">{{ statusText }}</div>
  </div>
</template>

<style scoped>
.mcp-card { border: 1px solid #eee; border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.mcp-card--ok { border-color: #52c41a; }
.mcp-card--error { border-color: #ff4d4f; }
.mcp-card__head { display: flex; justify-content: space-between; align-items: center; }
.mcp-card__title { font-weight: 600; display: flex; gap: 8px; align-items: center; }
.mcp-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #f0f5ff; color: #1677ff; }
.mcp-card__desc { font-size: 12px; color: #666; margin: 0; }
.mcp-card__form input[type='password'] { width: 100%; padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.mcp-reuse { display: flex; gap: 6px; font-size: 12px; color: #333; }
.mcp-switch { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #333; }
.mcp-card__status { font-size: 11px; color: #999; }
.mcp-card--error .mcp-card__status { color: #ff4d4f; }
.mcp-card--ok .mcp-card__status { color: #52c41a; }
</style>
```

- [ ] **Step 7.3 — `MCPCustomServer.vue`(折叠自定义)**

```vue
<!-- packages/creator/src/components/MCPCustomServer.vue -->
<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { CreateMcpServerRequest, McpServerWithStatus } from '@big-ppt/shared'

const props = defineProps<{ customServers: McpServerWithStatus[] }>()
const emit = defineEmits<{
  create: [req: CreateMcpServerRequest]
  remove: [id: string]
}>()

const expanded = ref(false)
const form = reactive<CreateMcpServerRequest>({
  id: '',
  displayName: '',
  description: '',
  url: '',
  headers: {},
})
const headerKey = ref('')
const headerValue = ref('')

function addHeader() {
  if (!headerKey.value) return
  form.headers = { ...(form.headers ?? {}), [headerKey.value]: headerValue.value }
  headerKey.value = ''
  headerValue.value = ''
}

function submit() {
  if (!form.id || !form.displayName || !form.url) {
    alert('id / 名称 / URL 三项必填')
    return
  }
  emit('create', { ...form })
  form.id = ''
  form.displayName = ''
  form.description = ''
  form.url = ''
  form.headers = {}
}
</script>

<template>
  <div class="mcp-custom">
    <button class="mcp-custom__toggle" @click="expanded = !expanded">
      {{ expanded ? '▼' : '▶' }} 自定义 MCP Server(进阶)
    </button>
    <div v-if="expanded" class="mcp-custom__body">
      <div class="mcp-custom__list">
        <div v-for="srv in customServers" :key="srv.id" class="mcp-custom__row">
          <span>{{ srv.displayName }}</span>
          <code>{{ srv.url }}</code>
          <button @click="emit('remove', srv.id)">删除</button>
        </div>
        <div v-if="customServers.length === 0" class="mcp-custom__empty">尚未添加自定义 MCP</div>
      </div>

      <div class="mcp-custom__form">
        <input v-model="form.id" placeholder="id(字母/数字/-/_)" />
        <input v-model="form.displayName" placeholder="显示名" />
        <input v-model="form.url" placeholder="https://your-mcp/endpoint/mcp" />
        <input v-model="form.description" placeholder="说明(可选)" />
        <div class="mcp-custom__headers">
          <input v-model="headerKey" placeholder="Header Name" />
          <input v-model="headerValue" placeholder="Header Value" />
          <button @click="addHeader">+ 添加 Header</button>
        </div>
        <div v-for="(v, k) in form.headers" :key="k" class="mcp-custom__header-row">
          <span>{{ k }}:{{ v }}</span>
        </div>
        <button class="mcp-custom__submit" @click="submit">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-custom { border-top: 1px dashed #eee; padding-top: 12px; }
.mcp-custom__toggle { border: none; background: none; cursor: pointer; font-size: 13px; color: #666; padding: 0; }
.mcp-custom__body { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
.mcp-custom__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.mcp-custom__row code { color: #666; flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mcp-custom__empty { color: #999; font-size: 12px; }
.mcp-custom__form { display: flex; flex-direction: column; gap: 6px; }
.mcp-custom__form input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.mcp-custom__headers { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; }
.mcp-custom__header-row { font-size: 11px; color: #666; }
.mcp-custom__submit { padding: 6px 12px; background: #1677ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
</style>
```

- [ ] **Step 7.4 — `SettingsModal.vue` 改为 tabs**

用以下内容完整替换 [packages/creator/src/components/SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue):

```vue
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'
import { useMCP } from '../composables/useMCP'
import MCPCatalogItem from './MCPCatalogItem.vue'
import MCPCustomServer from './MCPCustomServer.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const PROVIDERS = [
  { key: 'zhipu', name: '智谱 (GLM)', defaultModel: 'GLM-5.1' },
  { key: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat' },
  { key: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o' },
  { key: 'moonshot', name: 'Moonshot (Kimi)', defaultModel: 'moonshot-v1-8k' },
  { key: 'qwen', name: '千问 (Qwen)', defaultModel: 'qwen-plus' },
  { key: 'custom', name: '自定义', defaultModel: '' },
]

const activeTab = ref<'llm' | 'mcp'>('llm')
const settings = ref<LLMSettings>(loadSettings())
const { servers, refresh, create, update, remove } = useMCP()

const presetServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => s.preset))
const customServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => !s.preset))

function loadSettings(): LLMSettings {
  const raw = localStorage.getItem('llm-settings')
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {}
  }
  return { provider: 'zhipu', apiKey: '', model: 'GLM-5.1' }
}

function onProviderChange() {
  const p = PROVIDERS.find((p) => p.key === settings.value.provider)
  if (p && p.defaultModel) settings.value.model = p.defaultModel
}

function saveLlm() {
  localStorage.setItem('llm-settings', JSON.stringify(settings.value))
  emit('update:open', false)
}

function close() {
  emit('update:open', false)
}

async function handleUpdate(id: string, patch: UpdateMcpServerRequest) {
  try {
    await update(id, patch)
  } catch (err) {
    alert(`MCP 更新失败:${(err as Error).message}`)
  }
}

async function handleCreate(req: Parameters<typeof create>[0]) {
  try {
    await create(req)
  } catch (err) {
    alert(`创建失败:${(err as Error).message}`)
  }
}

async function handleRemove(id: string) {
  if (!confirm('确认删除此自定义 MCP?')) return
  try {
    await remove(id)
  } catch (err) {
    alert(`删除失败:${(err as Error).message}`)
  }
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      settings.value = loadSettings()
      await refresh()
    }
  },
)

onMounted(() => {
  void refresh()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h3>设置</h3>
          <button class="close-btn" @click="close">&times;</button>
        </div>

        <div class="modal-tabs">
          <button :class="{ active: activeTab === 'llm' }" @click="activeTab = 'llm'">LLM</button>
          <button :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'">
            MCP Servers
            <span v-if="servers.filter((s) => s.enabled).length > 0" class="mcp-count">
              {{ servers.filter((s) => s.enabled).length }}
            </span>
          </button>
        </div>

        <div v-if="activeTab === 'llm'" class="modal-body">
          <div class="form-group">
            <label>API 提供商</label>
            <select v-model="settings.provider" @change="onProviderChange">
              <option v-for="p in PROVIDERS" :key="p.key" :value="p.key">{{ p.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input v-model="settings.apiKey" type="password" placeholder="输入你的 API Key" />
          </div>
          <div class="form-group">
            <label>模型</label>
            <input v-model="settings.model" type="text" placeholder="模型名称" />
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">取消</button>
            <button class="btn-primary" @click="saveLlm">保存</button>
          </div>
        </div>

        <div v-else class="modal-body">
          <MCPCatalogItem
            v-for="srv in presetServers"
            :key="srv.id"
            :server="srv"
            :llm="settings"
            @update="handleUpdate(srv.id, $event)"
          />
          <MCPCustomServer
            :custom-servers="customServers"
            @create="handleCreate"
            @remove="handleRemove"
          />
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #fff; border-radius: 12px; width: 520px; max-width: 92vw; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 6px 24px rgba(0,0,0,0.15); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #f0f0f0; }
.modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.close-btn { border: none; background: none; font-size: 20px; cursor: pointer; color: #999; }
.close-btn:hover { color: #333; }
.modal-tabs { display: flex; border-bottom: 1px solid #f0f0f0; }
.modal-tabs button { flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-size: 13px; color: #666; display: flex; align-items: center; justify-content: center; gap: 6px; }
.modal-tabs button.active { color: #1677ff; border-bottom: 2px solid #1677ff; }
.mcp-count { font-size: 11px; background: #1677ff; color: #fff; padding: 1px 6px; border-radius: 8px; }
.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 13px; font-weight: 500; color: #333; }
.form-group input, .form-group select { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; outline: none; }
.form-group input:focus, .form-group select:focus { border-color: #1677ff; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; border-top: 1px solid #f0f0f0; margin-top: auto; }
.btn-secondary { padding: 6px 16px; border: 1px solid #d9d9d9; border-radius: 6px; background: #fff; cursor: pointer; font-size: 14px; }
.btn-primary { padding: 6px 16px; border: none; border-radius: 6px; background: #1677ff; color: #fff; cursor: pointer; font-size: 14px; }
.btn-primary:hover { background: #4096ff; }
</style>
```

- [ ] **Step 7.5 — `buildSystemPrompt.ts` 升级签名(动态注入留 Phase 4)**

只改函数签名与框架,**原 130 行提示词字符串一字不动**,仅在末尾按 `mcpBadges` 条件拼接一段扩展说明。

具体做法:打开 [packages/creator/src/prompts/buildSystemPrompt.ts](../../packages/creator/src/prompts/buildSystemPrompt.ts),把第一行

```ts
export function buildSystemPrompt(): string {
  return `你是一个专业的幻灯片生成助手，...`   // 原长字符串
}
```

改为:

```ts
export function buildSystemPrompt(mcpBadges?: string[]): string {
  const base = `你是一个专业的幻灯片生成助手，...`   // 原长字符串,一字不动
  if (!mcpBadges || mcpBadges.length === 0) return base
  return base + `

## 扩展工具(MCP)

除了本地幻灯片工具,你现在还可以调用以下类别的外部工具:${mcpBadges.join('、')}。

- 当需要获取时效信息(新闻、最新数据)时,优先用"搜索"类工具
- 抓取特定 URL 的网页正文,用"读网页"类工具
- 这些工具的名字都带 \`mcp__\` 前缀,参数以模型收到的 schema 为准
`
}
```

即把原先的 `return \`...\`` 改名为 `const base = \`...\``,然后追加条件分支。

**消费端不动**:[useAIChat.ts](../../packages/creator/src/composables/useAIChat.ts) 调用 `buildSystemPrompt()` 的两处维持无参调用(`messages.ref([{ role: 'system', content: buildSystemPrompt() }])` + `clearHistory` 里那一处)。Phase 3.5 MVP 不做动态 badges 注入,以免污染提示词稳定性。Phase 4 再改 useAIChat 传入 `mcpBadges` 参数即可。

- [ ] **Step 7.6 — build + 启动 dev 做 E2E 验收**

Run: `pnpm exec turbo run build`
Expected: 全绿。

Run: `pnpm dev`(agent :4000 / creator :3030 / slidev :3031)

手测清单:

1. 打开 http://localhost:3030,点"设置",看到 tabs "LLM" / "MCP Servers"
2. MCP tab 内展示 4 个预置卡片(禁用态)
3. 填入智谱 key(或勾选"复用 LLM Key",若 LLM provider=zhipu),启用"联网搜索"
4. agent 日志出现 `[agent] MCP registry initialized` 后续的 PATCH 调用成功
5. `curl http://localhost:4000/api/mcp/servers | jq '.servers[] | select(.enabled==true)'` 应看到 status.state=ok
6. `curl http://localhost:4000/api/tools | jq '.tools | map(.function.name) | sort'` 应包含 `mcp__zhipu-web-search__*`(具体 tool 名以 MCP server 返回为准)
7. 在 chat 里问"2025 年 10 月 OpenAI 发布了什么新模型?",LLM 应调用 `mcp__zhipu-web-search__*` 工具,ThoughtChain 正常渲染,最终总结有实时信息
8. 关闭启用开关 → `curl /api/tools` 应不再含 `mcp__zhipu-web-search__*`
9. 添加自定义 MCP:id=`demo-mcp`,URL 随便填个不存在的,观察 status.state=error + 错误文本回显在卡片上,不阻塞其他 MCP

- [ ] **Step 7.7 — 更新 `docs/requirements/roadmap.md`**

在路线图变更记录表追加一行(**日期字段用执行当天的 YYYY-MM-DD**,命令:`date +%Y-%m-%d`):

```md
| <YYYY-MM-DD> | Phase 3.5 关闭:MCP 集成 + 本地工具 register 进 agent registry + 前端 GET /api/tools 动态化 | 按 07-mcp-integration.md 执行完成,P1-2 完全清零 |
```

同时在"Phase 3.5:MCP 集成"(若路线图没独立段落,则在 Phase 3 与 Phase 4 之间补一段,标题用 `## Phase 3.5:MCP 集成 ✅`)位置标"**状态**:已完成",链到 07 文件。本计划不单独出关闭报告(工作量小于 Phase 3),07 文件末尾的"验收条件"即是关闭证据。

- [ ] **Step 7.8 — 更新 `docs/plans/99-tech-debt.md`**

找到 P1-2 那条,把"骨架部分,2026-04-21 清"改写为"✅(2026-04-XX 完全清零)",并追加"实际修复"段:

```md
**实际修复(完全)**:Phase 3.5 按 [07-mcp-integration.md](07-mcp-integration.md) 执行完成:
- 本地 5 工具 `registerLocalTools()` 注册进 `tool-registry`
- agent 新增 `GET /api/tools` / `POST /api/call-tool`,前端 `useAIChat` 动态拉工具列表,`executeTool` 收敛为一行 fetch
- MCP HTTP client 以 `mcp__<serverId>__<toolName>` 命名动态注入 registry;`McpServerRepo` 抽象(JsonFileRepo 实现)为 Phase 5 DB 留迁移口
```

也把 P3-5(命名空间)一并标 ✅,并注明"Phase 3.5 已落定 `mcp__<id>__<tool>` 规范"。

总览表里 P1 从"已清 4,P1-5 延到 Phase 4"改为"已清 4,P1-5 延到 Phase 4(P1-2 Phase 3.5 完全清零)"。

- [ ] **Step 7.9 — commit 收尾**

```bash
git add packages/creator/src/ packages/creator/test/ docs/requirements/roadmap.md docs/plans/99-tech-debt.md
git commit -m "feat(creator+docs): MCP Settings UI + useMCP CRUD,关闭 Phase 3.5"
```

---

## 验收条件(全部满足才算 Phase 3.5 关闭)

- [ ] `pnpm exec turbo run test` 全绿;agent 新增测试约 30 条(tools-local + routes-tools + repo + registry + routes-mcp + unregister)
- [ ] `pnpm exec turbo run build` 全绿;`@modelcontextprotocol/sdk` 成功被打进 agent 依赖
- [ ] `pnpm exec turbo run lint` 0 errors
- [ ] 前端 `packages/creator/src/prompts/tools.ts` 已删除;grep 无残留 import
- [ ] `curl :4000/api/tools` 返回本地 5 工具 +(启用时)MCP 工具
- [ ] `curl :4000/api/mcp/servers` 首次启动自动 seed 出预置 4 条(disabled)
- [ ] PATCH `/api/mcp/servers/:id {enabled:true, headers:{Authorization:"Bearer ..."}}` 触发 session 激活,GET `/api/tools` 立即包含新工具
- [ ] DELETE 预置返回 403;DELETE 自定义成功
- [ ] 浏览器端 SettingsModal 能看到 tabs / 预置卡片 / 自定义折叠表单,启停 MCP 后工具调用真实生效(手测清单 E2E 全过)
- [ ] roadmap.md + 99-tech-debt.md 已同步更新 Phase 3.5 为"已完成" / P1-2 完全清零 / P3-5 ✅

## 不做什么(再次围栏,防 scope creep)

- ❌ 工具拆分(`create_slide/update_slide/...`)—— Phase 4
- ❌ `slides.md` 架构升级(global.css / layouts)—— Phase 4
- ❌ `slides.md.history/` 环形缓冲 —— Phase 4
- ❌ SQLite / Drizzle / 用户系统 / API key 后端化 —— Phase 5
- ❌ MCP stdio / SSE transport —— 保持只 Streamable HTTP
- ❌ MCP server 健康心跳 —— 被动式,下次 callTool 失败时自动标 error

## 关闭后下一步

1. 打开 Phase 4 计划(新建 `docs/plans/08-phase4-editor.md`):工具拆分 + slides.md 架构升级 + undo 环形缓冲 + design tokens
2. Phase 5(用户系统 + DB)动工时,把 `JsonFileRepo` 换成 `DrizzleRepo(mcp_servers 表)`,同步给 headers/apiKey 列加密;本计划的 `McpRegistry` / 路由 / 前端 useMCP 一行不改

---

**执行约定(复述)**:
- TDD:每 Task 先写失败测试再写实现
- 中文 commit message
- 每 Task 一个 commit
- 遇到 MCP SDK 签名与本文档示例不符,以 SDK README 为准,修改实现 + 测试保持一致

---

## 执行期偏离（关闭后追加）

- **MCP headers 落地为明文**：原 plan 没强调加密，实施期决定先明文落 `data/mcp.json`，**Phase 5 的 P2-4 task 升级为 AES-256-GCM 加密**（已闭环，commit `a155c5c`）
- **`/api/mcp/servers` 漏 `requireAuth`**：原 plan 没强调，实施期当作内部 API 直接放开；Phase 5 P2-4 顺带补上 `requireAuth` + GET 脱敏 + PATCH 支持 `***` 保留旧值（一并修了未登录可读 token 漏洞）

---

## 踩坑与解决

### 坑 1：MCP server headers 明文存储 = 凭据泄露漏洞

- **症状**：`data/mcp.json` 明文存 Bearer token / API key；任何人能 access 到该文件就拿到所有用户的 MCP 凭据
- **根因**：本 Phase plan 没把"凭据加密"作为 MVP 范围
- **修复**：Phase 5 的 P2-4 task — `JsonFileRepo` 升级 AES-256-GCM 加密 headers value；master key 走 `APIKEY_MASTER_KEY` env；`/api/mcp/servers` GET 脱敏（敏感 header 显示 `***`），PATCH 支持 `***` 保留旧值
- **防再犯**：所有"用户上传的凭据"必须走加密存储；新增类似字段时先加密再存
- **已提炼到 CLAUDE.md**：是（已纳入"安全与提交规则"）

### 坑 2：`/api/mcp/servers` 未登录可读 token

- **症状**：登录前直接 GET 该路由也能拿到所有 MCP servers 含 token
- **根因**：本 Phase 实施时把它当作"内部配置 API"，没加认证
- **修复**：Phase 5 P2-4 顺带 — 路由加 `requireAuth` middleware；GET 脱敏不返回敏感 header
- **防再犯**：所有"返回用户敏感数据"的路由都必须 `requireAuth`；新建路由优先默认 require，再按需放开
- **已提炼到 CLAUDE.md**：是（已纳入"安全与提交规则"）

---

## 测试数量落地

> 本 Phase 关闭时测试基建已就位（Phase 3 留底 31 tests）。Phase 3.5 期间 agent 测试增长到约 75（Phase 4 入口数）。具体增量在 closeout 报告或 commit message 里查阅。
