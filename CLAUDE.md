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

## 模板元数据归属（跟模板同包，绝不分散）

**硬约束**：模板的视觉 / prompt 元数据**必须**跟模板源文件放同一目录或同一包，**不能**散落到 agent 等消费方。

| 模板元数据 | 唯一归属位置 |
| --- | --- |
| 视觉 token 色值 / 字体 / 间距 | `packages/slidev/templates/<id>/tokens.css` |
| layout 列表 / frontmatter schema / bodyGuidance / promptPersona | `packages/slidev/templates/<id>/manifest.json` |
| 公共组件 prompt 元数据（描述 / props / slotCapacity / 用法示例） | `packages/slidev/components/<category>/<Name>.meta.ts` |
| AI 出图色板 / 风格 invariants（generate_slide_image 用） | `packages/slidev/templates/<id>/manifest.json` 的 `imageGenStyle` 字段 |
| 任何"模板独有"的 prompt 引导 / 视觉默认值 | `packages/slidev/templates/<id>/manifest.json` 或同目录配套文件 |

agent 端**只**通过 `getManifest(templateId)` 或 import workspace 包读这些数据，**不维护任何映射表**。

**反模式（严禁）**：
- ❌ 在 `packages/agent/` 下写 `Record<templateId, {palette, ...}>` 之类的硬编表（数据漂移、加新模板要改两处）
- ❌ 在 agent 提示词里 hardcode 颜色 / 字体 / 风格关键词（只能从 manifest 拼装）
- ❌ 公共组件 prompt 描述放 agent（必须 `<Name>.meta.ts` 跟组件 sibling，详见 Phase 11.6 commit `1addc80`）

**判断口诀**：「这条数据在跨模板时会变吗？」—— 答案是 yes 就**必须**放模板包；agent 只能放跟具体模板无关的通用规则（比如「数据图必须用 BarChart」）。

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

### 生产部署

```bash
pnpm deploy:healthz                       # 只读：打 https://lumideck.illegalscreed.cn/api/healthz
pnpm deploy:creator                       # 只 build creator + rsync 静态文件到 /var/www/lumideck
pnpm deploy:backend                       # build agent + 同步 monorepo + 远端 pnpm i + db:push:prod + pm2 reload（前置 confirm）
pnpm deploy:ecosystem                     # 只同步 deploy/ 配置（ecosystem.config.cjs / nginx 模板 / 远端脚本）
pnpm deploy:all                           # 完整：ecosystem + creator + backend + healthz（前置 confirm）

FORCE=1 pnpm deploy:all                   # CI / 自动化：跳过交互 confirm
```

底层 `scripts/deploy.sh`，详细前置条件（SSH key / `.env.production.local` / `install-server.sh`）见 [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)。

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
   ├─ /api/*           ──Vite proxy──▶  agent :4000  ──▶ MySQL (lumideck_dev)
   │ (含 X-Deck-Id              │
   │  by 编辑器 fetch)           ├─ HttpOnly session cookie
   │                            ├─ slides-store 写 packages/slidev/slides.md（仅放映路径用到）
   │                            ├─ activeDeckId 来源：X-Deck-Id header 优先（Phase 10.5）
   │                            └─ tool registry（本地工具 + MCP 远端工具）
   │
   │  ── 编辑器主视图（Phase 10.5 起）：
   │     creator SPA 内 <DeckRenderer> 直接渲染 markdown，**不走 Slidev 反代**
   │
   └─ /api/slidev-preview/*  ──proxy──▶  agent :4000  ──reverse-proxy──▶  slidev :3031
       (window.open 新 tab                  │
        全屏放映场景)                       └─ slidev-proxy-auth：仅锁持有者放行（403）
```

### 关键模块（agent）

- `src/app.ts`：Hono app 装配，**只做路由 + middleware**，不带启动副作用。生产入口 `src/index.ts` 引用 app，再接 `http.createServer` 提供 Slidev 反代 + WebSocket upgrade。集成测靠 `app.fetch(req)` in-process 调用，无需走端口
- `src/middleware/auth.ts`：`authOptional` 解 session cookie → `ctx.var.user`；`requireAuth` 闸门
- `src/middleware/request-context.ts`：把 user/session/activeDeckId 包进 `AsyncLocalStorage`，下游 `slides-store` / 工具读。**Phase 10.5 起 activeDeckId 来源**：优先 `X-Deck-Id` header（编辑器每次 fetch 显式带），fallback `session.activeDeckId`（向后兼容，Phase 10.5 起此字段实际永远 null）
- `src/slidev-lock.ts`：**单实例占用锁是 agent 进程内存对象**（不是 DB 表），心跳 30s，超时 5min 释放。**Phase 10.5 起锁的 acquire 点改为 `POST /api/present/:id`**（全屏放映按钮触发），原 `POST /api/activate-deck` 路由已删；编辑器进入不抢锁，多用户并发零排队
- `src/slidev-proxy-auth.ts`：Slidev 反代鉴权，仅锁持有者能访问 `/api/slidev-preview/*`（全屏放映 SPA tab 走这条）
- `src/tools/`：本地工具注册表；命名规范 `mcp__<serverId>__<toolName>`；`switch_template` 可注入 `RewriteFn` DI 便于测试
- `src/db/`：Drizzle schema；开发期用 `drizzle-kit push` 不写 migration

### 关键模块（creator / 编辑器）

- `src/deck-renderer/`：Phase 10.5 起编辑器主视图。`DeckRenderer.vue` 接 markdown + templateId + currentPage prop → `parseDeck()` 切页 → `<component :is="layout">` 动态查找 layout（**手工 `app.component()` 注册**，见 `register-layouts.ts`，因为 unplugin-vue-components 看不到 `:is` 动态字符串）；body markdown 走 `compile-body.ts` 的 `marked + Vue.compile` 运行时编译让 `<TwoCol>` 等 Vue 标签解析
- 响应式缩放：`DeckRenderer` 用 ResizeObserver 算 scale，slide-frame `aspect-ratio: 16/9` + `max-width: 960px`，slide-canvas `transform: scale()` 等比缩放到容器宽度（永远 ≤ 1，无放大）
- `src/composables/useSlideStore.ts`：单例 store。`activeDeckId` + `content` 模块作用域；`refresh()` 走 `GET /api/decks/:id` 取 currentVersion.content（**不**读 `/api/read-slides`，那条路径属于 Slidev 放映场景，仍受 slidev-lock 守）；`pages` / `totalPages` 复用 `parseDeck` 跟 DeckRenderer 口径一致

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
- MCP server **per-user 入库**（Phase 9-F A01 修复）：`user_mcp_servers` 表，`(userId, serverId)` 唯一；同 serverId 在不同 user 下是独立记录；registry / tool-registry 都按 user 分区，工具命名 `mcp__<serverId>__<toolName>` 不变（不暴露 userId 到 prompt）

## 后端日志规范（重要功能必须落盘）

**核心规则**：后端关键事件**必须**用 `logServerEvent`（[`packages/agent/src/logger/server-log.ts`](packages/agent/src/logger/server-log.ts)）落盘到 `logs/server-YYYY-MM-DD.jsonl`，**不能只 `console.log`**。

**为什么**：dev server 的 stdout 不持久化，关掉终端就丢；用户 dogfood 反馈「图没出来 / 任务卡住」时事后无从排查。落盘 JSONL 长期保留供 grep / 分析。Phase 11.6 dogfood 期间已踩过这坑（用户报"两张图没生成"，dev 终端日志已翻飞）。

**必须落盘的事件**：
- **异步 worker 状态转移**：`image-gen-job` / `template-switch-job` / `regenerate-image-pages` 等的 enqueued / running / success / failed / fallback / cancelled
- **外部 API 调用结果**：OpenAI image / 主 LLM completion 的成功 + 失败 + 重试 + 限速
- **用户主动操作的 audit-worthy 副作用**：删 deck / 切模板 / 上传 asset / 切换 LLM 配置等

**不必落盘**：纯查询路由（`GET /api/decks/:id`）、debug-only 临时 `console.log`、tool 同步 schema 校验失败（这种属 LLM 行为问题，console 即可）。

**调用约定**：

```ts
logServerEvent({
  category: 'image-gen',  // 模块名,grep 友好
  event: 'gen-failed',     // state transition / milestone
  jobId, deckId, userId, slideIndex,  // 业务字段任意附加
  errorMsg: e.message,
})
```

**配套实践**：保留 `console.log` 给 dev 终端实时反馈（mirror 模式）—— 既给开发者看又落盘。`logServerEvent` 内部自带 try/catch，文件写失败被吞掉不影响业务流。

**事后排查方式**：
```bash
grep '"event":"gen-failed"' logs/server-*.jsonl   # 找所有失败事件
grep '"jobId":"abc12345"' logs/server-*.jsonl     # 追踪某 job 全生命周期
jq 'select(.category=="image-gen" and .event=="cancelled")' logs/server-2026-04-30.jsonl  # 复杂过滤
```

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
- **`@antdv-next/x`** 0.3 Slot warning bug 已在 1.0 通过 API 重构间接修复（2026-04-26 Phase 8 清 P3-1）；**该包 npm `latest` dist-tag 仍指向 beta**（1.0.2-beta.1），升级时显式锁版本号（`pnpm up "@antdv-next/x@1.0.1"`），不跟 latest（[plan 17](docs/plans/17-phase8-deps-upgrade.md) 踩坑 6）
- **UnoCSS presetIcons** 有图标解析 bug（P3-7），用 `scripts/gen-icons.mjs` workaround；2026-04-26 Phase 8 复检 v66.6.8 仍未修，下次 Phase 11/14 复检（详见 [plan 06-monorepo](docs/plans/06-phase3-monorepo-agent.md) 踩坑 1）
- **`drizzle-kit push`** 改 schema 后，dev 与 test 库都要 push（`db:push` + `db:push:test`）；生产部署用 `db:push:prod` 推到 RDS lumideck 库（plan 19）
- **drizzle-orm 0.45 mysql-core 没原生 mediumBlob/longBlob**:加二进制大字段时用 `customType<{data: Buffer; driverData: Buffer}>({dataType: () => 'mediumblob'})` 自定义,drizzle-kit push 会正确 emit MySQL `mediumblob` 列定义。同套路适用 LONGBLOB / TINYBLOB / 任何标准 SQL 列类型（[plan 20](docs/plans/20-phase11.5-image-content.md) 踩坑 2）
- **monorepo 内部 ts 包用 ESM `from './x.js'` 风格,生产部署前必须先 build 出 .js**：dev/tsx 模式可以直接读 .ts,但 prod node 解析后,内部 import `./x.js` 找不到真实 .js 文件 → ERR_MODULE_NOT_FOUND。已踩中两次：`packages/shared`（plan 19 踩坑 4）和 `packages/slidev/components/_catalog`（Phase 11.6 引入 `.meta.ts` 配套元数据时漏配 build,2026-05-06 部署直接 502）。**通用规则**：任何 workspace 包通过 `package.json` exports 暴露 `.ts` + 内部用 NodeNext `.js` 后缀 import 的,都必须配 `tsc` build 把 `.ts` → `.js` 落盘共存,**并把这一步加进 `scripts/deploy.sh build_agent()`**;exports 字段 `import` 指 `.js`、`types` 指 `.ts`;emit 产物加 `.gitignore`
- **pm2 跑 ESM Node app 时 secrets 不要走 `-r dotenv/config` + `DOTENV_CONFIG_PATH`**:dotenv preload 只支持 CLI 参数 `dotenv_config_path=`,不读 env vars,加上 pm2 environment 注入与 -r 标志的交互不可靠。改用 bash wrapper（`deploy/scripts/start-agent.sh`）调 `pnpm exec dotenv -e .env.production.local -- node dist/index.js`,与本地 `pnpm start` 一致（[plan 19](docs/plans/19-phase10-production-deploy.md) 踩坑 5）
- **nginx HTTPS bootstrap 必须分两阶段**：模板里 `listen 443 ssl` 含 `ssl_certificate` 路径,但 certbot 申请证书前文件不存在,nginx -t 直接 fail,且坏 conf 写入会让后续 `systemctl reload nginx` 拒绝重载,**全 nginx 站点风险**。先写 80-only conf 让 certbot --webroot 申请证书,成功后再 envsubst 完整模板（[plan 19](docs/plans/19-phase10-production-deploy.md) 踩坑 3）
- **依赖升级前必看 npm `latest` dist-tag 是否指向 beta**：不是所有库都把 `latest` 严格对齐 stable；升 0.x → 1.x 类跨 major 时 `pnpm outdated` 显示的 latest 可能是 beta，显式锁 stable 版本号避免误升（[plan 17](docs/plans/17-phase8-deps-upgrade.md) 踩坑 6）
- **`@types/node` 跟 Node LTS 不跟 npm latest**：Node 25 还没 LTS 时 npm latest 已经是 25，但部署/CI 用 Node 22 LTS，类型版本应跟运行时 LTS 才不漂移（[plan 17](docs/plans/17-phase8-deps-upgrade.md) 设计抉择 #7）
- **pm2 reload 后 grandchild Node 进程残留占端口 → 新实例 EADDRINUSE crash-loop**：`start-agent.sh → pnpm exec → dotenv-cli → node` 四层 wrapper,pm2 reload 时 SIGTERM 顶层 wrapper 但 grandchild node 未及时退,新实例起到 listen(4000) 抛 EADDRINUSE,pm2 继续 restart 卡死(85+ 次)直到手动 `kill -9 <grandchild_pid>`。**排查口诀**：deploy 后 healthz 502 + pm2 status uptime 几秒 + restart 次数飙升 → `ss -tnlp \| grep :4000` 找到占端口的实际 PID(不是 pm2 tracked PID,是 grandchild)→ kill -9 那个 → pm2 自己起新的(2026-05-16 Phase 12.7 部署踩)

### Hono 路由

- **Hono sub-router 内 `sub.use('*', mw)` 通过 `app.route('/api', sub)` 挂载后，`*` 会泄漏到 /api/* 所有路径**：sub-router 单测里 `*` 看似只匹配 sub 自己的 path，但通过 route() 挂到前缀下后，wildcard 会拦截整个前缀的所有请求，影响其他 sub-router 的公开端点。改成显式 path 列举（`sub.use('/path-a', mw)` / `sub.use('/path-b', mw)`），或用 `sub.use(['/path-a','/path-b'], mw)` 数组形式。**单测无法复现**——必须有 `app.fetch()` 真路由 mount 集成测才能 catch（[plan 18](docs/plans/18-phase9-security-audit.md) Phase 9-B/9-C）

### Slidev 反代 + HMR

> **Phase 10.5 后语境**（plan 25 落地）：编辑器主视图换成 creator SPA 内的 `<DeckRenderer>` Vue 组件，**不**走 Slidev 反代。下列条目仅作用于「全屏放映」`window.open('/api/slidev-preview/...')` 新 tab 加载 Slidev SPA 的场景。**long session HMR 缓存错位的触发面已消失**（编辑期间 Slidev iframe 不存在），但 dev Slidev 进程偶发卡死仍可能影响放映 tab，「重启 Slidev 演讲进程」按钮保留在 SlidePreview toolbar 内兜底。

- **Slidev 仅 agent 反代访问**：原生端口 `:3031` 必须绑 loopback,不能直接对外（详见 [plan 10](docs/plans/10-phase5-user-deck-versions.md) 踩坑 1-2）
- **agent 跨进程 fetch slidev 用 `localhost` 不要用 `127.0.0.1`**：slidev v52 + Vite 5+ 默认只 bind `[::1]`(IPv6 loopback),`SLIDEV_ORIGIN=http://127.0.0.1:3031` 会 ECONNREFUSED;`localhost` 走 OS resolver 自动选可达协议族（[plan 19](docs/plans/19-phase10-production-deploy.md) 踩坑 6）
- **Slidev dev 启动必须带 `--base /api/slidev-preview/`**：否则 HTML 内绝对路径 `/@vite/client` 等全 404（[plan 10](docs/plans/10-phase5-user-deck-versions.md) 踩坑 2）
- **`slides.md` 锁的 acquire 点 = `POST /api/present/:id`**（Phase 10.5 起；编辑器进入不抢锁）：放映按钮触发；dev agent 重启自动复位（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) Task D-1）

### DeckRenderer / 编辑器（Phase 10.5）

- **`<component :is="动态字符串">` unplugin-vue-components 看不见**：必须手工 `app.component()` 注册到全局（`src/deck-renderer/register-layouts.ts`）。新加 layout / 公共组件时**两处都要改**：slidev 包加 .vue + .meta.ts + 同步 _catalog/index.ts，creator 加 register-layouts.ts 一行 import + 一行注册（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) Task B-2 → fix 提交 `94cf8f4`）
- **layouts 用 `${BASE_URL}/templates/<id>/x.png` 取资源**：creator 必须保留 `public/templates` 软链 → `../../slidev/templates`，vite build 时符号链接目标会被拷进 dist，rsync 一并部署（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) 执行期偏离 #1）
- **`slideStore.totalPages` / `pages` 必须复用 `parseDeck()`**：不能用 naive `content.split(/\n---\n/)` —— 那会把 frontmatter 的 `---` 也算成 slide 分隔符（实测北投 starter 切出 6 页而非 5 页）。视觉层 + 状态层用同一份切页算法（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) 执行期偏离 fix `621ef98`）
- **`useSlideStore.refresh()` 走 deck-scoped 路径**：fetch `GET /api/decks/:id` 取 currentVersion.content；**不**读 `/api/read-slides`（那条受 slidev-lock 守门，编辑器去抢锁后必然 403）。编辑器进入由 SlidePreview onMounted 调 `slideStore.initDeck(deckId, initialContent)` 绑定 deckId + 写初始内容（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) 执行期偏离 fix `7379506`）
- **LLM 工具调用必须在 fetch 时带 `X-Deck-Id` header**：Phase 10.5 删 activate-deck 后 `session.activeDeckId` 永远是 null；middleware 改成优先读 `X-Deck-Id` header 覆写 ALS activeDeckId（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) 执行期偏离 fix `f5f2972`）。前端 `useAIChat.executeTool()` + 其他将来需要 deck context 的 fetch 都得带这个 header
- **body markdown 编译用 `vue/dist/vue.esm-bundler.js`**：vite alias 切到带 runtime compiler 的 Vue 构建版本（+50KB gzip），让 `marked → HTML → Vue.compile(html)` 链路能在浏览器跑（[plan 25](docs/plans/25-phase10.5-deck-renderer.md) Task A-2）

### 测试基建

- **集成测共享 lumideck_test 库**：`vitest.config.ts` 必须 `fileParallelism: false`（同包内串行）+ 根 `package.json` 的 `pnpm test` 用 `turbo run test --concurrency=1`（跨包 turbo 也强制串行,否则 agent + creator 集成测同时连库撞 TRUNCATE）。用 `pnpm test` 一次跑全 monorepo 时这条是必须的（[plan 11](docs/plans/11-phase5-tests-and-env-split.md) 踩坑 1 / [plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 7D-C / Phase 11.7 顺手补 turbo concurrency）
- **任何 `__set*ForTesting` testing seam 用 module-level mutable state 的，必须配 `afterAll(() => __set...(null))` 复位**：seam 注入后不还原会让模块缓存把 fake/fixed 值漏到后续测试文件（vitest 不 reset 模块缓存）。Phase 12.7 Task H 跑全套时观察到 routes-auth / mcp-server-repo / llm-models 2-9 个 case 偶发 fail，定位是 `chat-turn.test.ts` `beforeAll(__setMasterKeyGetterForTesting(FIXED_KEY))` 缺 afterAll 复位 → master key 跨文件污染；旧 test 同样缺还原但碰巧不撞，新加用 seam 的 test 必须自带 afterAll 还原 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 6)
- **in-process `app.fetch(req)` 测 SSE abort + cancel 时序跟生产 undici 偏**：abort 路径单测只验 wire（agent.abort() 被调用），slot 释放走 happy path 隐式覆盖；不要断言「slot 已释放」之类时序敏感状态。Phase 12 Task E + Phase 12.7 Task F 均踩 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 4)
- **进程内 stateful 模块**（如 slidev-lock）必须在 test env 暴露 reset hook（如 `_test/reset-lock`），否则跨 case 污染（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 6）
- **fs 写入路径在 test env 下必须接受 env 覆盖**到临时目录，否则跑测试会污染 dev 数据（[plan 09](docs/plans/09-phase4-edit-iterate.md) 踩坑 3 / [plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 7）
- **依赖外部不稳定能力的工具走 DI seam**：如 `rewriteForTemplate` 用 `RewriteFn` interface DI 注入，测试时 mock 跑完整状态机不烧 token（[plan 12](docs/plans/12-phase6-template-architecture.md) 踩坑 2）
- **Vue Test Utils 不跨 Teleport 边界 query**：用到 `<Teleport>` 的组件单测必须加 `disableTeleport` prop（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 2）
- **E2E 跳真 LLM**：用 `BIG_PPT_TEST_REWRITE_MODE=skeleton` env 让 `rewriteForTemplate` 直接读 starter，免烧 token；playwright.config webServer env 写死该值
- **Vitest 4 起 vi.mock 对 dynamic import 拦截不稳定**：同一文件多次 `await import('mod')` 第二次会绕过 mock 拿真模块。vitest 2 时代"用 dynamic import 让 vi.mock 能拦截"的注释在 4 之后**反向**，改用 static import + 顶层 vi.mock factory（`() => ({ ... })`）才稳定。production 等价（ESM 模块缓存，首次开销忽略）（[plan 17](docs/plans/17-phase8-deps-upgrade.md) 踩坑 2）
- **Vitest 4 v8 coverage 引擎换为 AST-based remapping**（替 v8-to-istanbul）：statements/branches 按 AST 节点级而非物理行级算，分母变大，跨 vitest 2/4 的 coverage 数字不可直接对比；升级时门槛要按新引擎 baseline 重新定，不能简单"维持原值"（[plan 17](docs/plans/17-phase8-deps-upgrade.md) 踩坑 4）
- **mysql2 prepared-statement `LIMIT ?` 参数化触发 ER_PARSE_ERROR**：某些 MySQL 版本上 mysql2 会把 Number 序列化成 string 给 `LIMIT ?`，server 端 prepared-statement parser 拒绝。解法：`LIMIT ${safeLimit}` 直接拼字符串，`safeLimit = Math.max(1, Math.floor(internal_number))`——`safeLimit` 必须来自内部整型常量不来自用户输入，否则有 SQL injection 风险。其他 user-supplied 值仍走 `?` 占位绑定（[plan 26](docs/plans/26-phase12-multi-llm-providers.md) 踩坑 1）
- **跨 workspace 包共享 TS types 走单向 re-export**：shared 包是 source-of-truth；agent / creator 用 `import type { X } from '@big-ppt/shared'` re-export。反向（agent 当 source，shared re-export）会撞 `TS6059: ... not under rootDir`，因为每个 workspace 包的 tsconfig 有独立 rootDir，跨包 import .ts 源码越界。Task B 的 canonical types + Task D 的 SSE wire format 都走这套（[plan 26](docs/plans/26-phase12-multi-llm-providers.md) 踩坑 2）
- **Aliyun RDS `TRUNCATE TABLE` 触发 mysql2 prepared-statement stale plan → 静默返空**：lumideck_test 跑在阿里云 RDS，drizzle 走 mysql2 `pool.execute()` 是 prepared-statement。InnoDB 下 `TRUNCATE` 相当于 drop+recreate 表，server-side 把之前 prepare 的 plan 标记失效。**标准 MySQL** 会让客户端拿 re-prepare 错并重试，**Aliyun RDS 代理层会吞掉这个失效信号**：prepared-statement 不报错也不重 prepare，拿 stale plan 跑 → INSERT 看似成功**但行实际没落表**，后续 immediate SELECT 返 empty。表现为 routes-auth / mcp-server-repo / uploads-extractor 这种「INSERT user → 立即 SELECT」的集成测偶发 2-9 case fail（600 跑复现 2-4 次）。**修复**：`test/_setup/test-db.ts` 把 8 张表的 TRUNCATE 全改 `DELETE FROM x`（不动表结构，prepared plan 保留有效）；副作用是不 reset AUTO_INCREMENT，测试需用动态 user.id。**防再犯**：新写 test setup **不用 `TRUNCATE TABLE`**，统一 `DELETE FROM`（[Phase 13 plan 29](docs/plans/29-phase13-file-upload-assets.md) 踩坑 1 / commit `e5e1a0b`）
- **subagent-driven 并行 3+ agent 共享 worktree 撞 git staging 错位**：`superpowers:subagent-driven-development` 同 cwd 起 3 fresh agent 并行做不同 Task 时，每个 agent 独立写自己负责的文件但**共享同一份 git index**。Phase 13 Task B agent commit `f723a54` 跑 `git add packages/` 把 Task F 还没 stage 的 creator/ 下文件一并暂存，commit message 标签是 Task B 但 diff 全是 Task F 的 frontend 文件（UploadButton / AssetManagerPanel + 22 单测）。代码本身完整、测试全过，**只是 commit message 跟内容错位**，事后看 git log 找哪个 commit 对应哪个 Task 会蒙圈。**防再犯**：3+ agent 并行不同 task **必走 `git worktree`**（每个 agent 自己 worktree 自己 git index），见 `superpowers:using-git-worktrees` skill；或退一步分**串行 commit window**：前 agent commit + push 完，后 agent 才开始（[Phase 13 plan 29](docs/plans/29-phase13-file-upload-assets.md) 踩坑 2 / commit `0c4bb8a` 道歉文）

### 前端约定

- **API 调用一律带 `/api/` 前缀**，不能依赖 dev 模式 vite proxy 兜底（dev 跑通但 prod 挂的经典坑，[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 5）
- **Vue setup() 内派生对象一律 `computed`**，普通对象不响应式（[plan 03](docs/plans/03-chat-ui-fixes.md) 踩坑 1）
- **组件内 `setTimeout` / `setInterval` 必须在 `onUnmounted` 清理**，否则切换页面后 timer 仍跑（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 4）
- **JSDoc 注释里写代码示例时绕开 `*/` 字面量**，会提前关闭注释（[plan 14](docs/plans/14-phase7c-template-ui.md) 踩坑 1）
- **大重写后必须全包 grep 旧 export 名（chatStream / chatStreamLegacy / old hook 等），死代码不留 shim**：Task G 重写 useAIChat 把 chatStreamLegacy 改名后没删 `api/llm.ts`，code review 才发现整个文件零调用方，整文件应删；JSDoc 声称的「Settings 健康检查」caller 实际不存在 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) Task G 偏离 #3)
- **CSS token 命名空间：creator SPA 用 `--color-*` / `--space-*` / `--fs-*`（src/styles/tokens.css），Slidev 模板用 `--ld-*`（仅 .slidev-layout 子树 resolve）**：chat panel / Settings 等 creator-only 组件读 `--color-*`；公共组件（ChartGrid 等同时给 Slidev 用）才两层 fallback `--color-* → --ld-*`。ToolExecutionBlock / ThinkingBlock / UsageStatsHint 这种 chat-only 组件不会进 Slidev 子树，hardcode `--color-*` 就够 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) Task G 偏离 #4)
- **异步工具（jobId-return + worker 异步）frontend 必须接桥 polling**：backend SSE `tool_execution.end` 在工具 callback `return` 后立即 fire，不延续 turn 边界；不能把 jobId-return 当 image-ready。canonical 模式：post-turn `refreshFromBackend` 后扫 `deck_chats` tool 行 `success:true && jobId:string` 起 `useGenerateImageJob.start`；用 Set dedup 跨 turn 重复出现的 jobId；`clearHistory` 清 Set ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 5)
- **Modal 打开瞬间「网络回来前用户已经在打字」race**：`watch(open, async (val) => { if (val) await api.get(...) })` 异步 reset form 会擦掉打字。修法:reset 前 snapshot 用户已敲的明文字段(server 永远不回明文,如 apiKey),inject 后用 snapshot 覆盖。SettingsModal 2026-05-16 dogfood 踩坑(E2E `fill()` 快到能复现,真人偶发)
- **E2E 真打 LLM 测必须 env 闸 + 跳 skip**：测试源码绝不含真 key。已知 throwaway test key (memory `test-api-keys`) 走 env (`GLM_TEST_KEY` / `OPENAI_IMAGE_TEST_KEY` 等),spec 内 `test.skip(!process.env.XXX_TEST_KEY, ...)`。`scripts/check-secrets.sh` pre-commit hook (一次性 `ln -sf ../../scripts/check-secrets.sh .git/hooks/pre-commit`) 拦已知 throwaway 前缀 + 通用 `sk-[A-Za-z0-9]{30+}` 模式入 staging。CI 跑无 env 自动跳真打 smoke 不烧 token

### LLM / Tool 工程

- **工具层 integer 参数走 coerce util**：GLM 等 provider 会把 `index: 4` 序列化成字符串 `"4"`，工具层必须宽容（[plan 09](docs/plans/09-phase4-edit-iterate.md) 踩坑 1）
- **AI 输出落 disk 前必做 schema validation + 自由文本字段必走白名单**（[plan 15](docs/plans/15-phase7d-e2e-and-undo-fix.md) 踩坑 6）
- **Prompt contract test 用结构性断言不做字符级 diff**，避免文案微调红测试（[plan 12](docs/plans/12-phase6-template-architecture.md) 踩坑 1）
- **裁剪/压缩 chat history 时严守 `tool` ↔ `assistant.tool_calls` 配对**：OpenAI/GLM spec 要求 `role:'tool'` 必须紧跟带匹配 `tool_call_id` 的 `assistant`，slice/summarize 切口落在配对中间会让 tool 变孤儿，上游返回 "messages 参数非法"；裁剪后必须向前 drop 孤儿 tool（commit `1879bb4`）
- **各家 SDK baseURL 语义不统一**：OpenAI SDK 把 baseURL 当 prefix 直接拼 `/chat/completions`（所以必含 `/v1`）；Anthropic SDK 自动追加 `/v1/messages`（所以**不能**含 `/v1`）；Gemini SDK 用 `httpOptions.baseUrl` 自动追加 `/v1beta/...`。配置 LLM provider baseUrl 时必须显式查目标 SDK 文档，跨 provider 的 `BASE_URL` env 不能照抄（[plan 26](docs/plans/26-phase12-multi-llm-providers.md) 踩坑 5）
- **Thinking-tier 模型 maxTokens 计入 thinking budget**：gpt-5.2 / gemini-2.5-flash / claude-opus-4-7 thinking 模型，`maxTokens` 是「thinking + output」总额。给 50 tokens 跑会触发 MAX_TOKENS finish reason 且 output 空。规则：用 thinking-tier 模型时 `maxTokens` 至少 **2x 预期 output**（[plan 26](docs/plans/26-phase12-multi-llm-providers.md) 踩坑 4）
- **删 session / DB / ALS 全局字段写入路径前必须 grep 所有读取方**：Task F 把 `users.llm_settings` 从老 shape `{provider, apiKey, ...}` 升级到新 shape `{activeProvider, providers, advanced?}`，只 grep 了 `deckChats` 消费者，漏掉 6 个 `llm_settings` 消费者（rewriteForTemplate / mcp.ts / mcp-registry / auth.ts GET+PUT）。production migration 跑后会 silently break MCP `$LLM_KEY` 替换 + Settings UI 保存覆盖回老 shape。**改 schema 字段语义时全包 grep 字段名两次**（一次 reader、一次 writer）写补 helper 兼容期支持双 shape（[plan 26](docs/plans/26-phase12-multi-llm-providers.md) 踩坑 / Task F-fix `b33b712`）
- **第三方 SDK API 跟 README 文字描述偏差是常态**：pi-ai 0.74.0 跟其 README 在 8 处签名上不一致（`Usage.cacheRead` not `cachedRead`、`done.message.usage` not `done.usage`、`error` event in-stream not thrown、`StreamOptions` 无 `baseUrl` 字段需走 `Model.baseUrl` 覆盖、Tool.parameters 类型 TSchema 但 runtime 接 JSON Schema 等）。**升级第三方 SDK 时必读 `node_modules/<pkg>/dist/types.d.ts` 真实签名**，不只读 README；新版本可能再次漂移。`fauxProvider` 这种厂商内置 test helper 因可能强制 recompute 某些字段，cache.hit / 自定义 usage 等单测需要 export internal helper（如 `translatePiEvent`）直接喂 event 测，bypass faux ([plan 27](docs/plans/27-phase12.5-pi-ai-migration.md) 踩坑 1)
- **第三方 SDK 内置 provider id 跟我们对外暴露的 id 可能不一致 → 必须翻译表**：pi-ai 0.74.0 用 `google` / `zai` / `moonshotai`（不是我们的 `gemini` / `zhipu` / `moonshot`）；不加翻译表 5/7 provider 运行时拿 undefined 抛 `Cannot read properties of undefined (reading 'id')`。**且单测用 testing seam（注入 fake resolver）会完全屏蔽这个 bug**——必须在某条单测**显式跑真 SDK 路径**（如 `defaultResolver('gemini', X)`）才能 catch。同套路：当用 `__setXxxForTesting` seam 让单测脱离真实 SDK 时，**保留至少一条「真打」单测** ([plan 27](docs/plans/27-phase12.5-pi-ai-migration.md) 踩坑 2)
- **smoke test「warn-not-fail」原则要覆盖所有 known upstream 失败模式**：smoke 真 key 跑下来除了网络抖动（timeout / 5xx），还会撞 (a) 中转 quota / billing 错（400 但 message 含「quota」/「extra usage」/「plan limit」）；(b) SDK 内部 JSON parser 错（中转返非 streaming 响应导致 SSE 不完整）。`isSkippable` regex 要覆盖所有这些。**且 pi-ai 类设计的 SDK 把 error event in-stream emit 不抛错**，loop 后要扫 `events.find(e => e.type === 'error')` 走 stream-level skip 路径 ([plan 27](docs/plans/27-phase12.5-pi-ai-migration.md) 踩坑 4)
- **pi-agent-core 0.74.0 类型签名跟 README 偏 7+ 处**：`AgentMessage` role camelCase `'toolResult'`（不是 snake_case）；ThinkingBlock 字段 pi 端是 `{thinking, thinkingSignature?, redacted?}` 不是 `{text}`；ToolUseBlock pi 用 `'toolCall'` (camelCase) + `arguments` 不是 snake + `input`；`AgentTool.parameters` 声明 TSchema (typebox) 但 runtime 接 JSON Schema 需 `as unknown as TSchema` cast；`ToolResultMessage.toolName` required；`Agent.subscribe(listener)` listener 收 AgentEvent union 单参（不是 plan 假设的 (event, signal) 2 参）；公共字段 sessionId / toolExecution / state 是直接读不走 getter 方法。**升级前必读 `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`**，跟 plan 27 pi-ai 教训同套路 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 1)
- **pi-agent-core 无 top-level `'error'` AgentEvent**：errors 走嵌套 `message_update.assistantMessageEvent.error`；plan 假设的 top-level error type 不存在。需要 assertNever 加 default guard 兜底 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) Task D 偏离)
- **扩 discriminated union 不是「非破坏」commit**：union 一扩就强制所有 `switch (event.type)` exhaustive site 同步加 case，type-check 红一片。Phase 12.7 Task A canonical event 8→13 类一扩就牵动 `types.test.ts assertNever` + `useAIChat consumeCanonicalEventStream` 2 处 exhaustiveness site。**先全包 grep `assertNever` / `case never` / `default:` 找全 exhaustiveness site 算入改动量** ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 3)
- **改 schema / DB / ALS 全局字段时 grep readers 必须覆盖 createAgent / factory 等 "新增 reader"**：Phase 12 Task F 漏 grep 6 个 llm_settings 消费者已上 CLAUDE.md，Phase 12.7 Task E 再踩——thinkingEnabled → thinkingLevel migration plumb 到 parseLlmSettings / GET-llm-settings / PUT-llm-settings 三处 safeParse 入口，**漏了** Task C 刚加的 createAgent.resolveThinkingLevel 直接读 rawSettings.advanced.<provider>.thinkingEnabled。两份升级穿插时 reader 增量比想象多 ([plan 28](docs/plans/28-phase12.7-pi-agent-core.md) 踩坑 2)
- **schema enum 限制升级时 legacy 自由字符串 row 会 migration 全失败**：Phase 12 把 `provider` 字段从「自由 string」变成 12-canonical-enum,prod 4 个老用户 `provider:"custom"` migrate-llm-settings.mjs 跑 zod 校验阶段全 failed → migration 报「迁移后 zod 校验失败」吐 4 行。**临时解** 直接 SQL UPDATE 让这些 row `llm_settings=NULL` 强迫用户重配。**正解** migration 设计带 admin-override pre-map(按 baseUrl host 推断 openai-compat / anthropic-compat) 或 schema 留 `Other` 兜底允许 passthrough。未来扩 enum 限制(thinkingLevel / 任何 provider-like enum) 必须考虑老 string row 怎么收尾 (2026-05-16 Phase 12.7 prod 部署踩)

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

详见 [`docs/requirements/roadmap.md`](docs/requirements/roadmap.md)。当前进度：Phase 1–10 ✅(2026-04-27 lumideck.illegalscreed.cn 上线),Phase 11.5(AI 图片内容页 / `generate_slide_image` 工具) ✅(2026-04-30),Phase 11.6 + 11.7 ✅,Phase 10.5(Slidev 解耦 / DeckRenderer / 锁语义归位) ✅(2026-05-12,plan 25),Phase 12(多 LLM Provider 原生接口) ✅(2026-05-13,plan 26),Phase 12.5(切到 pi-ai 0.74.0) ✅(2026-05-15,plan 27),Phase 12.7(pi-agent-core 上移 backend agent runtime) ✅(2026-05-16,plan 28),**Phase 13(文件上传 + 引用 + 用户级 Asset 管理) ✅(2026-05-16,plan 29)** —— user_assets 表 + fs storage + /api/uploads(POST/GET/DELETE)+ 5 type extractor worker + list_uploaded_files / read_uploaded_file 两 agent tools + ChatPanel paperclip + AssetManagerPanel 顶栏入口;per-user 100MB / per-file 10MB 硬 cap。原 Phase 13(MCP catalog 扩展)挪到 Phase 13.5。下一步:Phase 13.5 MCP catalog(含 stdio + zhipu-vision 解封),Phase 14 导出。
