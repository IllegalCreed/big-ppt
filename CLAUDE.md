# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 项目品牌：**Lumideck · 幻光千叶**。基于 Slidev 的 AI 演示文稿生成平台。

## 文档定位（动手前先认清归属）

本仓库实行严格的五层文档分工，**修改任何文档前确认对应层级**：

| 文档                        | 定位                                               |
| --------------------------- | -------------------------------------------------- |
| `CLAUDE.md`（本文件）       | 工程指南：技术栈、命令、架构、约定、坑             |
| `docs/requirements/vision.md` | 产品形态 + 商业模式畅想（不写技术）                |
| `docs/requirements/requirements.md` | 功能/需求点头脑风暴                          |
| `docs/requirements/roadmap.md`      | 需求分阶段落地规划（high-level 目标 + 验收）   |
| `docs/plans/NN-*.md`        | 具体 Phase 的实施技术细节（类名、SDK、schema），新建 plan 套用 [`_TEMPLATE.md`](docs/plans/_TEMPLATE.md) |

**反模式**：把 `--ld-*` token CSS、组件类名、SDK 名写进 vision/roadmap；把"商业模式"写进 CLAUDE.md。

## 常用命令

### 开发与构建

```bash
pnpm install                              # 首次安装（bcrypt 在 onlyBuiltDependencies，会编译）
pnpm dev                                  # turbo 并发起 creator(:3030) + agent(:4000) + slidev(:3031)
pnpm build                                # turbo 全量 build
pnpm lint                                 # 每包独立 lint
pnpm format                               # prettier 一次性格式化全仓
pnpm type-check                           # 全包 tsc --noEmit
```

### 测试与覆盖率

```bash
pnpm test                                 # 全量单测（agent + creator + shared）
pnpm -F @big-ppt/agent test:coverage      # agent 门槛 lines 90 / branches 85；安全模块 95/90 per-file
pnpm -F @big-ppt/creator test:coverage    # creator 门槛 lines 75 / branches 65
pnpm -F @big-ppt/agent vitest run path/to/file.test.ts  # 跑单个文件
pnpm -F @big-ppt/agent vitest run -t "test name"        # 按测试名过滤

pnpm -F @big-ppt/e2e install-browsers     # 首次装 Chromium
pnpm -F @big-ppt/e2e test                 # Playwright E2E（真浏览器 + 真后端 + lumideck_test 库）
```

### 数据库

```bash
pnpm -F @big-ppt/agent init-db            # 建 lumideck_dev + 用户 + 写 .env.development.local
pnpm -F @big-ppt/agent init-test-db       # 建 lumideck_test + 用户 + 写 .env.test.local
pnpm -F @big-ppt/agent db:push            # drizzle-kit push 到开发库
pnpm -F @big-ppt/agent db:push:test       # drizzle-kit push 到测试库
```

`init-db.mjs` 默认从 `packages/agent/.env.create-db.local` 读 MySQL root 凭据（参考 `.env.create-db.example`）；可用 `--root-env-file=<path>` 或 `LUMIDECK_DB_ROOT_ENV` 覆盖；或直接 `--database-url=mysql://...` 跳过 root 建库。

### 模板缩略图

```bash
pnpm gen:thumbnails                       # 新增模板后跑，playwright 自动出 PNG 入库
```

## 架构全景（多文件拼出来的）

### 包与端口

| 包               | 角色                                                                  | 端口 |
| ---------------- | --------------------------------------------------------------------- | ---- |
| `packages/creator` | Vue 3 前端 SPA：登录/注册、deck 列表、编辑器、ChatPanel + SlidePreview + Settings | 3030 |
| `packages/agent`   | Hono 后端：Auth、Deck CRUD、LLM 代理、工具执行、MCP、Slidev 反代鉴权          | 4000 |
| `packages/slidev`  | Slidev 演示框架（生产绑 127.0.0.1，由 agent 反代；模板 + 公共图表组件）         | 3031 |
| `packages/shared`  | 前后端契约 TypeScript types（直接 import 源文件，不打包）                     | —    |
| `packages/e2e`     | Playwright 端到端                                                          | —    |

### 请求流向

```
浏览器 (localhost:3030)
   │
   ├─ /api/*            ──Vite proxy──▶  agent :4000  ──▶ MySQL (lumideck_dev)
   │                                          │
   │                                          ├─ HttpOnly session cookie
   │                                          ├─ slides-store 写 packages/slidev/slides.md
   │                                          └─ tool registry（本地工具 + MCP 远端工具）
   │
   └─ /api/slidev-preview/*  ──proxy──▶  agent :4000  ──reverse-proxy──▶  slidev :3031
                                              │
                                              └─ slidev-proxy-auth：仅锁持有者放行（403）
```

### 关键模块（agent）

- `src/app.ts`：Hono app 装配，**只做路由 + middleware**，不带启动副作用。生产入口 `src/index.ts` 引用 app，再接 `http.createServer` 提供 Slidev 反代 + WebSocket upgrade。集成测靠 `app.fetch(req)` in-process 调用，无需走端口
- `src/middleware/auth.ts`：`authOptional` 解 session cookie → `ctx.var.user`；`requireAuth` 闸门
- `src/middleware/request-context.ts`：把 user/session/activeDeck 包进 `AsyncLocalStorage`，下游 `slides-store` 读
- `src/slidev-lock.ts`：**单实例占用锁是 agent 进程内存对象**（不是 DB 表），心跳 30s，超时 5min 释放（Phase 5 实施期偏离原设计）
- `src/slidev-proxy-auth.ts`：Slidev 反代鉴权，仅锁持有者能访问 `/api/slidev-preview/*`
- `src/tools/`：本地工具注册表；命名规范 `mcp__<serverId>__<toolName>`；`switch_template` 可注入 `RewriteFn` DI 便于测试
- `src/db/`：Drizzle schema；开发期用 `drizzle-kit push` 不写 migration

### 关键约定（前端）

- 所有 API 调用走 `packages/creator/src/api/`，前端**不直接 fetch**业务地址
- 状态管理：composables 模式（`composables/useAuth.ts` / `useDecks.ts` / `useSwitchTemplateJob.ts`）
- 路由：`vue-router`，登录守卫
- 组件库：`antdv-next` + `@antdv-next/x`（Bubble/Sender/ThoughtChain）；图标 `lucide-vue-next`
- E2E 与 creator 集成测要求 `vitest.config.ts` 设 `fileParallelism: false`（共享 `lumideck_test` DB 必须串行）

## 环境分层（dotenv-cli 驱动）

`packages/agent/` 下三层 env，每层都有 `.example`（入库占位符）+ `.local`（gitignored 真实值）：

| 层级        | local 文件                          | 触发命令                |
| ----------- | ----------------------------------- | ----------------------- |
| development | `.env.development.local`            | `pnpm dev`              |
| test        | `.env.test.local`                   | `pnpm test`             |
| production  | `.env.production.local`             | `pnpm start`            |

另有 `.env.create-db.local`（脚本专用，gitignored）+ `.env.create-db.example`（入库）。

## 安全与提交规则（重要，违反会出事）

- **`.env.*.local` / `*.local` 绝不进 git**：根 `.gitignore` 已全覆盖；`commit` 前**必跑** `git status` 人工确认
- **禁用 `git add -A` / `git add .`**：永远显式列文件名，避免误带敏感文件
- **commit message 使用中文**
- **不在 git 历史里出现密钥**：API key / DB 密码 / SESSION_SECRET / APIKEY_MASTER_KEY 全部走 env，绝不硬编码
- LLM API Key Phase 5 起后端化：`users.llm_settings` 字段 AES-256-GCM 加密，master key 从 `APIKEY_MASTER_KEY` env 读
- MCP server headers 同样 AES-256-GCM 加密（Phase 5 P2-4）

## 测试基建注意点

- agent 单测用 `lumideck_test` 真 MySQL，每个 `beforeEach` TRUNCATE（不用 mock DB）
- creator 集成测（`useAuth` / `useDecks` / `useSwitchTemplateJob`）走 `app.fetch` shim 进真后端：`test/_setup/integration.ts` 替换 `globalThis.fetch` 为 `app.fetch`，cookie jar 透传
- creator UI 单测保留 MSW，不改造
- E2E webServer 启动时通过 `BIG_PPT_TEST_REWRITE_MODE=skeleton` 让 `rewriteForTemplate` 跳 LLM 直接读 starter，避免 E2E 烧 token
- Slidev 在 `_test/reset-lock` 路由解 lock 跨测试污染（仅 test env 暴露）

## Slidev 包的特殊点

- `packages/slidev/slides.md` **是运行时产物**（gitignored），骨架在 `slides.example.md`，`pnpm dev` 自动 copy
- 切换 deck 时 agent 改写 `slides.md`，Slidev HMR 自动推；前端**不**调 `slideStore.refresh()`，让 Slidev 自己处理
- 模板分两套：`templates/beitou-standard/`（北投）+ `templates/jingyeda-standard/`（竞业达）；硬切无 alias
- 公共组件库（`packages/slidev/components/{grid,decoration,block,private}/`）读 `--ld-*` token（4 类 26 项，spec 见 [TOKENS.md](packages/slidev/components/TOKENS.md)）按当前模板取色；模板私有 `--bt-*` / `--jyd-*` 仅供 layer-1 layout 内部装饰使用，不对外暴露

## 已知坑

> 这一节是**精炼索引**——每条都是"未来动手前能主动绕开"的一句话规则。详细症状 / 调试故事在对应 plan 的"踩坑与解决"章节，本节只放精炼版。
>
> **提炼标准**：换个 Phase 还会再撞的工具链 / 测试基建 / 构建系统坑才上这。一次性业务 bug（写错 if、漏加 await）只留 plan 不提炼。

### 工具链 / 构建

- **bcrypt** 在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`，初装时会编译；CI 慢一点正常
- **`@antdv-next/x` 0.3** 有 Slot warning（P3-1，Phase 8 升级时复检）
- **UnoCSS presetIcons** 有图标解析 bug（P3-7），用 `scripts/gen-icons.mjs` workaround；Phase 8 复检（详见 [plan 06-monorepo](docs/plans/06-phase3-monorepo-agent.md) 踩坑 1）
- **`drizzle-kit push`** 改 schema 后，dev 与 test 库都要 push（`db:push` + `db:push:test`）

### Slidev 反代 + HMR

- **Slidev 仅 agent 反代访问**：原生端口 `:3031` 必须绑 `127.0.0.1`，不能直接对外（详见 [plan 10](docs/plans/10-phase5-user-deck-versions.md) 踩坑 1-2）
- **Slidev dev 启动必须带 `--base /api/slidev-preview/`**：否则 HTML 内绝对路径 `/@vite/client` 等全 404（[plan 10](docs/plans/10-phase5-user-deck-versions.md) 踩坑 2）
- **切换 deck / 切模板时让 Slidev HMR 自己处理**，前端**不要**调 `slideStore.refresh()`，否则会与 HMR race 触发 502（[plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 3）
- **Slidev reload 窗口（200-500ms）期间 dev server 不响应**，前端 fetch iframe URL 要先 probe-then-refresh（[plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 4）
- **Slidev `slides.md` 锁**：dev agent 重启自动复位，免手动 `activate`（[plan 10](docs/plans/10-phase5-user-deck-versions.md) 踩坑 4）

### 测试基建

- **集成测共享 lumideck_test 库**：`vitest.config.ts` 必须 `fileParallelism: false`，否则跨 spec 数据竞争（[plan 11](docs/plans/11-phase5-tests-and-env-split.md) 踩坑 1 / [plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 7D-C）
- **进程内 stateful 模块**（如 slidev-lock）必须在 test env 暴露 reset hook（如 `_test/reset-lock`），否则跨 case 污染（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 6）
- **fs 写入路径在 test env 下必须接受 env 覆盖**到临时目录，否则跑测试会污染 dev 数据（[plan 09](docs/plans/09-phase4-edit-iterate.md) 踩坑 3 / [plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 7）
- **依赖外部不稳定能力的工具走 DI seam**：如 `rewriteForTemplate` 用 `RewriteFn` interface DI 注入，测试时 mock 跑完整状态机不烧 token（[plan 12](docs/plans/12-phase6-template-architecture.md) 踩坑 2）
- **Vue Test Utils 不跨 Teleport 边界 query**：用到 `<Teleport>` 的组件单测必须加 `disableTeleport` prop（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 2）
- **E2E 跳真 LLM**：用 `BIG_PPT_TEST_REWRITE_MODE=skeleton` env 让 `rewriteForTemplate` 直接读 starter，免烧 token；playwright.config webServer env 写死该值

### 前端约定

- **API 调用一律带 `/api/` 前缀**，不能依赖 dev 模式 vite proxy 兜底（dev 跑通但 prod 挂的经典坑，[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 5）
- **Vue setup() 内派生对象一律 `computed`**，普通对象不响应式（[plan 03](docs/plans/03-chat-ui-fixes.md) 踩坑 1）
- **组件内 `setTimeout` / `setInterval` 必须在 `onUnmounted` 清理**，否则切换页面后 timer 仍跑（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 4）
- **JSDoc 注释里写代码示例时绕开 `*/` 字面量**，会提前关闭注释（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 1）

### LLM / Tool 工程

- **工具层 integer 参数走 coerce util**：GLM 等 provider 会把 `index: 4` 序列化成字符串 `"4"`，工具层必须宽容（[plan 09](docs/plans/09-phase4-edit-iterate.md) 踩坑 1）
- **AI 输出落 disk 前必做 schema validation + 自由文本字段必走白名单**（[plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 6）
- **Prompt contract test 用结构性断言不做字符级 diff**，避免文案微调红测试（[plan 12](docs/plans/12-phase6-template-architecture.md) 踩坑 1）

### 安全

- **MCP server headers / API key 等用户凭据必须 AES-256-GCM 加密落 disk**（[plan 07](docs/plans/07-mcp-integration.md) 踩坑 1）
- **所有"返回用户敏感数据"的路由默认 `requireAuth`**，再按需放开（[plan 07](docs/plans/07-mcp-integration.md) 踩坑 2）

### 跨模板共享组件

- **chart / 布局 / 媒体类公共组件 fallback 必须中性**（不写死任何模板的主色），模板独有视觉由 layout 或 token 注入（[plan 13](docs/plans/13-phase7-template-rename.md) 踩坑 2）
- **`--ld-*` token 不要在 `:root` 同时声明多套模板**：`global.css` 同时 `@import` 两套 tokens.css 时，后导入的会覆盖前者（jingyeda 覆盖 beitou → 所有 deck 都用错色）。正确做法是在每套模板的 layer-1 layout 根元素挂 `.beitou-template` / `.jingyeda-template` class，把 `--ld-*` override 写到该 class scope 里（[plan 16](docs/plans/16-phase75-template-layering.md) 踩坑）
- **markdown-it 不允许 prop 字面量跨行**：组件标签里写 `:rows='[[...],\n[...]]'` / `:sections='[{...},\n{...}]'`，markdown 解析会把跨行的 `]` / `}` 当段落分隔符截断 —— 单个数组 / 对象字面量必须**单行写完**，组件标签自身可多行（[plan 16](docs/plans/16-phase75-template-layering.md) 踩坑）
- **Slidev `--base` 前缀对绝对路径资源失效**：组件里 hardcode `/templates/X/y.png` 不会自动加 `--base /api/slidev-preview/` 前缀，dev 跑 404；用 `useTemplateAsset()` helper 或 `import.meta.env.BASE_URL` 拼前缀（[plan 16](docs/plans/16-phase75-template-layering.md) 踩坑）
- **CSS `em` 是相对自身 font-size，不是父级**：组件根上同时写 `width: 8em; font-size: 3.6em` 会让宽度变成 8 × 72px = 576px（撑出屏幕），而不是预期的 8 × 20px = 160px。把 font-size 挂到子元素上（[plan 16](docs/plans/16-phase75-template-layering.md) 踩坑）

## Skills 与 Hooks（自动行为）

`.claude/skills/` 已就绪。常见自动化：

- 用户依赖 Claude 做 Harness 架构设计 → 主动考虑边界情况
- 涉及 Slidev / Vue / Vitest / pnpm / unocss 时优先调对应 skill 的 docs

## 阶段进展

详见 [`docs/requirements/roadmap.md`](docs/requirements/roadmap.md)。当前进度：Phase 1–7.5 ✅，Phase 8（依赖升级）/ 9（安全 audit）/ 10（首次部署）排队中。
