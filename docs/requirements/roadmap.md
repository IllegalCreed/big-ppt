# Big-PPT 开发路线图

> 本路线图是"交付里程碑"的视角。每个 Phase 有**清晰的验收条件**和**不做什么**的边界，防止范围蔓延。配套文档：
>
> - Phase 1-2 实际交付：[docs/plans/01](../plans/01-project-init.md) / [02](../plans/02-ai-integration.md) / [03](../plans/03-chat-ui-fixes.md) / [05](../plans/05-phase2-closeout.md)
> - Phase 3 计划与关闭：[docs/plans/06-phase3-monorepo-agent.md](../plans/06-phase3-monorepo-agent.md) / [06-phase3-closeout.md](../plans/06-phase3-closeout.md)
> - MCP 集成（Phase 3.5 待启动）：[docs/plans/04-mcp-integration.md](../plans/04-mcp-integration.md) 已置顶废弃；新计划见未来的 `07-mcp-integration.md`
> - 技术债：[docs/plans/99-tech-debt.md](../plans/99-tech-debt.md)

---

## Phase 1：项目基础 + 模板 ✅

**目标**：搭建项目结构，创建模板体系和 AI Skill 文件

**交付物**：

- docs 目录（plans、requirements）
- templates 目录及模板套结构
- AI Skill 文件（slide-generator.md）
- 公司模板 markdown 文件（基于模板图片生成）
- AI 生成效果已验证通过（slides.md 示例）

**状态**：已完成

---

## Phase 2：AI 集成 + 对话 UI ✅

**目标**：构建 AI 对话界面，实现对话式幻灯片生成，达到"可在本地演示的完整原型"。

**交付物**：

- AI API Key 配置界面（SettingsModal）
- 对话式交互 UI（Bubble / Sender / ThoughtChain）
- 幻灯片实时预览（iframe 嵌入 Slidev）
- 流式生成 + 工具调用链可视化
- 对话斜杠指令（/clear / /retry / /undo / /log / /help）
- 会话日志系统（`logs/creator-*.jsonl` + payload 分片）
- 前端 runtime 错误归档

**验收条件**（全部满足才算关闭）：

- [x] 一句 prompt 能生成 6-10 页幻灯片
- [x] `pnpm exec slidev build` 全页编译通过
- [x] 斜杠指令 `/clear` / `/retry` / `/undo` / `/log` / `/help` 可用
- [x] 日志能追溯一次完整会话（用户输入 → LLM → 工具链 → 最终产物）
- [x] Prompt 约束命中：`transition` 字段、页间分隔无空行、图片路径白名单、禁词过滤

**状态**：已完成（2026-04 关闭，交接文档见 [05-phase2-closeout.md](../plans/05-phase2-closeout.md)）

**不做什么**：

- ❌ 斜杠指令美化 / 增加更多指令
- ❌ 对话气泡 UI 继续优化
- ❌ 增加任何新工具（都留给 Phase 3/4）

---

## Phase 3：Monorepo 拆分 + Agent 后端 + 工具链基建 ✅

**目标**：把"事实上的后端"从 Vite middleware 迁出，建成可独立运行的 `packages/agent` 服务（Hono on Node）；落地 monorepo 骨架与测试 / lint / format 基建。

**交付物**：

- pnpm workspace monorepo 搭建
  - `packages/slidev` — 幻灯片渲染（现有内容 + 根目录的 BarChart/LineChart/Counter 组件迁入）
  - `packages/creator` — 聊天 UI 前端（Vue 3 + TS，纯 UI，不做 IO）
  - `packages/agent` — Node.js 后端（Hono）：LLM 流式代理 + slides/templates/log 路由 + tool registry 骨架
  - `packages/shared` — 纯 types，creator ↔ agent API 契约
- 前端与 agent 通过 `/api/*` 通信（creator Vite `server.proxy` → agent :4000，不再依赖 Vite middleware）
- 测试基础设施：vitest 落地，agent 26 + creator 5 = 31 tests 全绿（覆盖工具分流 / 日志索引 / 备份策略 / 类型契约）
- lint / format：ESLint flat config + Prettier，每包独立 lint 脚本，根 `pnpm format` 一次性格式化

**MCP 集成**：本 Phase **不做**；延到 `07-mcp-integration.md`（待创建），在 agent 后端实现，[04-mcp-integration.md](../plans/04-mcp-integration.md) 已置顶废弃。

**验收条件**（全部满足才算关闭）：

- [x] 前端不再直接 fetch `/api/*` 走 Vite middleware，改为调 agent 服务（本地一命令 `pnpm dev` 起整套：creator :3030 / agent :4000 / slidev :3031）
- [x] `pnpm test` 可跑，核心逻辑（工具 registry、日志 payload 分片、slides edit similarity、契约 types）有测试覆盖（31 tests）
- [x] [99-tech-debt.md](../plans/99-tech-debt.md) 里 P1 级别技术债：P1-1（Vite middleware 后端化）/ P1-2（tool registry 骨架）/ P1-3（测试基础设施）/ P1-4（BarChart 等组件迁入）全部清除；P1-5（slides.md 架构升级）按计划留 Phase 4

**状态**：已完成（2026-04-21 关闭，关闭报告见 [06-phase3-closeout.md](../plans/06-phase3-closeout.md)）

**依赖**：Phase 2 已关闭

**不做什么**：

- ❌ MCP 集成（延到 07）
- ❌ 生产部署（Phase 5）
- ❌ 编辑器能力（Phase 4）
- ❌ 多用户 / 权限

---

## Phase 3.5：MCP 集成 ✅

**状态**：已完成（2026-04-21 关闭，按 [07-mcp-integration.md](../plans/07-mcp-integration.md) 执行）

**交付**：
- 本地 5 工具从前端静态数组搬到 `packages/agent/src/tools/` 的 registry（P1-2 完全清零）
- 前端 `useAIChat` 改为 `GET /api/tools` 动态拉取，`executeTool` 收敛为一行 `POST /api/call-tool`
- agent 引入 `@modelcontextprotocol/sdk`，以 StreamableHTTP transport 接入 MCP 远程 server
- `McpServerRepo` 抽象 + `JsonFileRepo` 实现（Phase 5 无缝换 `DrizzleRepo`）
- 预置 4 个智谱 MCP：联网搜索 / 网页读取 / 视觉 / Zread
- 前端 SettingsModal 拆 tabs "LLM" / "MCP Servers"，预置卡片 + 自定义折叠表单
- 工具命名规范 `mcp__<serverId>__<toolName>` 落定（P3-5 ✅）

---

## Phase 4：编辑与迭代 ✅

**目标**：支持通过对话对已生成的幻灯片进行逐页精细调整。

**交付物**：

- 工具集扩展：`create_slide` / `update_slide` / `delete_slide` / `reorder_slides`（拆分现 `write_slides`/`edit_slides`）
- slides.md 架构升级：全局 CSS 抽到 `global.css` + layout 组件，AI 不再每页重抄 CSS
- 布局切换、样式调整、单页增删
- 预览侧支持单页定位 / 高亮
- **附加**：`slides-history/` 环形缓冲（20 层）+ /undo /redo 轮次聚合 + UI 位置提示；工具层 integer 参数宽容 coerce

**验收条件**（全部满足才算关闭）：

- [x] 对 8 页幻灯片做"把第 3 页改成两栏"的指令，耗时 < 30 秒
- [x] AI 不再一次性重写整个 slides.md（单次 tool_call 只改一页）
- [x] slides.md 总行数下降 50% 以上（800 → 90 行，−88.75%）

**状态**：已完成（2026-04-22 关闭，关闭报告见 [09-phase4-edit-iterate.md](../plans/09-phase4-edit-iterate.md)）

**依赖**：Phase 3 完成

---

## Phase 5：用户系统 + Deck 管理 + 历史版本（单用户路径）

**目标**：把"文件系统的 `slides.md`"升级成"数据库里的 deck 对象"，每次保存自动入版本历史。**Slidev 仍是单实例**，但 deck 切换时 agent 改写那一份 slides.md。先把数据模型打通，多用户并发留到 Phase 6。

**交付物**：

- 后端 `packages/agent` 引入 **SQLite + Drizzle ORM**（单机零运维、类型安全）；agent 启动时自动建 schema + 跑 migration
- 四张核心表：
  - `users(id, email, password_hash, created_at, updated_at)`
  - `decks(id, user_id, title, theme_id, current_version_id, status, created_at, updated_at)` — status ∈ draft/published；`theme_id` 预留多 theme；`current_version_id` 支持"切回历史版本继续迭代"
  - `deck_versions(id, deck_id, content, message, author_id, created_at)` — append-only，每次 save 一条；restore = 新建 version 指向历史 content，保留完整时间线，支持 Git 风格分叉
  - `deck_chats(id, deck_id, role ∈ {system,user,assistant,tool}, content, tool_call_id, created_at)` — append-only 独立链，**不与 deck_versions 关联**。语义（2026-04-22 Q&A 确立）：切版本时**保留对话**，只移动 `decks.current_version_id`。AI 下一轮能感知当前 slides 是 V5 且记得之前在 V6/V7 上的尝试（用户"改主意了"的心智）
- 认证：`/api/auth/register` / `/api/auth/login` / `/api/auth/me`，session cookie（httpOnly + SameSite=Lax），密码用 argon2 存
- API Key 从前端 localStorage 搬到后端 `users.llm_settings`（加密存 ，同步清 P3-2）
- deck 操作 API：`GET /api/decks` / `POST /api/decks` / `GET /api/decks/:id` / `PUT /api/decks/:id` / `DELETE /api/decks/:id` / `GET /api/decks/:id/versions` / `POST /api/decks/:id/restore/:versionId`
- 前端新增页面：登录 / 注册 / Deck 列表 / Deck 编辑（现有 Creator UI 收到 deck id 参数）/ 版本时间轴面板
- 打开某 deck 时：agent 把 `deck_versions` 最新一条的 content 落地成 `packages/slidev/slides.md`（互斥锁：同一时刻只有一个"活跃 deck"）
- 所有 creator 的读写 slides API（`/api/read-slides` / `/api/write-slides` 等）接入 deck 上下文：写操作同时新建一条 deck_version，不再直接覆盖文件

**验收条件**：

- [ ] 新用户能注册 → 登录 → 建 deck → 用对话生成 → 保存 → 登出 → 重登看到 deck 列表带正确 title
- [ ] Deck 详情页的"历史版本"面板显示所有历史记录，点击某条可预览 + 一键回滚（回滚 = 新建一条 version 指向该历史 content，保留完整时间线）
- [ ] 同一用户不同 deck 可切换（切换时 agent 把对应 content 写入 slides.md，Slidev 自动热更新）
- [ ] **切回历史版本 V5 后，AI 下一轮对话能感知当前 slides 是 V5 且理解用户之前在 V6/V7 上的尝试**（靠 `deck_chats` append-only + 每轮 LLM 调用前注入最新 slides.md）
- [ ] **每轮 LLM 调用前 system prompt 或 tool 必自动反映最新 slides.md 内容**（Phase 4 已强化"修改前必 read_slides"习惯，Phase 5 延续）
- [ ] API Key 后端化后，前端 localStorage 不再存敏感信息；清账 P3-2
- [ ] `pnpm test` 新增 DB 层测试：repository CRUD + migration round-trip + 版本 append-only 不变性 + deck_chats 跨版本保留

**状态**：待开始

**依赖**：Phase 4 完成

**不做什么**（范围围栏，防蔓延）：

- ❌ 多用户同时在线（**Phase 6**，MVP 先按"一次一个活跃 deck"串行）
- ❌ 导出（PDF/PPTX）— 延 Phase 7
- ❌ 云端部署 — 延 Phase 7
- ❌ Deck 分享链接、权限、协同编辑 — 延 Phase 6

---

## Phase 6：多用户并发 + Deck 运行时隔离

**目标**：解决 Slidev 单实例天花板，让多用户可以真正并行编辑自己的 deck。同时上"公开分享"场景（只读链接，不占编辑实例）。

**核心架构**（A + B 混合）：

```
                   ┌─────────────────────────────────────┐
                   │  agent (Hono :4000)                 │
用户编辑 ─────────▶│  /api/decks/:id/editor              │
                   │   └─▶ DeckRuntime 进程池（LRU）     │
                   │        ├─ slidev(slides=X.md) :4101 │  ← 活跃实例 ≤10
                   │        ├─ slidev(slides=Y.md) :4102 │     超上限排队
                   │        └─ ...                       │
                   │                                     │
用户查看 ─────────▶│  /decks/:id/share/:token            │
                   │   └─▶ 静态 dist/（build 产物）      │  ← 零实例开销
                   └─────────────────────────────────────┘
```

**交付物**：

- `packages/agent` 新增 **`deck-runtime` 模块**：
  - 进程池管理器（Map<deckId, { proc, port, lastUsed }>）
  - on-demand spawn：用户进编辑页 → 分配空闲端口 → `slidev` 子进程（slides 指向临时文件 `runtime/decks/<deckId>.md`）
  - 空闲回收：每个实例 5 分钟无活动自动 SIGTERM；上限 10，超限时 LRU 踢最老的
  - 健康检查：实例崩溃自动重拉；`/healthz/runtime` 暴露池状态
- 前端 `SlidePreview.vue` 的 iframe URL 不再写死 `:3031`，改为从 agent 的 `/api/decks/:id/editor` 响应里取动态端口（或走 agent 的 reverse proxy 路径）
- Deck 编辑实时保存（debounce 2s）→ 写到 `runtime/decks/<deckId>.md` → slidev HMR 自然生效 → 同时 append `deck_versions`
- **发布 / 分享**：
  - `POST /api/decks/:id/publish` → agent 跑 `slidev build`，产物存到 `storage/decks/<deckId>/<versionId>/dist/`
  - `GET /decks/:id/share/:shareToken` → agent 作为静态文件服务器返回 build 产物
  - `deck_shares(id, deck_id, token, version_id, expires_at, created_at)` 表管理分享链接
- 并发控制：同一用户可同时编辑多 deck（上限 3）；同一 deck 同一时刻只允许一个 tab 编辑（其他 tab 显示"编辑中"提示）
- 新增 `@big-ppt/shared` 类型：`DeckRuntimeStatus` / `DeckShareInfo`

**验收条件**：

- [ ] 三个不同用户同时登录、各自进入自己的 deck 编辑页，HMR 预览各自独立，互不干扰
- [ ] 超过 10 个 deck 进入编辑态时，最老的自动被回收，用户重新进入时再 spawn（<5s）
- [ ] `/decks/:id/share/:token` 不占用进程池；关掉 agent dev 模式下的 slidev 子进程后，分享页仍可访问
- [ ] 压测：10 个 deck 同时活跃、100 req/s 打分享页，agent 内存 < 2GB
- [ ] 进程崩溃 / OOM 自动重拉，不丢用户已保存的 content（因为源在 DB）

**状态**：待开始

**依赖**：Phase 5 完成（数据模型必须先稳）

**不做什么**：

- ❌ 多人实时协同编辑同一 deck（CRDT / OT）— 复杂度太高，留 Phase 8+ 或永不做
- ❌ 跨服务器分布式进程池 — 单机 10 实例已够内部 50 用户场景

---

## Phase 7：导出与部署

**目标**：完善导出功能，把 Phase 5/6 的架构上云。

**交付物**：

- PDF 导出（Playwright 无头渲染）
- PPTX 导出（探索 `pptxgenjs` 或 slidev 插件）
- 部署：agent + slidev build 产物 → 阿里云服务器（Docker compose：agent + nginx 静态托管）
- 域名 / HTTPS / 登录页
- 本地演示模式优化（离线单 deck 快速启动）

**依赖**：Phase 6 完成

---

## Phase 8：远期可能

**可能方向**：

- 多人实时协同（CRDT）
- 多语言支持
- 团队共享模板
- `slides.md.history` 环形缓冲升级（P2-2 已随 Phase 5 的 deck_versions 天然解决，可复盘是否还需要文件级 undo）
- 自定义主题编辑器
- 更多模板套系（不止 company-standard）

---

## 路线图变更记录

| 日期       | 变更                                                                                                 | 原因                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-04-20 | Phase 2 关闭，验收条件写入；MCP 计划（04）合并进 Phase 3                                             | Phase 2 范围已超出"原型验证"；MCP client 应跑在独立 agent 后端而非 Vite middleware                |
| 2026-04-20 | Phase 3 新增"测试基础设施"、明确 BarChart/LineChart 组件迁移                                         | 重构前补网；根目录杂散组件应进 monorepo                                                           |
| 2026-04-20 | Phase 4 新增"slides.md 架构升级"、工具拆分                                                           | write_slides 一次吐 16KB 5 分钟才完，架构撑不住编辑场景                                           |
| 2026-04-21 | Phase 3 拆为两步：本轮只做 monorepo + agent + 工具链基建，MCP 延到 07-mcp-integration.md             | 04-mcp 原计划寄生于 Vite middleware；先做后端独立再做 MCP，减少返工                               |
| 2026-04-21 | Phase 3 关闭（9 步迁移，P1-1/P1-2 骨架/P1-3/P1-4 技术债清除）                                        | 按 06-phase3-monorepo-agent.md 计划执行完成，验收条件全部满足                                     |
| 2026-04-21 | Phase 5/6/7 重排：插入"用户系统+DB+历史版本"（5）与"多用户并发+Deck 运行时"（6），原导出部署顺延为 7 | 用户提出用户系统 / 历史版本 / 多用户并行需求；Slidev 单实例是关键瓶颈，必须先解好才能上分享与部署 |
| 2026-04-21 | Phase 3.5 关闭：MCP 集成 + 本地工具 register 进 agent registry + 前端 GET /api/tools 动态化 | 按 07-mcp-integration.md 执行完成，P1-2 完全清零 |
| 2026-04-22 | Phase 3.6 关闭：creator design tokens + DESIGN.md；品牌身份 Lumideck · 幻光千叶；P3-8/P3-9 新增 | 按 08-phase36-frontend-polish.md 执行完成 |
| 2026-04-22 | Phase 4 关闭：P1-5 / P2-1 / P2-2 / P2-3 / P3-6 清零；slides.md 800→90 行；四件套工具 + /undo /redo 轮次聚合；Phase 5 补 `deck_chats` 表 + 切版本保留对话验收条件 | 按 09-phase4-edit-iterate.md 执行完成，路线图 3 条验收条件全部达标 |
