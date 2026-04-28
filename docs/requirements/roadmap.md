# Big-PPT 开发路线图

> 本路线图是"交付里程碑"的视角。每个 Phase 有**清晰的验收条件**和**不做什么**的边界，防止范围蔓延。配套文档：
>
> - Phase 1-2 实际交付：[docs/plans/01](../plans/01-project-init.md) / [02](../plans/02-ai-integration.md) / [03](../plans/03-chat-ui-fixes.md) / [05](../plans/05-phase2-closeout.md)
> - Phase 3 计划与关闭：[docs/plans/06-phase3-monorepo-agent.md](../plans/06-phase3-monorepo-agent.md) / [06-phase3-closeout.md](../plans/06-phase3-closeout.md)
> - Phase 3.5 MCP 集成：[docs/plans/07-mcp-integration.md](../plans/07-mcp-integration.md)（原 04 已废弃）
> - Phase 3.6 前端打磨：[docs/plans/08-phase36-frontend-polish.md](../plans/08-phase36-frontend-polish.md)
> - Phase 4 编辑与迭代：[docs/plans/09-phase4-edit-iterate.md](../plans/09-phase4-edit-iterate.md)
> - Phase 5 用户系统+Deck+单实例锁：[docs/plans/10-phase5-user-deck-versions.md](../plans/10-phase5-user-deck-versions.md)
> - Phase 5 补测轨道（env 分层+单元/集成/E2E+coverage）：[docs/plans/11-phase5-tests-and-env-split.md](../plans/11-phase5-tests-and-env-split.md)
> - Phase 6 模板系统架构：[docs/plans/12-phase6-template-architecture.md](../plans/12-phase6-template-architecture.md)
> - Phase 7 模板重命名 + 二套 + UI + E2E：[docs/plans/13](../plans/13-phase7-template-rename.md) / [14](../plans/14-phase7c-template-ui.md) / [15](../plans/15-phase7d-e2e-and-undo-fix.md)
> - Phase 7.5 模板分层重构（公共组件库 POC）：[docs/plans/16-phase75-template-layering.md](../plans/16-phase75-template-layering.md)
> - Phase 8 依赖全量升级：[docs/plans/17-phase8-deps-upgrade.md](../plans/17-phase8-deps-upgrade.md)
> - Phase 9 安全 Audit L3：[docs/plans/18-phase9-security-audit.md](../plans/18-phase9-security-audit.md) + [audit-report](../security/2026-04-audit-report.md)
> - Phase 10 首次部署：[docs/plans/19-phase10-production-deploy.md](../plans/19-phase10-production-deploy.md) + [runbook](../runbooks/deploy.md)
> - Phase 10.5 候选：Slidev 解耦 spike（_未启动_,触发条件见 Phase 10.5 章节）
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

## Phase 5：用户系统 + Deck 管理 + 历史版本 + 单实例占用锁 ✅

**目标**：把"文件系统的 `slides.md`"升级成"数据库里的 deck 对象"，每次保存自动入版本历史。**Slidev 仍是单实例**，deck 切换时 agent 改写那一份 slides.md。同时引入**单实例占用锁 + 等待页机制**，让首次部署可以直接单实例上线——多实例并发留到 Phase 11。

**技术栈选型（2026-04-23 调整）**：

- 数据库 **MySQL**（复用 `quiz-monorepo` 所在 MySQL 实例，新建 `lumideck` 数据库），**非 SQLite**（为部署和后续多实例共享存储铺路）
- ORM **Drizzle**，开发期 `drizzle-kit push`（零 migration 心智），上线前再切 `generate`
- 密码哈希 **bcrypt**（与 quiz-backend 一致，复用经验），**非 argon2**
- Session: HttpOnly Cookie + 服务端 `sessions` 表（stateful，便于撤销）

**交付物**：

- 后端 `packages/agent` 引入 Drizzle + mysql2 + bcrypt + cookie；`drizzle-kit push` 初始化 schema
- **五张核心表**：
  - `users(id, email, password_hash, llm_settings[AES-GCM 加密], created_at, updated_at)`
  - `sessions(id, user_id, active_deck_id, last_heartbeat_at, expires_at, created_at)` — stateful session；`last_heartbeat_at` 客户端每 30s 刷新，超时用于判断单实例锁释放
  - `slidev_lock(id=1 单行, holder_session_id, holder_user_id, holder_deck_id, locked_at, last_heartbeat_at)` — 全局单实例占用锁
  - `decks(id, user_id, title, theme_id, current_version_id, status, created_at, updated_at)` — status ∈ active/archived/deleted；`theme_id` 预留多 theme；`current_version_id` 支持"切回历史版本继续迭代"
  - `deck_versions(id, deck_id, content, message, author_id, created_at)` — append-only，每次 save 一条；restore = 移动 `decks.current_version_id`，不新增 version，保留完整时间线
  - `deck_chats(id, deck_id, role ∈ {system,user,assistant,tool}, content, tool_call_id, created_at)` — append-only 独立链，**不与 deck_versions 关联**。语义（2026-04-22 Q&A 确立）：切版本时**保留对话**，只移动 `decks.current_version_id`。AI 下一轮能感知当前 slides 是 V5 且记得之前在 V6/V7 上的尝试（用户"改主意了"的心智）
- 认证：`/api/auth/register` / `/api/auth/login` / `/api/auth/logout` / `/api/auth/me`，session cookie（HttpOnly + SameSite=Lax + Secure 生产），密码 bcrypt rounds=10
- API Key 从前端 localStorage 搬到后端 `users.llm_settings`（AES-256-GCM 加密，master key 从 `APIKEY_MASTER_KEY` 环境变量读；同步清 P3-2）
- LLM 代理：API Key 只在服务端解密使用，不再信任客户端 header
- deck 操作 API：`GET /api/decks` / `POST /api/decks` / `GET /api/decks/:id` / `PUT /api/decks/:id` / `DELETE /api/decks/:id`（软删）
- 版本 API：`GET /api/decks/:id/versions` / `POST /api/decks/:id/versions`（新增版本，自动成为 current）/ `POST /api/decks/:id/restore/:versionId`
- 对话 API：`GET /api/decks/:id/chats` / `POST /api/decks/:id/chats`
- **单实例占用锁 API**：
  - `POST /api/activate-deck/:id`：原子抢占（`UPDATE slidev_lock WHERE holder IS NULL OR holder = me OR heartbeat 超时`，用 affectedRows 判断）；成功则 mirror 内容到 `packages/slidev/slides.md`；冲突返回 **409 + holder 信息**
  - `POST /api/release-deck`：自己占用时释放，不占用返回 200 幂等
  - `POST /api/heartbeat`：刷新 `sessions.last_heartbeat_at` 和 `slidev_lock.last_heartbeat_at`
  - `GET /api/lock-status`：`{ locked, holder?, isMe }`，前端等待页轮询用
  - 默认超时阈值：5 分钟无心跳自动判定释放
- 前端新增页面（首次引入 Vue Router）：登录 / 注册 / Deck 列表 / Deck 编辑（现有 Creator UI 收到 deck id 参数）/ 版本时间轴面板 / **OccupiedWaitingPage**（占用冲突时显示"当前被 xxx 使用中，锁定于 xx 分钟前"+ 手动重试 + 5s 轮询自动跳转）
- 聊天持久化：每次发言、工具回包都 POST 到 `/api/decks/:id/chats`；打开 deck 时 GET 加载历史
- 所有 creator 的读写 slides API（`/api/read-slides` / `/api/write-slides` 等）接入 deck 上下文：写操作同时新建一条 deck_version，不再直接覆盖文件
- `slides-store` 7 个函数签名保持不变，内部实现从 fs 改成读写 `deck_versions` + mirror 到 `packages/slidev/slides.md`

**验收条件**：

- [x] 新用户能注册 → 登录 → 建 deck → 用对话生成 → 保存 → 登出 → 重登看到 deck 列表带正确 title
- [x] Deck 详情页的"历史版本"面板显示所有历史记录，点击某条可预览 + 一键回滚（回滚 = 移动 `current_version_id`，保留完整时间线）
- [x] 同一用户不同 deck 可切换（切换时 agent 把对应 content 写入 slides.md，Slidev 自动热更新）
- [x] **切回历史版本 V5 后，AI 下一轮对话能感知当前 slides 是 V5 且理解用户之前在 V6/V7 上的尝试**（靠 `deck_chats` append-only + 每轮 LLM 调用前注入最新 slides.md）
- [x] **每轮 LLM 调用前 system prompt 或 tool 必自动反映最新 slides.md 内容**（Phase 4 已强化"修改前必 read_slides"习惯，Phase 5 延续）
- [x] API Key 后端化后，前端 localStorage 不再存敏感信息；清账 P3-2
- [x] **单实例占用冲突场景**：两个浏览器登录两个账号 → A 占用 deck → B 登录进 `/decks/:id` 看到等待页 → A 主动释放 → B 自动跳转编辑页
- [x] **心跳超时释放**：A 占用后关闭标签页 → 5 分钟后心跳超时 → B 的轮询自动进入（实施期锁改内存对象，见 plan 10 偏离纪录）
- [x] `pnpm test` 新增 DB 层测试：repository CRUD + schema push 幂等 + 版本 append-only 不变性 + deck_chats 跨版本保留 + 锁竞争并发安全（Phase 5 补测轨道交付，见 [plan 11](../plans/11-phase5-tests-and-env-split.md)）

**状态**：✅ 已完成（2026-04-23 关闭，关闭报告见 [10-phase5-user-deck-versions.md](../plans/10-phase5-user-deck-versions.md) 和 [11-phase5-tests-and-env-split.md](../plans/11-phase5-tests-and-env-split.md)）

**依赖**：Phase 4 完成

**不做什么**（范围围栏，防蔓延）：

- ❌ 多用户**同时编辑各自 deck**（**Phase 11**，Phase 5 保证同一时刻只一人占用 Slidev）
- ❌ Slidev 进程池、多实例运行时隔离（**Phase 11**）
- ❌ 导出（PDF/PPTX）— 延 Phase 14
- ❌ 导入（Markdown / PPTX）— 延 Phase 15
- ❌ Deck 分享链接、权限、协同编辑 — 延 Phase 11 / Phase 16+

---

## Phase 6：模板系统架构 ✅

**目标**：扩展模板体系从"硬编码单模板"升级为"可扩展多模板 + 动态 prompt 拼装"。建立 Template Manifest 规范，落地 deck → template 关联、切换 API、AI 内容迁移流水，**为 Phase 7 交付第二套模板铺路**。**实施计划见 [plan 12](../plans/12-phase6-template-architecture.md)**。

**交付物**：

- **Template Manifest 规范** `templates/<id>/manifest.json`：
  - `id` / `name` / `description` / `thumbnail` / `logos` / `prompt_persona` / `starterSlidesPath`
  - `layouts[]`：`name` / `description` / `frontmatter_schema`（JSON Schema）/ `body_guidance`
- **company-standard 回填 manifest.json** + **3 页 starter.md 骨架**（封面「请填写标题」/ 内容页占位 / 封底致谢）—— 新建 deck 即带骨架预览，不再空白
- **DB 迁移**：`decks` 表加 `template_id` 字段，老 deck 默认 `company-standard`
- **后端 API**：
  - `GET /api/templates` — 返回所有 manifest（升级原 `/api/list-templates`）
  - `POST /api/decks/:id/switch-template` — body `{ targetTemplateId, confirmed: true }`，返回 migration job id
- **Tool-registry 更新**：
  - `list_templates`（升级返回 manifest，替代原纯 id 列表）
  - `switch_template`（前端受控为主，AI 对话也可触发）
- **Prompt 动态拼装**：
  - 目前 `packages/agent/src/prompts/` 硬编码 7 个 layout
  - 重构为从当前 deck 的 `template_id` → 读 manifest → 运行时拼装 prompt 段
- **迁移流水**：
  - **前**：自动快照（复用 Phase 5A 的 `deck_versions`）
  - **中**：AI 读旧 md → 提取语义摘要 → 按新模板 manifest 的 layouts + frontmatter_schema + body_guidance 重写每页
  - **成功**：写新 md + 更新 `deck.template_id` + 入新 version + 前端 toast
  - **失败**：保留旧版本 + 错误提示 + 明示可 /undo

**验收条件**：

- [x] `company-standard` 挂 manifest 后 `pnpm test` 全绿（零回归）
- [x] **新建 deck 立即有 3 页骨架可预览**（mainTitle 占位「请填写标题」等），不再空白
- [x] `decks.template_id` 迁移脚本跑完，老 deck 均默认 company-standard
- [x] **Prompt A/B contract test**：≥10 条断言覆盖 7 个 layout 段 + 字段名 + bodyGuidance + 工作方式 / 输出约束 / promptPersona
- [x] `switch_template` API 单测：未 confirm 拒绝 / 跨用户 403 / job 状态机完整 / 失败回滚
- [x] 新增测试数 ≥ 20（实际 57 条：6A +17 / 6B +6 / 6C +17 / 6D +24 ＝ **57**）

**状态**：✅ 已完成（2026-04-24 关闭）

**依赖**：Phase 5 完成

**不做什么**：

- ❌ 第二套模板的视觉内容（Phase 7）
- ❌ 前端新建 deck 弹窗 / 编辑页切换 UI（Phase 7）
- ❌ 第三套及以上模板（后续迭代）

---

## Phase 7：A 模板重命名 + B 模板内容 + 切换 UI

**目标**：基于 Phase 6 架构完成三件事：(1) 把 Phase 6 交付的 A 模板从临时通用 id `company-standard` 重命名为真实所属公司 id `beitou-standard`（北投集团汇报模板）；(2) 交付第二家公司的模板 `jingyeda-standard`（竞业达汇报模板）；(3) 落地前端新建 deck 选择 + 编辑页切换完整 UI。

**命名约定**：`<公司 slug>-<用途>`（全拼音 + 小写 slug）。为同一公司未来的"festival / product-launch"等场景扩展预留对称结构。

**交付物**（4 子步，串行增量，每步独立 commit + 测试）：

- **7A：A 模板重命名 `company-standard` → `beitou-standard`**
  - 文件系统：`packages/slidev/templates/company-standard/` 目录改名为 `beitou-standard/`（用 `git mv` 保留历史），下属子文件仅 `manifest.json` 需要改内容，其余文件（tokens.css / layout md / logo.png / DESIGN.md / README.md 等）内容保持不变
  - `manifest.json`：`id` → `"beitou-standard"`，`name` → `"北投集团汇报模板"`，`description` / `promptPersona` 中"公司标准模板"字样同步更新
  - 代码 + 测试：全局 rename 所有字符串硬引用（约 98 处），含资源 URL `/templates/company-standard/...` → `/templates/beitou-standard/...`
  - DB schema：`decks.template_id` DEFAULT 从 `'company-standard'` 改为 `'beitou-standard'`（`drizzle-kit push`）
  - DB 数据迁移：`UPDATE decks SET template_id='beitou-standard' WHERE template_id='company-standard'`
  - **不保留 legacy alias**，硬切；`deck_versions.message` 里历史字串 "从模板 company-standard 初始化" **保持不动**（append-only 历史事实）

- **7B：B 模板 `jingyeda-standard` 设计 + 实现**
  - 启动前限时 brainstorm（1-2 天）敲定视觉风格（建议与 `beitou-standard` 强对比——极简学术风 / 深色活力风 / 杂志编辑风任选）
  - `templates/jingyeda-standard/` 目录新建：`DESIGN.md` / `tokens.css` / logo 素材 / 缩略图
  - layouts（数量自由 5-9 个，与 A 模板不强求一致）
  - L\* 内部组件（按需）
  - `manifest.json` 完整填写（含 `starterSlidesPath` 指向 3 页骨架 `starter.md`）

- **7C：前端选择 / 切换 UI**（设计已收敛，详见 [plan 14](../plans/14-phase7c-template-ui.md)）
  - **`TemplatePickerModal` 共用组件**：`mode='create'|'switch'` + `view='picker'|'progress'|'success'|'error'` 状态机；新建 deck 与切换模板复用同一组件
  - **picker 布局**：左列模板列表 + 右大预览（为多模板扩展），`switch` 模式右侧追加内联警告条 + 危险色主按钮"切换（AI 重写）"
  - **进度展示**：弹窗内 stage list + 进度条（`snapshotting → migrating → success`），progress 阶段禁止 Esc / 外部关闭
  - **结果反馈**：成功 → 弹窗内成功视图 → 用户点"查看"关窗 → 编辑页底部 `UndoToast` 6s 软提醒（带 /undo 链接直跳 VersionTimeline 高亮快照版本）；失败 → 弹窗保留 + 错误详情折叠 + retry/关闭
  - **轮询契约**：`useSwitchTemplateJob` composable 封装 POST + GET，前 45s @ 1.5s / 之后 @ 3s / 总 5min 超时；modal unmount 自动 abort
  - **缩略图机制**：manifest 加 `thumbnail` / `tagline` 字段；`scripts/generate-template-thumbnails.ts`（playwright + slidev cli）一次性生成 PNG 提交入库；新增模板时手跑 `pnpm gen:thumbnails`
  - **编辑页入口**：`DeckEditorCanvas` 顶栏 History 与 Settings 之间新增 `Layers` 图标 + "切换模板"按钮（沿用现有 toolbar 按钮样式 + lucide-vue-next 图标）

- **7D：E2E 场景（3 条新 spec）**
  - 新建 → 选 `jingyeda-standard` → deck 初始化 → 编辑器渲染
  - 旧 deck（`beitou-standard`）切换到 `jingyeda-standard` → confirm → AI 重写 → 内容合规
  - 切模板后 /undo → 回到旧模板 + 旧内容

**验收条件**：

- [x] **7A 零回归**：rename 后 `pnpm test` 全绿，全仓 `rg "company-standard"` 仅剩 `deck_versions.message` 里的历史字串
- [x] **7A DB 迁移幂等**：`decks` 表所有 `company-standard` 记录均迁到 `beitou-standard`，schema DEFAULT 同步更新
- [x] **7C 缩略图脚本幂等**：`pnpm gen:thumbnails` 重跑后 `git diff` 仅在内容真变时显示
- [x] **7C `TemplatePickerModal` 单测覆盖**：`mode × view` 状态机转移 + `useSwitchTemplateJob` 节奏 / 超时 / abort / retry
- [x] **7C 全链路 manual**：新建走 picker（E2E template-picker.spec.ts 冒烟通过）；编辑页切模板 happy + error 双路径完整 retry/cancel UI 已实现，单测覆盖（`progress 阶段点 X 关闭按钮无效`等）
- [x] `pnpm e2e` 全绿（原 5 条 + 7C 1 条冒烟 + 7D 3 条 = 9 条）
- [x] 两套模板双向切换可逆（/undo 回得去 + 无数据丢失） <!-- 7D-3 验证：切完 → undo toast → restore snapshot → DB.templateId 回 beitou + 内容字符串字节级一致 -->
- [x] 新建弹窗缩略图加载正常（首次 < 1s，懒加载）
- [x] 总测试数 335 → ~360（实测 294 agent + 71 creator + 3 shared = 368 unit + 9 e2e = 377 total）

**状态**：✅ **关闭**（2026-04-25）。**7A**（2026-04-25）+ **7B**（视觉骨架，2026-04-24/25）+ **7C**（2026-04-25，前端选择/切换 UI 全链路）+ **7D**（2026-04-25，E2E 切换流 + /undo 模板可逆 + creator 集成测基建）→ 详见 [plan 14](../plans/14-phase7c-template-ui.md) / [plan 15](../plans/15-phase7d-e2e-and-undo-fix.md)。原 [plan 13](../plans/13-phase7-template-rename.md) 仅覆盖 7A/7B。

**依赖**：Phase 6 完成

**不做什么**：

- ❌ 新增第三套模板
- ❌ 用户自定义模板（永久不做或留 Phase 16+，长期愿景见 [vision.md](./vision.md#远期愿景模板生态系统)）
- ❌ 模板市场 / 分享
- ❌ 为旧 id `company-standard` 保留兼容别名（硬切）

---

## Phase 7.5：模板分层重构（公共组件库 POC）

**目标**：把当前两套模板从"每套都重抄一份内容页部件"的写法，重构为 [vision.md 模板分两层心智](./vision.md#核心心智模板分两层) 描述的两层架构——第一层每套模板独有 5 个 Slidev layout（封面 / 封底 / 目录 / 章节标题 / 内容页骨架）+ 第二层所有模板共享的 Vue 组件库（**栅格 / 装饰 / 内容块** 三类，配色读 `--ld-*` token 自适应模板）。验证"切换模板时内容页**字节级无损**"这一核心产品断言。

**为什么现在做**：

- 只有 2 套模板时，抽公共组件成本最低；每多一套模板边际成本 ×N
- 现有两套模板已覆盖典型场景，是识别共性的最佳样本
- Phase 8 / Phase 9 都是工程性工作，让它们直接基于新干净架构扫一遍最划算
- Phase 10 上线后，重构成本暴涨（已有用户数据 / 模板 token 不能随意改）

**核心约束**：本 Phase 只做架构与重构，**不做**完整生态化（脚手架 / 市场 / npm 公开包），那些依赖足够多模板与第三方意愿，留 Phase 16+。

**交付物**（7 子步，串行增量，每步独立 commit + 测试；具体类名 / 文件路径 / 决策细节见 [plan 16](../plans/16-phase75-template-layering.md)）：

- **7.5A：token 规范定稿 + 校验脚本** — 颜色 / 字体 / 形状 / 阴影 4 类共 22 个 `--ld-*` token schema 落档；`validate-template-tokens.ts` 校验每套模板覆盖率
- **7.5B：两套模板按规范增补 tokens** — beitou / jingyeda 的 tokens.css 增补 `--ld-*` 别名指向 `--bt-*` / `--jyd-*`；模板私有 token 保留仅供 layer-1 装饰
- **7.5C-1：抽公共栅格组件（Layer 2A，8 个）** — TwoColLayout / ThreeCol / OneLeftThreeRight / OneRightThreeLeft / OneTopThreeBottom / TwoColumnsTwoRows（田字格）/ NineGrid / ImageTextLayout，提供 named slots
- **7.5C-2：抽公共装饰组件（Layer 2B，2 个种子）+ 装饰类规范文档** — PetalFour（花瓣 4 区）/ ProcessFlow（流程箭头）+ 装饰类未来扩展规范（CircleFour / Timeline / Pyramid 等留 backlog）
- **7.5C-3：抽公共内容块组件（Layer 2C，6 个）+ chart token rename** — MetricCard / KVList / Quote / Callout / BarChart / LineChart；旧 `LBeitouMetricCard` 清退
- **7.5D：layer-1 收敛到 5 + section-title NEW + AI prompt 重写 + deterministic 切模板路径 + 数据迁移脚本** — 删 `*-data` / `*-two-col` / `*-image-content`；新增 `*-section-title`；prompt 加"5 layout + 16 组件 + 决策树 + 5 档自由度"；`analyzeDeckPurity` 判 pure/level，pure 切模板走字符串替换跳 LLM，not-pure fallback LLM 重写；存量 deck 一次性迁移
- **7.5E：starter 改公共组件 + 文档完善 + 全测试通过 + 用户手验** — 两套 starter 用 layer-1 + 三类公共组件示范；COMPONENTS.md / TOKENS.md 完整化；用户人工双 deck 切模板比对验证（不写自动化字节级 E2E）

**验收条件**：

- [x] `--ld-*` token 规范定稿（**实际 26 项 4 类**——7.5E chart-primary 双 token 拆 chart-1..5 五色色板），`validate-template-tokens` 两套模板都过
- [x] 两套模板 layouts 从 7 收敛到 5（cover / back-cover / toc / section-title / content）
- [x] 全仓无模板私有 chart / 布局 / 媒体组件残留
- [x] AI 用三类公共组件生成内容页的 prompt contract test 通过（21 条断言）
- [x] 公共组件单测覆盖完整（栅格 18 / 装饰 6 / 内容块 14）
- [x] **切模板手验：内容字节级一致性人工通过 + 装饰组件几何一致 / 配色随 token 切换**（核心断言达成；用户在 dev 跑 demo deck 双向比对）
- [x] deterministic 切模板路径单测覆盖（`analyzeDeckPurity` 三类污染信号识别 + pure → 字符串替换 / not-pure → LLM fallback）
- [x] 现有所有 E2E 全绿（11 / 11）

**状态**：✅ 已完成（2026-04-26 关闭，实施详见 [plan 16](../plans/16-phase75-template-layering.md)）

**依赖**：Phase 7 完成（必须有两套模板对比才能识别共性）

**不做什么**：

- ❌ 模板创作脚手架 CLI / 模板市场 / 创作者经济（全部留 Phase 16+）
- ❌ 公共组件提 npm 公开包发布 / 模板 override 机制（同上 Phase 16+）
- ❌ 新增第三套模板（验证两套切换无损就够）
- ❌ 改 Phase 12 多 LLM provider 的实现节奏（独立工作）
- ❌ 改两套模板既有的最终配色
- ❌ **字节级自动化 E2E**（用户改为人工双 deck 比对；LLM 非 deterministic 不适合自动化字节比对）
- ❌ 装饰类组件首版超出 2 个种子（CircleFour / HexThree / TimelineHorizontal / PyramidLevels / VennTwo / FlowCircular / RadialSix 等按需加）
- ❌ 新 LLM 工具（公共组件靠 markdown body 透传，tools 数维持 10）

---

## Phase 8：依赖全量升级

**目标**：所有 monorepo 依赖升级到当前最新稳定版本，作为 Phase 9 安全 Audit 的版本基线；同时复检 P3-7（UnoCSS 图标 bug）和 P3-1（@antdv-next/x Slot warning）是否在新版本修复。

**核心规则**：**单包升级失败就退回，不深修。必要时发独立 PR 单独修（记入 tech-debt）。不在本 Phase 内修破坏性变更。**

**交付物**（具体包清单 / 升级策略细节见对应 plan）：

- 依赖盘点清单：当前版本 → 目标版本 → 破坏性变更 summary
- 分批升级 + 每批跑全量回归测试
- 触发事件复检：P3-7（UnoCSS 图标 bug）/ P3-1（@antdv-next/x Slot warning）等已知 tech-debt 在新版本是否修复，若已修则清理 workaround
- 锁定 pnpm-lock + Node 版本定版
- 升级结束跑一次前哨 audit（作为 Phase 9 的前置检查）

**验收条件**：

- [x] `pnpm outdated` 无 major 滞后（剩 2 条均有 verdict：`@types/node 25` 不跟非 LTS / `@antdv-next/x 1.0.2-beta.1` 不跟 beta，记入 tech-debt）
- [x] `pnpm audit --audit-level=high` = 0（15 moderate 全 transitive，直接依赖 0 漏洞；详查留 Phase 9）
- [x] 全量回归测试 100% 通过（361 agent + 71 creator + 38 slidev + 3 shared = 473 unit + 9 E2E = 482 total）
- [x] **P3-1 verdict**：✅ 已修（`@antdv-next/x 1.0.1` 通过 API 重构间接修复，content 完全做成 prop API）
- [x] **P3-7 verdict**：已复检 UnoCSS 66.6.8（slidev cli 52 内嵌版 = 主线最新版）仍未修，workaround 保留，下次 Phase 11/14 复检

**状态**：✅ 已完成（2026-04-26 关闭，详见 [plan 17](../plans/17-phase8-deps-upgrade.md)）

**实施摘要**（盘点后实际工作量比 plan 估的小约一半，多数依赖已是最新）：

- 真升的 14 项：8 个 patch/minor（vue/vite/vitest 4.1.4→4.1.5/hono/msw/eslint-plugin-vue/antdv-next/@vue/test-utils）+ 6 个 major（@hono/node-server 1→2/agent vitest 2→4/coverage 2→4/TS 5.8→6.0/根 TS 5.9→6.0/@types/node 22-24→24 LTS/@antdv-next/x 0.3→1.0.1）
- monorepo 内部对齐:agent 升上来对齐 creator+slidev 已有的 vitest 4 / TS 6 / coverage 4 / @types/node 24
- Node `engines.node` 全 6 个 package.json 固化 `>=22.0.0`
- 顺手清:eslint-plugin-vue 10.9 新增 `vue/no-mutating-props` 检查逮到 DeckEditorCanvas.vue 两处真实 prop mutation,改用 emit
- 关键改源码兼容 vitest 4:`src/mcp-registry/session.ts` dynamic→static import(production 等价,测试稳定)
- coverage 门槛微调:vitest 4 v8 AST remapping 让 statements/branches 按 AST 节点算分母变大,源码未变情况下 statements 90→89.83 / branches 85→83.83 微跌,门槛微调到实测之下 1pt buffer,Phase 9 audit 期补测拉回(99-tech-debt 已记)

**依赖**：Phase 7.5 完成

**不做什么**：

- ❌ 深修任何 major bump 引入的破坏性变更（失败退回 + 独立 PR）
- ❌ 主动降级任何包
- ❌ 引入新依赖

---

## Phase 9：安全 Audit L3

**目标**：部署前完整安全核查，保证 0 secret 泄漏 + 0 高危漏洞 + OWASP Top 10 全覆盖。产出可追溯的审计报告。

**产出要求**：正式 report 落档至 `docs/security/2026-XX-audit-report.md`，每项有证据（代码行号 / test case / config 位置）。

**交付物**（按 OWASP Top 10 对应）：

- **Secrets 扫描**：
  - gitleaks / trufflehog 全 git 历史扫
  - 代码硬编码搜（API key / password / master key pattern）
  - logger / console 输出审查
  - `.env.*.local` 不在任何 commit
- **A01 / A07 认证授权**：
  - 所有 state-changing API 端点清单：端点 / method / auth 守卫 / ownership 守卫
  - session cookie：`httpOnly + secure + sameSite=lax|strict`
  - 过期策略 + 续期
  - Slidev proxy 授权回归
  - MCP `/api/mcp/servers` requireAuth 验签
- **A03 注入 / XSS**：
  - Drizzle 全量核查：所有 `sql\`\`` 原始模板都参数化
  - Slidev md 写入：frontmatter 转义
  - Vue `v-html` 全仓搜索 + 白名单审查
  - Slidev iframe：`sandbox` 属性 + 同源策略
  - markdown-it sanitization
- **A01 CSRF**：state-changing fetch 凭证 + CSRF token（或 sameSite=strict 的豁免论证）
- **CORS / CSP**：
  - 生产 CORS allowlist（不要 `*`）
  - CSP 策略评估（Slidev 需 unsafe-inline 的部分明确豁免范围）
- **A06 依赖审计**：
  - `pnpm audit --audit-level=high` 必须 0
  - 可选：Socket.dev / Snyk
  - License 合规（GPL 依赖评估）
- **A04 错误信息泄漏 + Rate limiting**：
  - 生产不回 stack trace
  - 登录 / LLM proxy / 注册 限流评估
- **A09 日志脱敏**：log 结构化输出不含 PII
- **修漏洞 → 回归**：高危全修 + 单测补齐 + 再跑 audit
- **仓库卫生清理**（部署前缩减攻击面 + 减少新成员困惑）：
  - 一次性迁移脚本盘点：执行完成且无再用必要的直接删；确有保留价值则改写成通用参数化工具（具体清单按时点状态盘点，见对应 plan）
  - 保留脚本审查：每个 `scripts/` 下的脚本都给出"保留 / 通用化 / 删除"明确判定
  - 死代码清理：用 `ts-prune` 或同类工具找未引用导出
  - 已结案 plan 不强制移目录，路线图能找到入口即可

**验收条件**：

- [x] `pnpm audit --audit-level=high` = 0（Phase 8 已达，本次复核维持）
- [x] gitleaks 全历史扫 = 0 leaked secret（154 commits，加 .gitleaks.toml allowlist 后稳定）
- [x] OWASP Top 10 checklist 10/10 打勾 + 每项附证据（详 [`docs/security/2026-04-audit-report.md`](../security/2026-04-audit-report.md) 章 1-10）
- [x] 产出 `docs/security/2026-04-audit-report.md` 留存
- [x] 仓库内 `scripts/` 目录里所有脚本都能给出"保留 / 删除 / 通用化"的明确判定，无"过时但还在那"的状态（4 一次性脚本归档 docs/archive/scripts/，5 个基础设施保留）
- [x] **意外收获**：MCP server per-user 隔离（plan 期发现 Phase 5 遗漏的 A01 漏洞，9-F 修复）；Hono sub-router wildcard middleware 泄漏 bug（9-B 引入、9-C 修，提炼到 CLAUDE.md 已知坑）

**状态**：✅ 已完成（2026-04-26 关闭，详见 [plan 18](../plans/18-phase9-security-audit.md) + [audit-report](../security/2026-04-audit-report.md)）

**实施摘要**（8 个 Task / 8 个 commit）：

- 9-A 审计基建：装 gitleaks 8.30.1 + knip 6.7.0；全 git 历史扫 154 commits → 0 leak；pnpm audit 0 high / 15 moderate（全 transitive，dompurify 8 / uuid 1 / esbuild 1 / postcss 1，无 attacker-controlled input 路径）；License 无 GPL/AGPL 直接依赖；落档 audit-report 骨架 + checklist
- 9-B A01 路由鉴权：盘点出 8 个公开端点（plan 原本只列 2 个）含 `POST /api/call-tool` 严重漏洞（未登录可调 write_slides / mcp__\* 等敏感工具）+ slides.md 跨用户读漏洞，全部加 requireAuth + slides 端点加持锁守卫；agent +13 测
- 9-C A03 注入 / XSS + 联动修 Hono bug：iframe sandbox + vue/no-v-html lint rule + 修 9-B 引入的 Hono `slides.use('*', mw)` 经 `route('/api', sub)` 挂载后泄漏到 /api/* 全路径的关键 bug（happy-path e2e 一开始挂在 list-templates 401）；新建 routes-mount-integration.test.ts 用真 app.fetch 防再犯（10 测）；CLAUDE.md 加"Hono 路由"已知坑
- 9-F MCP per-user 入库（A01 大头，重）：`user_mcp_servers` 表 + DrizzleRepo（替代 JsonFileRepo）+ mcp-registry per-user `Map<userId, McpRegistry>` LRU 100 + tools/registry.ts 拆全局 + per-user 分区 + 工具命名 `mcp__<serverId>__<toolName>` 不变（不暴露 userId 到 prompt）；3 条跨用户隔离测；顺手修 mysql2 没 hoist 让 db:push 报错的工具链 bug（.npmrc public-hoist）
- 9-F2 .gitignore 加固：根加 `packages/agent/data/*` + `!.gitkeep` 防御层
- 9-D CSRF / CORS / CSP：origin-check middleware（POST/PUT/DELETE/PATCH 必带 Origin/Referer + 严格白名单 + dev 兜底 localhost + 路径豁免 auth/login|register|logout）+ CSP Report-Only（仅 prod 注入，含 `frame-ancestors 'self'` 防点击劫持，dev/test 不注入）；CORS 决策维持现状不加 middleware；联动修 routes-mount + creator integration shim + e2e webServer/helpers 自动带 Origin
- 9-E rate limit + error 脱敏 + log redact：rate-limit middleware（自撸 LRU + token-bucket）按 "用 agent 服务器资源" 边界限速（auth 5/15min/IP + log-event 60/min/user）；**LLM 刻意不限**（用户自有 key 自掏腰包，provider 自带 quota）；utils/error-response.ts helper（prod generic + errorId / dev 完整）接 auth.ts 加密路径；utils/redact.ts 深度递归过滤 password/apiKey/cookie/token/secret 等（不分大小写 + 子串匹配）+ truncate 超 64KB；logger 写盘前调 redact + truncate
- 9-G 仓库卫生：4 一次性脚本 git mv 到 docs/archive/scripts/（README 写来历 + 重新启用步骤）；knip baseline 落档（24 unused files 全为 false positive：Slidev 自动注册 / vitest workspace / @deprecated / runtime composables 等）；P3-15 coverage 拉回放弃 → 锁定新基线 lines 90 / branches 80 / functions 85 / statements 87（per-file 95+ 高门槛保留）；99-tech-debt 写明长期 verdict

**测试增量**：
- agent: 361 → 428（+67）
- creator: 75 → 79（+4 SlidePreview.security）
- slidev: 38 不变
- shared: 3 不变
- e2e: 9 不变
- **总数 482 → 557（+75）**

**依赖**：Phase 8 完成

**不做什么**：

- ❌ 非 L3 范围合规认证（ISO27001 / SOC2）
- ❌ 外包 pen test（本次自审）
- ❌ SAST / DAST 工具链集成到 CI（留后续）

---

## Phase 10：首次部署（单实例上线，原 Phase 5.5 下沉）

> 实施计划：[plan 19](../plans/19-phase10-production-deploy.md) ｜ 操作指南：[runbook](../runbooks/deploy.md)
> 服务器：复用 quiz `47.120.26.143` ｜ 域名：`lumideck.illegalscreed.cn`

**目标**：把 Phase 5 完成的单用户+占用锁版本（+ Phase 6-9 的模板+依赖+Audit）真正放到服务器上跑起来，提供对内可用的 MVP，验证端到端链路。

**交付物**（具体反代选型、进程编排方案、备份策略见对应 plan）：

- 服务器环境准备：自有域名 + HTTPS
- 进程编排：编辑/agent/前端静态/数据库四个角色都有运行机制
- 数据库生产部署：复用既有实例或独立部署
- 密钥下发机制：通过环境变量或 secret 管理工具，**绝不进 git**
- 数据库定时备份：版本数据是核心，需要可恢复
- Healthcheck 端点：覆盖 DB 连接与编辑实例状态
- 最小日志监控：能 tail 看近期错误
- 单实例下"使用中"等待页 UX 打磨
- 首次部署 runbook 落档

**验收条件**：

- [x] 公网域名可访问，HTTPS 证书正确(Let's Encrypt 至 2026-07-26,certbot.timer 自动续期)
- [x] 注册 → 登录 → 建 deck → 列出 → 登出 → 重登全流程通(API 层 smoke 6/6 + 用户浏览器手验)
- [x] 编辑(改标题 / 切模板 / 切回历史版本)— 用户手验通过
- [x] 第二浏览器无痕登录另一账号 → 进同 deck URL → OccupiedWaitingPage — 用户手验通过
- [x] agent 崩溃/重启后，数据全在(`pm2 restart lumideck-agent` 后 `users.count=1` `decks.count=1` 保留)
- [x] DB 备份文件每日一份，可恢复(crontab 02:00 + 手动跑产 390 字节 valid sql.gz;mysqldump 8.0.45 装好)
- [x] **无任何敏感文件出现在 git 历史**(`git log -p -S` 全检查,真值 0 leak;.env.production.local gitignored)
- [x] healthz status:ok(DB 34ms / Slidev 5ms;`/api/healthz` + `/healthz` 双挂载)

**状态**：✅ 已完成(2026-04-27 关闭,详见 [plan 19](../plans/19-phase10-production-deploy.md))

**实施摘要**(11 commit):

- **代码侧**(3 commit):agent /api/healthz 增强版(DB ping + slidev reach + uptime + gitSha)+ deploy/ 脚手架(nginx 模板 + pm2 ecosystem + 远端脚本)+ scripts/deploy.sh 一键部署(creator/backend/ecosystem/healthz/all 子目标 + 安全防误触 confirm)
- **跨过 6 条实施期踩坑**(全部提炼到 CLAUDE.md):
  1. macOS openrsync 协议 29 vs 远端 rsync 协议 31 不兼容 → brew install rsync
  2. Alibaba Cloud Linux 用 dnf 不是 apt
  3. nginx HTTPS 必须分两阶段 bootstrap(80-only conf → certbot --webroot → 完整 conf,否则坏 conf 写入风险拖死全 nginx)
  4. monorepo ts 包 NodeNext ESM 必须先 build 出 .js(packages/shared 加 build script)
  5. pm2 跑 ESM Node app 用 bash wrapper + dotenv-cli,不要走 -r dotenv/config + DOTENV_CONFIG_PATH(不可靠)
  6. agent fetch slidev 用 localhost 不用 127.0.0.1(slidev v52 + Vite 5 默认只 bind [::1] IPv6)
- **基础设施落地**:阿里云 RDS 复用 quiz 实例新建 lumideck 库 + lumideck_prod_user(init-db.mjs 加 --allow-prod 保留护栏);Let's Encrypt certbot --webroot 申请;crontab 02:00 daily mysqldump 备份保留 30 天
- **性能优化**:nginx gzip(JS/CSS gzip_types,大 chunk 2.35MB → 632KB,加载时间 5.32s → 1.15s = -78%);lumideck-slidev NODE_ENV=development 修复 Vite `__DEV__` build-time constant 注入
- **测试增量**:agent 428 → 434(+6:healthz 5 + mount-integration 1)

**依赖**：Phase 9 完成

**不做什么**：

- ❌ 多实例并发（Phase 11)
- ❌ CDN / 多地区部署
- ❌ 自动化 CI/CD 流水线（Phase 16+)
- ❌ 监控告警 / Sentry / Datadog（MVP 用 pm2 logs + healthz 巡检足够)

---

## Phase 10.5(候选,待 spike)：Slidev 解耦 — DeckRenderer Vue 组件自封装

> **状态**:候选 / **未启动 spike**
> 触发条件:Phase 10 上线后实测编辑首屏体验(gzip 后 30-40s)无法接受,或开始规划 Phase 11 时一并评估

**目标**:把 Slidev iframe 形态的预览器换成 creator SPA 内的 `<DeckRenderer markdown=".." templateId=".." />` Vue 组件,从根本上解决 dev mode 几百个 Vite module 累积加载慢的问题,顺便简化整套部署架构。

**为什么**(架构层面的问题,Phase 11 不解决):

- Phase 11"多 Slidev 实例 + 双路径"中,**编辑路径仍然必须跑 Slidev dev mode**(依赖 HMR),首屏几百个 Vite module 串行加载的问题没有改善
- iframe 隔离带来的复杂度(跨 frame state 同步、cookie 鉴权代理、Phase 9-C sandbox 警告、agent 内 http-proxy 反代)在 Phase 11 不消除反而放大(进程池 N 倍 iframe)
- Phase 7.5 公共组件库(grid/decoration/block 16 个 + layer-1 layout 5×2)本来就是普通 Vue 组件,接到 SPA 里直接用 = 主动权完全收回

**核心思路**:

- 自写 `<DeckRenderer>`:接收 markdown 文本 + templateId 作为 prop,内部解析 frontmatter + `---` 分页,按 layout 字段动态 `<component :is>` 渲染对应 layout(beitou-cover / jingyeda-content 等)
- HMR 等价于 Vue 响应式 prop 更新(改 markdown → reactive trigger → 重渲染那一页,毫秒级)
- 跟 creator 一起 vite build,Rollup 打包成几个大 chunk,加载秒开
- iframe / agent http-proxy / lumideck-slidev 进程全部消失,部署架构大幅简化

**前置 spike**(1-2 天,通过后才正式立 plan 20):

- 写最小 `<DeckRenderer>` 组件渲染一个真实 deck:cover + content + back-cover 3 页
- 全仓 `rg "$slidev|$nav|useNav\("` 统计两套模板对 Slidev runtime API 的依赖,**这是估算真实工作量的硬数据**
- 验证 markdown 解析(unified/remark)+ layout 注册 + 公共组件渲染 + UnoCSS 配置迁移可行

**预计工作量**(spike 通过后):5-8 天交付 Phase 10.5,**同时 Phase 11 的进程池实现废弃,Phase 11 范围缩水**(细化 deck-level 锁 + 容量 spike + 分享链接)

**风险点**:

- markdown parser 边界(嵌套代码块 / Slidev 特殊指令)— unified/remark 生态成熟
- `<v-clicks>` / `<v-click>` 渐进动画 — 内部汇报场景几乎不用,可放弃或自写 30 行 Vue
- Slidev 全屏演示模式 — 自写 `<PresentationMode>`,简单
- **真正硬骨头**:templates layouts 用了多少 `$slidev.nav` 类 Slidev 注入 API,spike 期 grep 决定

**不做什么**:

- ❌ 完全替代 Slidev 所有功能(不做演讲者模式 / 录制 / 标注 / 黑板,我们是编辑器不是演讲软件)
- ❌ 重写 Slidev md parser 的所有边缘 case(用 remark / unified 抹平)
- ❌ 提供编辑器 inline 编辑 markdown(仍然 LLM 对话改 → DB 持久化 → 组件 reactive 刷新)

---

## Phase 11：多用户并发 + 分享链接 + 多实例部署切换

> **依赖 Phase 10.5 spike 结果调整范围**:若 P10.5 落地,本 Phase 的"进程池 + LRU + 崩溃重拉 + 双路径切换"全部废弃(Vue 组件天然支持多用户),退化为"细化 deck-level 锁 + 分享链接 + 容量 spike"。


**目标**：解决单实例天花板，让多用户真正并行编辑自己的 deck。同时上"公开分享"场景——只读链接不占编辑实例。多实例版本的部署切换并入本 Phase 尾段。

**核心思路**（详细架构 + spike 设计 + DB schema 见对应 plan）：

- **编辑路径**：每位活跃用户分到独立编辑实例（进程池 LRU，上限由容量 spike 实测决定），HMR 体验保留
- **分享路径**：保存即触发构建，产物静态托管；只读访问不占实例，水平可扩展
- **前置 spike**：本 Phase 开头先实测服务器承载能力（编辑实例稳态内存/CPU + 可并发数），结果决定进程池上限与排队策略

**交付物**：

- 服务器容量 spike 报告（实测数据 + 可并发实例数结论）
- 编辑实例进程池管理：on-demand spawn / 空闲回收 / LRU 淘汰 / 崩溃自动重拉 / 健康检查端点
- 拆除 Phase 5 的单实例占用约束（按实例粒度的 lease 取代）
- 编辑实时保存（debounce）→ 实例 HMR 自然生效 + 入版本历史
- **发布 / 分享**：触发 build → 产物归档 → 通过分享链接静态访问；分享链接表管理过期与撤销
- 并发控制：同一用户多 deck 编辑上限；同一 deck 同时刻只允许一个 tab 编辑
- **多实例部署切换**（本 Phase 尾段）：反代按 session 路由 + 灰度切换 + 不中断现有用户

**验收条件**：

- [ ] 容量 spike 报告完成，上限数字有实测依据
- [ ] 多个不同用户同时登录、各自进入自己的 deck 编辑页，预览各自独立，互不干扰
- [ ] 超过上限时最老实例自动回收，用户重新进入再 spawn 时长可接受
- [ ] 分享页不占用进程池
- [ ] 压测：上限数量 deck 同时活跃 + 高并发打分享页，资源占用在预算内
- [ ] 进程崩溃 / OOM 自动重拉，不丢用户已保存的 content（源在 DB）
- [ ] 生产环境从单实例版本切到多实例版本，用户无感知中断

**状态**：待开始

**依赖**：Phase 10 完成（生产单实例版本必须先稳跑一段时间）

**不做什么**：

- ❌ 多人实时协同编辑同一 deck（CRDT / OT）— 复杂度太高，留 Phase 16+ 或永不做
- ❌ 跨服务器分布式进程池 — 单机上限实例已够内部 50 用户场景

---

## Phase 12：多 LLM Provider 原生接口（Anthropic Claude + Google Gemini）

**目标**：当前 LLM 调用收敛在"OpenAI 兼容接口"（智谱 / DeepSeek / OpenAI）。新增 Anthropic Claude 和 Google Gemini 的**原生**接口适配，避免走"OpenAI 兼容代理"丢失原生能力（system prompt 风格、工具调用形式、流式协议差异）。让用户能按场景自由选 provider，不被单一供应商锁死。

**交付物**（具体 SDK / 抽象层 / DB shape 设计见对应 plan）：

- **Provider 抽象层**：把 LLM 调用从"OpenAI SDK 直调"抽出统一接口（chat / streaming / tool calls / cancel），现有实现纳入该接口
- **新增两个原生 provider 适配**：分别处理 Anthropic Claude 与 Google Gemini 的消息结构、工具调用格式、流式协议差异
- **统一工具调用契约**：保证 MCP 工具命名规范在三家 provider 都能跑通
- **前端 LLM 设置升级**：用户可在三个 provider 间切换，每个 provider 独立配置 API key、模型、可选 baseUrl
- **存储 schema 升级**：用户 LLM 设置字段升级为 per-provider 结构，老数据自动迁移
- **测试**：每个 provider 的 happy path + 工具调用 + 流式 + 取消

**验收条件**：

- [ ] 三家 provider 任一都能完整跑通"对话生成 8 页 deck + 多轮工具调用 + 流式输出 + 取消"
- [ ] 切换 provider 不需要改业务代码
- [ ] 用户可在前端自由切换 provider，API key per-provider 独立加密存储
- [ ] 老用户的 LLM 设置自动迁移到新 schema 不丢

**状态**：待开始

**依赖**：Phase 11 完成

**不做什么**：

- ❌ Fine-tuning / 自托管模型（Ollama / vLLM）— 留 Phase 16+
- ❌ Provider 价格估算 / 用量统计页（同上）
- ❌ 自动按任务类型路由 provider（手动选）

---

## Phase 13：预制 MCP 服务扩展（catalog）

**目标**：当前只预置了 3 个智谱 StreamableHTTP MCP（web-search / web-reader / zread）。把社区与官方常用且对 PPT 创作有直接增益的 MCP 整理成 catalog，降低用户接入成本。每个预置卡片填好 endpoint、必要 headers、场景说明，让用户从"加 MCP"流程减到分钟级。**同时本 Phase 引入 stdio transport 支持**，让 npx-only 的 MCP（如智谱视觉理解）可用，并解封 [packages/agent/src/mcp-server-repo/presets.ts](../../packages/agent/src/mcp-server-repo/presets.ts) 里的 `UNSUPPORTED_SERVER_IDS` 黑名单。

**交付物**（具体候选名单 / 接入细节见对应 plan）：

- **stdio transport 支持**：agent 接 `@modelcontextprotocol/sdk` 的 `StdioClientTransport`（spawn 子进程 / 生命周期管理 / 跨平台 npx 处理 / 部署侧 node 与 npx 可达性），让 stdio-only MCP（zhipu-vision 等）可用；解封 `UNSUPPORTED_SERVER_IDS` 并把 zhipu-vision 加回 `PRESET_MCP_SERVERS`
- **MCP catalog 调研**：从社区与官方目录中筛选 5-8 个对 PPT 创作链路最匹配的预置候选，落档候选名单 + 选型理由
- **catalog 卡片**：每个 MCP 在前端"MCP Servers"tab 里独立卡片，含 name / description / endpoint / required headers / 场景说明 / 接入步骤
- **catalog 分组**：按"内容素材 / 数据获取 / 文档协作 / AI 推理增强"等场景分组展示
- **兼容性测试**：每个新 MCP 的 transport 通畅 + 工具命名规范不破 + 至少 1 个工具能 list
- **安全审查**：每个新 MCP 的 token / OAuth 流程评估，敏感 header 走加密存储
- **接入文档**：每个预置 MCP 的步骤说明 + 已知坑（rate limit / 必要权限 / 网络可达性）

**验收条件**：

- [ ] stdio transport 跑通；zhipu-vision 解封后能从前端勾"复用 LLM Key" → 启用 → 工具进入工具栏 → AI 调用成功
- [ ] 至少 5 个新预置 MCP 可用，覆盖至少 3 个场景分组
- [ ] 用户从 catalog 点击预置卡片 → 填 token → 工具立即出现在工具栏 → AI 能调用，全流程 < 1 分钟
- [ ] 老用户已配置的 MCP 不受影响，schema 向前兼容
- [ ] 每个新预置都有集成测验证

**状态**：待开始

**依赖**：Phase 12 完成

**不做什么**：

- ❌ 自建 MCP server 的孵化 / 商业化分发
- ❌ OAuth 全自动化（部分需用户手动建 token）
- ❌ MCP server 健康监控 / SLA 看板（留 Phase 16+）

---

## Phase 14：导出

**目标**：让用户把 deck 带离系统——离线演示、归档、发给不登录的人看。

**交付物**（具体导出工具链与表结构见对应 plan）：

- **PDF 导出**（优先）：后端触发任务，产物归档，前端下载
- **图片序列导出**（PNG 每页一张）
- **PPTX 导出**（可选，探索性）：评估几条候选实现路径，成本可控再做
- 导出历史：可查看 / 重新下载
- 前端编辑页加"导出"入口

**验收条件**：

- [ ] PDF 导出耗时 < 20 秒，视觉与预览一致
- [ ] 导出页可查看历史导出记录，可重新下载
- [ ] 导出进程隔离于编辑实例，不影响正在编辑的用户

**状态**：待开始

**依赖**：Phase 13 完成

**不做什么**：

- ❌ PPTX 导出如成本过高（>5 天工时）则延到 Phase 16+

---

## Phase 15：导入

**目标**：降低新用户冷启动成本——已有 Markdown / PPTX 资料可以一键变 deck。

**交付物**（具体解析链路与候选转换工具见对应 plan）：

- **Markdown 导入**（优先）：粘贴 / 上传 / URL 拉取均支持
- 校验语法 + 转新 deck + 初始 version
- **PPTX 导入**（可选，探索性）：评估几条候选转换路径的质量，效果可接受再做
- 导入预览页让用户确认后落库
- 失败场景给出可操作的提示（行号 / 原文保留让用户手动修）

**验收条件**：

- [ ] 粘贴标准 Slidev md 能完整导入，页数准确
- [ ] 粘贴非 Slidev 标准 md（如普通博客）能"尽力而为"转成 deck，给出警告提示

**状态**：待开始

**依赖**：Phase 14 完成（或与 P14 并行）

**不做什么**：

- ❌ PPTX 导入如效果差（>30% 页面需手动修）则延到 Phase 16+

---

## Phase 16+：远期可能

**可能方向**：

- 多人实时协同编辑同一 deck（CRDT / OT）
- 多语言支持
- **模板生态系统**（模板分两层：第一层 5 个 layout 模板独有 / 第二层内容页部件全部沉到公共组件库；创作者工具链 + 模板市场 + 公共组件库 + 主题色 token 规范）— 详见 [vision.md#远期愿景模板生态系统](./vision.md#远期愿景模板生态系统)。一旦落地，新模板的工作量从"完整一套视觉 + 8 layout + 5 chart"降到"5 个 layout 骨架 + 一份合规 tokens.css"，AI 生成内容页时只决定语义不再决定视觉，用户切模板内容完全无损
- 分享链接的权限扩展（访客评论、过期策略、访问日志）
- 嵌入到其他站点（iframe / OEmbed）
- 自动化 CI/CD 流水线（GitHub Actions 自动部署）
- LLM 微调 / 自托管模型（Ollama / vLLM）+ 多 provider 用量统计与成本看板
- MCP server 健康监控 / SLA 看板
- **日志系统体系化**(用户量上 50+ 后再做):当前 agent 业务日志走 jsonl 文件(`creator-YYYY-MM-DD.jsonl` 按天 rotate + payload 单文件分子目录),Phase 10 已加 ctx 派生的 userId / deckId 索引字段(`jq 'select(.userId == 5)'` 可过滤),pm2 进程日志走 pm2-logrotate。**当前不足**:跨用户/跨 deck 检索仍要 grep + jq 手撸,无 admin 查询页;`/root/server/lumideck/logs/` 文件无自动清理(creator-*.jsonl 按日期分但永不删);`logs/payloads/<session>/` 子目录会无限堆积。**Phase 16+ 候选改造**:(a) 新增 `agent_events` 表持久化索引行(deckId/userId/sessionId/kind/ts 索引)+ payload 仍落 fs,db 只存路径;(b) admin 查询页(按 user / deck / 时间 / kind 过滤);(c) 加 cron 清理 N 天前的 creator-*.jsonl + payloads/*;(d) 接 Loki / OpenSearch(过早,内部场景过度工程化)
- `slides.md.history` 环形缓冲升级（P2-2 已随 Phase 5 的 deck_versions 天然解决，可复盘是否还需要文件级 undo）

---

## 路线图变更记录

| 日期       | 变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 原因                                                                                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-20 | Phase 2 关闭，验收条件写入；MCP 计划（04）合并进 Phase 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 2 范围已超出"原型验证"；MCP client 应跑在独立 agent 后端而非 Vite middleware                                                                                                                                                                                                                                                               |
| 2026-04-20 | Phase 3 新增"测试基础设施"、明确 BarChart/LineChart 组件迁移                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 重构前补网；根目录杂散组件应进 monorepo                                                                                                                                                                                                                                                                                                          |
| 2026-04-20 | Phase 4 新增"slides.md 架构升级"、工具拆分                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | write_slides 一次吐 16KB 5 分钟才完，架构撑不住编辑场景                                                                                                                                                                                                                                                                                          |
| 2026-04-21 | Phase 3 拆为两步：本轮只做 monorepo + agent + 工具链基建，MCP 延到 07-mcp-integration.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 04-mcp 原计划寄生于 Vite middleware；先做后端独立再做 MCP，减少返工                                                                                                                                                                                                                                                                              |
| 2026-04-21 | Phase 3 关闭（9 步迁移，P1-1/P1-2 骨架/P1-3/P1-4 技术债清除）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 按 06-phase3-monorepo-agent.md 计划执行完成，验收条件全部满足                                                                                                                                                                                                                                                                                    |
| 2026-04-21 | Phase 5/6/7 重排：插入"用户系统+DB+历史版本"（5）与"多用户并发+Deck 运行时"（6），原导出部署顺延为 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 用户提出用户系统 / 历史版本 / 多用户并行需求；Slidev 单实例是关键瓶颈，必须先解好才能上分享与部署                                                                                                                                                                                                                                                |
| 2026-04-21 | Phase 3.5 关闭：MCP 集成 + 本地工具 register 进 agent registry + 前端 GET /api/tools 动态化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 按 07-mcp-integration.md 执行完成，P1-2 完全清零                                                                                                                                                                                                                                                                                                 |
| 2026-04-22 | Phase 3.6 关闭：creator design tokens + DESIGN.md；品牌身份 Lumideck · 幻光千叶；P3-8/P3-9 新增                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 按 08-phase36-frontend-polish.md 执行完成                                                                                                                                                                                                                                                                                                        |
| 2026-04-22 | Phase 4 关闭：P1-5 / P2-1 / P2-2 / P2-3 / P3-6 清零；slides.md 800→90 行；四件套工具 + /undo /redo 轮次聚合；Phase 5 补 `deck_chats` 表 + 切版本保留对话验收条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 按 09-phase4-edit-iterate.md 执行完成，路线图 3 条验收条件全部达标                                                                                                                                                                                                                                                                               |
| 2026-04-23 | Phase 5 技术栈 SQLite+argon2 → **MySQL+bcrypt**（drizzle push 模式）；Phase 5 范围追加**单实例占用锁**（`slidev_lock` + heartbeat + 等待页）；新增 **Phase 5.5** 首次单实例部署；Phase 6 改为"多实例 + 多用户并发 + 多实例部署切换"合并；原 Phase 7（导出+部署）拆为 **Phase 7 导出** 和 **Phase 8 导入**；原 Phase 8 远期重编号为 Phase 9+                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 用户希望 Phase 5 完成后就具备单实例上线条件；MySQL 便于后续多实例共享存储；bcrypt 与既有 quiz-backend 经验复用                                                                                                                                                                                                                                   |
| 2026-04-23 | Phase 5 关闭（Pre-5A + 5A + 5B + 5B-refactor + 5C + 5C-fix + 5C-UX + 5C-polish，共 8 条 commit）。实施期偏离：单实例锁从 `slidev_lock` 表改为 agent 进程内存对象；新增 Slidev 反代鉴权（`/api/slidev-preview/*` + 非锁持有者 403）防止预览泄露；deck 编辑页标题双击 inline 改名                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 内存锁天然原子 + 绕开循环外键/时区坑；Slidev `:3031` 原生对外暴露是 P5.5 上线前的硬漏洞；UX 细节                                                                                                                                                                                                                                                 |
| 2026-04-23 | Phase 5 补测轨道关闭（docs + 8 条 commit = 9 条）。env 拆成 development/test/production 三层（dotenv-cli 驱动）；新增 `packages/e2e` workspace（Playwright + chromium）；agent 覆盖率 lines 94.63 / branches 86.15（90/85 门槛过），creator 80.82 / 72.22（75/65 门槛过）；测试数 148 → **262**（agent 208 + creator 49 + E2E 5）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 用户明确要求单测 + 集成测 + E2E 全覆盖；测试 DB 隔离需要 env 分层；覆盖率门槛变为 CI gate 基础                                                                                                                                                                                                                                                   |
| 2026-04-23 | P2-4 提前清：`JsonFileRepo` 用 AES-256-GCM 加密 `data/mcp.json` 里的 headers value；`/api/mcp/servers` 补 `requireAuth`（修 Phase 5 遗留未登录读 token 漏洞）+ GET 脱敏 + PATCH 支持 `***` 保留旧值；前端 `MCPCatalogItem.vue` 适配。测试 262 → 268                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 用户要求 Phase 5.5 部署前清技术债；兼顾扫出的真实安全漏洞                                                                                                                                                                                                                                                                                        |
| 2026-04-23 | **Post-Phase 5 路线图重规划**：部署前插入 Phase 6（模板架构）/ Phase 7（第二套模板+UI）/ Phase 8（依赖全量升级）/ Phase 9（安全 Audit L3）四个产出周期。原 Phase 5.5 部署下沉为 **Phase 10**；原 Phase 6（多实例）→ Phase 11；原 Phase 7（导出）→ Phase 12；原 Phase 8（导入）→ Phase 13；原 Phase 9+（远期）→ Phase 14+。Phase 5 与之后所有 Phase 的"不做什么"/"依赖"编号同步更新                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 用户要求部署前做完模板扩展（第二套模板 + 切换 UI）与全量安全 review（含依赖升级为前置）。Gate 严格串行：6→7→8→9→10 不可并行（除 6 尾段可起草 7 设计稿）                                                                                                                                                                                          |
| 2026-04-24 | Phase 6 实施计划落地：[plan 12](../plans/12-phase6-template-architecture.md) 拆 6A（manifest + starter 骨架）/ 6B（decks.template_id + createDeck 加载 starter）/ 6C（prompt 迁 agent + A/B contract test）/ 6D（switch-template 迁移流水）四步增量；manifest 新增 `starterSlidesPath`，新建 deck 即带 3 页骨架预览（封面「请填写标题」/ 内容页占位 / 封底），不再空白；`theme_id` 和 `template_id` 并存不合并；不加 feature flag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 用户确认部署前先建完整模板架构；seed 骨架痛点（新建 deck 右侧预览空白）纳入 6A/6B 一并解决；theme variant 语义留给未来                                                                                                                                                                                                                           |
| 2026-04-24 | Phase 6 关闭（4 条 commit：6A/6B/6C/6D）。实施期偏离：无重大偏离；`switch_template` 工具加入 tool registry（tools 数 9→10），LLM 重写由 `RewriteFn` 可注入 DI 替换便于单测。测试 262+6(6A) → 268+6(6B) → 274+17(6C) → 291+24(6D) ＝ **281 条 agent 本底**（281 + creator 49 + E2E 5 = 335 总数）；coverage lines 94.44 / branches 85.75 维持 90/85 门槛                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 按 plan 12 拆四步完成，无需偏离；RewriteFn DI 让 LLM 不可用场景下也能完整测试状态机                                                                                                                                                                                                                                                              |
| 2026-04-24 | **Phase 7 范围调整**：拆为 **7A / 7B / 7C / 7D** 四子步。7A = A 模板从临时 id `company-standard` 重命名为真实公司 id `beitou-standard`（北投集团），硬切无 alias + DB UPDATE 迁移 + schema DEFAULT 改名；7B = 第二家公司竞业达模板 `jingyeda-standard`；7C = 前端选择/切换 UI；7D = 3 条新 E2E spec。**命名约定确立**：`<公司 slug>-<用途>`（全拼音小写），预留同一公司多套场景扩展空间                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A 模板原 id `company-standard` 过于通用，第二套模板即将引入需要对称命名；硬切避免长期 legacy 债；Phase 7 开始前定死命名约定防止 B 模板命名时再返工                                                                                                                                                                                               |
| 2026-04-24 | **Phase 7B 关闭**（视觉骨架，5 条 commit：333a024 / 0fb253a / b4be7fd / 58e23e5 / cef6944）。jingyeda-standard 完整模板视觉骨架（tokens.css 用 `--jyd-*` 命名空间 / 7 个 `jingyeda-*` layout vue 子目录化 / `LJydHeader` 共用顶部色条 / chart 组件改为 CSS 变量取色 / 仿宋 + 微软雅黑双字体栈 / em + fr + % 全比例化）。实施期偏离：用户临时调整执行顺序为 7B → 7A 而非串行 7A→7B（"先把视觉调好再做工程化"）；jingyeda manifest 暂无 thumbnail（参考图不应作缩略图，留 7C 实现 slidev 截图机制时统一补）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 用户给定竞业达 5 张 PPT 参考图后多轮迭代视觉（封面三段比例 / banner 2×2 grid / 字体颜色 / 信息栏 grid 居中 / header 三段色块 + 外阴影 / 封底 message+org 分层 + 等宽 等），每轮在前端预览验证                                                                                                                                                    |
| 2026-04-25 | **Phase 7A 关闭**（5 条 commit：284b90a tokens 命名空间 / cfbad77 模板目录+字面量+DB schema+资源 URL / 23ab769 layouts/components 加 beitou 前缀+子目录+manifest layout name / 7e9e699 删 public/templates 冗余副本 / e6918e1 chart fallback 改中性灰 + beitou-data 显式注入）。`templates/company-standard` → `beitou-standard` 全套硬切重命名，零 alias；DB schema DEFAULT 同步 + 新增 scripts/rename-template-id.ts 一次性数据迁移脚本（dev/prod 各跑一次，幂等）。实测 slidev cli vite server.fs.allow 默认放开 user root，`public/templates/` 副本冗余可删。测试 281 + 49 + 5 = 335 全绿，全仓零 `company-standard` 字面量残留（仅 rename 脚本保留 FROM_ID 常量）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | plan 13 拆 11 个 task，实际执行时把强耦合的 7A-2/5/6/7 合并为单一 commit cfbad77 避免中间红测试状态；plan 13 不变，作历史记录                                                                                                                                                                                                                    |
| 2026-04-25 | **Phase 7C 关闭**（前端选择/切换 UI 全链路）。subagent-driven 模式跑 plan 14 共 8 个 task，14 条 commit：c3b440d tagline manifest 字段 / 444f76b 缩略图 playwright 自动截图脚本（含 a5612f7+89ba35c 修 JSDoc 里 \*​/​ 字面提前关闭注释 bug + scripts/tsconfig.json + tsx 显式 dep）/ 8529f7c useSwitchTemplateJob 5+1 单测（含修 plan 原 migrating progress 钳到 0.51 不动的 bug）/ 5bb2431 TemplatePickerModal 共用组件 4 测 + Teleport + disableTeleport prop（VTU 2 不跨 Teleport 边界 query）/ 340c8f7 switch 模式打通 + DeckEditorCanvas 顶栏 Layers 按钮 + X 按钮 progress 守卫 / b103164 progress/success/error 三视图 + emit 类型修语义错误（newVersionName→newTemplateName）/ 2eb4303 UndoToast + VersionTimeline highlight pulse + DeckEditorCanvas 联动 + onUnmounted 清 timer / 9c62e5c E2E 冒烟（顺手修了 7C-4 引入的 /list-templates 缺 /api 前缀 prod bug + 加 \_test/reset-lock 解 lock-conflict 后续测试 409 + happy-path 适配 picker modal 流程）。测试 335 → 281+72+3 = 356 unit + 6 e2e = 362（实超预期 +8）。完整 3 条切换流 E2E 留 Phase 7D / plan 15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | subagent-driven-development 流程：每 task 派 implementer → spec reviewer → code reviewer 三段；多次踩到 plan 自身 bug（JSDoc closure / migrating 公式 / emit 字段语义）后用 fix commit 同步修 plan + 加 prevent-regression 测试，"plan 是活文档，发现错就改"；过程中暴露 7C-4 的 API 路径 prod bug + lock 跨测污染基础设施缺陷，归在 7C-8 一并修 |
| 2026-04-25 | **Phase 7D 关闭**（plan 15，4 task / 4 commit + plan doc）。**7D-A** schema bug 修：`deckVersions` 加 nullable `template_id` 列（drizzle push dev + lumideck_test）+ `template-switch-job` snapshot 写 fromTemplateId/新 version 写 toTemplateId + `routes/decks` restore 端点 fallback 同步 `decks.template_id`（旧数据 NULL 不动向前兼容）；测试 +4 涵盖 3 种 restore case + db-schema 列存在；这是 7D-3 双向可逆的硬前置。**7D-B** `rewriteForTemplate` 加 `BIG_PPT_TEST_REWRITE_MODE=skeleton` 分支：env 命中时直接 `readStarter(toTemplateId)` 跳 LLM；测试 +2。**7D-C** P3-10 全清：`packages/agent/src/app.ts` 抽出 Hono app 单例（不带启动副作用，仅装配）+ creator `package.json` 加 workspace dep + 新建 `test/_setup/integration.ts`（loadDotenv .env.test.local + 替换 globalThis.fetch 为 app.fetch shim + cookie jar + 透传 useTestDb/factories）+ `vitest.config.ts` 加 `fileParallelism: false`（共享 lumideck_test 必须串行）；3 个契约 spec 改造：useAuth 6 测真链路、useDecks 5 测真 CRUD + 跨用户 403 ownership、useSwitchTemplateJob 4 测真状态机（fake RewriteFn DI 走完 pending→snapshotting→migrating→success）；5 个 UI spec 保留 msw 不动；测试 72 → 71（少 1 净）。**7D-D** E2E：`playwright.config.ts` agent webServer env 加 `BIG_PPT_TEST_REWRITE_MODE=skeleton`；helpers/db.ts 加 `getDeckByIdSql` / `getCurrentVersionContent` / `getTemplateLayoutNames` / `extractLayouts`；3 条新 spec：`template-switch-create.spec.ts`（picker UI + DB.templateId 落地 + content layout 全在 jingyeda 白名单）/ `template-switch-existing.spec.ts`（顶栏切换模板按钮 → picker → 选 jingyeda → 等切换完成 → UndoToast 出现 + DB 验证）/ `template-switch-undo.spec.ts`（点 UndoToast 的 /undo → VersionTimeline 高亮 → 点 .restore-btn → DB.templateId 回 beitou + 内容字符串字节级一致 + layout 全在 beitou 白名单）。测试数 294 agent + 71 creator + 3 shared = 368 unit + 9 e2e = 377 total。 | 用户主动确认"全清 P3-10"+ 选择 deckVersions.templateId 列 schema 修法（最干净 / 符合"version 是不可变快照"语义）；E2E 用 env 控制 skeleton mode 跳 LLM 是个低成本设计，让 webServer 启动时就配置好                                                                                                                                               |
| 2026-04-26 | **路线图三处调整**：(1) **Phase 9 加仓库卫生清理**交付物——一次性迁移脚本（`backfill-template-id.ts` / `rename-template-id.ts`）评估删除，保留的脚本要求"通用化"，已结案 plan 评估归档；(2) **导出/导入前插入两个新 Phase**——Phase 12 多 LLM Provider 兼容（Anthropic Claude + Google Gemini 原生接口）/ Phase 13 预制 MCP 服务扩展（catalog 5-8 个）；原 Phase 12（导出）→ **Phase 14**，原 Phase 13（导入）→ **Phase 15**，原 Phase 14+（远期）→ **Phase 16+**；所有跨 Phase 引用同步更新；(3) **vision.md 加远期愿景章节"模板生态系统"**——明确模板分两层架构：**第一层** 5 个模板独有 layout（cover / end / toc / section-title / content 骨架）；**第二层** 所有模板共享的内容页部件（两栏 / 田字格 / 九宫格 / 各类 chart / KV 列表等）下沉到 `@lumideck/template-components` 公共组件库，**只读 `--ld-*` token 自动配色**，模板切换时内容页完全无损。配套：创作者脚手架 + 模板市场 + tokens.css 完整 schema（颜色 / 字体 / 形状 / 阴影 4 类 token）。原 P14+ 的"团队共享模板 / 主题系统与自定义主题编辑器"两条合并为指向 vision.md 的引用。**顺手修**：vision.md / requirements.md 里 Phase 5.5 / 6 / 7 / 8 等过时编号校对到当前 10/11/14/15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 用户提出 P9 应该清理一次性迁移脚本（不通用就别留）；多 LLM provider 优先级高于导出（避免被 OpenAI 兼容代理丢能力）；用户进一步明确模板心智："内容页里的两栏 / 田字格 / 数据卡片不应该写死在模板里，所有模板都用得上，只读 token 配色就行；模板真正独有的就是封面 / 封底 / 目录 / 章节标题 / 内容页骨架这 5 个 layout"——这是分两层架构的核心抉择  |
| 2026-04-26 | **新增 Phase 7.5 模板分层重构（公共组件库 POC）**：在 Phase 8 之前插入。5 个子步：7.5A token 规范定稿（`--ld-*` schema）/ 7.5B 两套模板的 tokens.css 按规范增补 / 7.5C 抽公共组件到 `packages/slidev/components/common/`（布局 + 图表 + 媒体三类）+ 删除私有 chart 组件 / 7.5D 每套模板 layouts 收敛到 5 个标准（cover / end / toc / section-title / content）+ AI prompt 重写 / 7.5E starter 改公共组件 + 切模板字节级 E2E。**核心验收**：切换模板时内容页 `deck_versions.content` 字节级一致（仅 layout 名字 / 私有 token 引用变化，公共组件用法不变）。后续 Phase 编号不顺延，仍是 Phase 8/9/10...                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 用户明确"越早越好"——只有 2 套模板时重构成本最低（×N 边际成本未累积）；Phase 8/9 工程性工作正好基于新干净架构扫一遍；Phase 10 上线后重构成本暴涨。脚手架 / 市场 / npm 发布留 Phase 16+ 不做                                                                                                                                                       |
| 2026-04-26 | **文档分工五层定位明确 + 三大文档重构**：(1) **`CLAUDE.md` 新建**——工程指南（技术栈 / 命令 / 架构 / 约定 / 坑），每次对话自动加载；(2) **vision.md 重写**——只剩"产品形态 + 商业模式畅想"两维度，删所有技术细节（CSS / 类名 / SDK / 表名）；新增"商业模式畅想"章节（内部工具 → 行业 SaaS → 模板创作者市场三阶段路径）；模板分两层心智从技术描述改为产品价值描述；(3) **requirements.md 重写**——FR 表删除 Phase 编号承诺（避免编号 drift 同步），新增 FR-12/13/14/15（分享链接 / MCP catalog / 模板分层架构 / 模板生态远期）；(4) **roadmap.md 瘦身**——Phase 7.5/8/9/10/11/12/13/14/15 的交付物全部收敛到"做什么 / 验收什么"颗粒度，具体类名 / SDK / DB schema / 文件路径剥离到对应 plan。统一定位规则：vision = 产品/商业；requirements = 功能点；roadmap = 阶段排期；plans/NN = 技术实施；CLAUDE.md = 工程指南                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 用户提出文档定位模糊——之前的改动把技术细节误塞进 vision/roadmap，导致非技术读者 / 未来 Claude 都难以快速定位关键信息；统一文档分工后，每层只承担一个职责，长期维护成本下降                                                                                                                                                                       |
| 2026-04-26 | **Phase 7.5 plan 落地**（[plan 16](../plans/16-phase75-template-layering.md)）：子步从原 5 个细化为 7 个（C 拆为 C-1 栅格 8 个 / C-2 装饰 2 个种子 / C-3 内容块 6 个）；公共组件分**栅格 / 装饰 / 内容块** 三类（首版 16 个），装饰类（PetalFour / ProcessFlow）几何全公共、配色读 token 自适应（**否定"花瓣 SVG 是模板私有装饰"**）；切模板加 **deterministic 字符串替换路径**——`analyzeDeckPurity` 判 5 档自由度（档 1-3 pure / 档 4-5 not-pure），pure 跳 LLM 直接换 frontmatter `layout:` 前缀，not-pure fallback LLM 重写；AI prompt 加"工作模式 5 档自由度"段，明示档 4-5（chart.js 现写 / `<script setup>` 原创组件）的代价；**字节级一致 E2E 改为人工双 deck 比对**（不写自动化）；prompt 投放走全塞 system prompt（首版 ~2500 token），未来组件库 25+ 切分层 lazy load 已登记进 [99-tech-debt.md](../plans/99-tech-debt.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 用户多轮抉择把 layout / component 边界、装饰几何归属、AI 自由度边界、切模板字节级保证机制全部澄清；plan 比 roadmap 原版更精确（roadmap 仅定方向，plan 落实施细节）                                                                                                                                                                               |
| 2026-04-26 | **Phase 7.5 关闭**（按 [plan 16](../plans/16-phase75-template-layering.md) 7 子步执行）。7.5A `--ld-*` token 规范 22 项 + 校验脚本（agent +12）；7.5B 两套 tokens.css 增补；7.5C-1 栅格 8 个（slidev 包首次接 vitest，+18 测）；7.5C-2 装饰 PetalFour + ProcessFlow（+6 测）；7.5C-3 内容块 6 个 + chart `--ld-color-chart-primary-*` token rename（+14 测）；7.5D-1 layer-1 收敛 7→5 layouts（删 6 老 + 新增 2 section-title + 删 LBeitouMetricCard + manifest commonComponents 字段 + shared 校验）；7.5D-2 commonComponentsCatalog + buildSystemPrompt 加"## 可用 Components"（栅格/装饰/内容块三 sub-section）+ "## 工作模式（5 档自由度）" + "## 决策树"（agent A/B contract 21 测共 +6）；7.5D-3 `analyzeDeckPurity`（11 测）+ template-switch-job `tryDeterministicSwitch` 路径（5 测）—— pure deck 跳 LLM 仅替换 frontmatter `layout:` 前缀；7.5D-4 `migrate-deprecated-layouts` 一次性脚本 + 9 测；7.5E starter 改 5 页骨架（cover / toc / section-title / content + TwoCol + 4 MetricCard / back-cover）+ creator useSwitchTemplateJob fail path 测改用 not-pure deck 强制走 LLM。**测试数**：agent 332 → 361（+29）；slidev 0 → 38（+38 全新 vitest 工程）；creator 71 → 71（重写 1 测）；shared 3。**字节级一致**手验：用户在 dev 模式建 beitou deck → AI 生成含 `<MetricCard>` / `<TwoCol>` 的内容 → 切到 jingyeda → log 应有 deterministic 路径标记 + body 字面相同 + frontmatter 仅 `layout:` 前缀变（待手验）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | plan 16 设计抉择 13 条全部落地；命名抉择"栅格组件去 Layout 后缀"在实施期由用户提醒澄清                                                                                                                                                                                                                                                           |
| 2026-04-26 | **Phase 7.5 关闭后视觉打磨 + 文档回填**：用户跑双 deck demo 反馈多轮调整——(1) **图表色板 token 重设计**：退役 chart-primary-bg/border 双 token，新增 `--ld-color-chart-1..5` 五色色板 + chart-1-fill alpha 版（多分片饼图区分度由"主色色阶"升到"5 色异色错峰"），token spec 22 → 26（color 9 → 13），TOKENS.md / 两套 tokens.css / global.css class scope / Bar/Line/Pie 三组件读源全同步；(2) **PetalFour 三轮重构**：按用户参考图改为"2 行 × 4 列 grid"——左右内容区放胶囊标题 + items 列表（≤ 3 条）+ 中央 4 cell 对角 round 拼花瓣 + 上下行 align-self end/start 聚拢花心；(3) **内容块 6 改 5**：Callout 删除（与 Quote 重叠）/ KVList → Table（视觉更干净）/ 新增 PieChart（驱动了第 1 项色板设计）；(4) **components/ 目录分子目录**：grid / decoration / block / private 四类；(5) **Table 限行 ≤ 5**：slides 视口固定不加滚动，catalog 注明"超过 5 行请拆页或缩描述"；(6) **section-title 视觉拍板**：白底 + 大号章节编号（彩色）+ 标题文字。**文档回填**：plan 16 验收清单全勾（实际单测 484 远超 plan 估的 ≥ 425）/ 执行期偏离 8 条 / 踩坑与解决 8 条（其中 4 条提炼到 CLAUDE.md：`--ld-*` :root 级联 / markdown-it 多行字面量 / Slidev `--base` 对绝对路径无效 / CSS em 相对自身 font-size 撑爆）；CLAUDE.md 阶段进展升到 1–7.5 ✅ | 字节级一致 deterministic 路径已落，但 slides 视觉细节是 token + 几何 + 排版多轮迭代而非一次到位；token 26 项的最终数比 plan 22 项多出来的 4 个全是 7.5E 期色板设计驱动；CLAUDE.md 已知坑 4 条新规则覆盖了未来跨模板 / 跨组件库工作时最容易再撞的工具链层面问题             |
| 2026-04-26 | **Phase 8 关闭**（按 [plan 17](../plans/17-phase8-deps-upgrade.md) 8 task / 7 commit:c9eb875 / 2b1f9d9 / 22c1192 / d19eeee / 5b240fb / 2f1f00e / 待 Task 8-I）。盘点后实际工作量比 plan 估的小约一半，drizzle/hono SDK/slidev cli/eslint/typescript-eslint/vue-tsc 等已最新无需动；真升的 14 项：8 patch/minor + 6 major。**关键决策**：(1) 不跟 npm `latest` dist-tag 升 beta（@antdv-next/x latest 指向 1.0.2-beta.1，显式锁 1.0.1）；(2) `@types/node` 不跟 25 跟 24 LTS（与 Node 22 LTS 部署目标一致）。**踩坑 6 条**:eslint-plugin-vue 10.9 新增 vue/no-mutating-props 检查暴露 DeckEditorCanvas.vue 真实 prop mutation anti-pattern（顺手用 emit 重写）/ Vitest 4 vi.mock 对 dynamic import 第二次绕过（src/mcp-registry/session.ts 改 static import）/ Vitest 4 unhandled rejection 严格化（mock 加 close()）/ Vitest 4 v8 coverage AST remapping 让 statements/branches 数字按节点级算分母变大微跌（门槛微调到实测 -1pt buffer）/ Vitest 4 test.poolOptions 移除（迁 maxWorkers + fileParallelism）/ npm latest 指向 beta 反模式。**P3-1 verdict**:✅ 已修(1.0.1 把 content 完全做成 prop API)。**P3-7 verdict**:UnoCSS 66.6.8 主线最新 = slidev 内嵌版 = 仍未修，workaround 保留。**测试数**:维持 482（361+71+38+3+9）；coverage agent 92.82/83.83/92.45/89.83 均过新门槛。**audit 前哨**:0 高危 / 15 moderate（全 transitive，详查留 Phase 9）。**Node engines** 全 6 个 package.json 固化 `>=22.0.0`。CLAUDE.md 已知坑加 3 条提炼（vitest 4 dynamic import + coverage 算法差异 + npm latest beta 反模式） | plan 17 关键发现:多数依赖已最新，工作量缩水；vitest 4 跨 major 引入的工具链行为变化是真硬骨头（dynamic import 拦截 / poolOptions / coverage 算法），但都用源码或配置改动绕过，未触发 plan 的"失败立即退回"路径 |
| 2026-04-26 | **Phase 9 关闭**（按 [plan 18](../plans/18-phase9-security-audit.md) 8 task / 8 commit：bdae53b 9-A / 82387d2 9-B / a0d3e6f 9-C / c41c68d 9-F / 7ed2e95 9-F2 / e2e9684 9-D / 6c25776 9-E / 1336e35 9-G）。**意外发现 2 个**：(1) MCP server 全用户共享单文件 = OWASP A01 漏洞（Phase 5 设计遗漏，不在 plan 原 7 缺口里，9-F 整套 per-user DB 改造修复）；(2) 9-B 中 Hono `slides.use('*', mw)` 经 `app.route('/api', sub)` 挂载后泄漏到 /api/* 全路径，e2e happy-path 一开始挂在 list-templates 401（9-C 联动修 + 加 mount-integration 测防再犯 + CLAUDE.md 已知坑提炼）。**关键决策**：(1) **LLM 刻意不挂 rate limit**——API key 是用户自有自掏腰包，agent 不应在用户和自己 key 之间加一层（用户复核纠正）；(2) **CSP 仅 Report-Only**（Slidev iframe 含 inline + eval，强制易 break）；(3) **CORS 不加 middleware**（同源 + Vite proxy 浏览器视角同源不触发 preflight）；(4) **P3-15 coverage 拉回放弃**——长期维持新基线 lines 90 / branches 80 / functions 85 / statements 87，避免为凑数字写无意义测试。**踩坑 5 条**：Hono wildcard 泄漏（提炼 CLAUDE.md）/ originCheck 加全局后 e2e webServer 复用导致 rate-limit 跨 spec 累计撞限（webServer env 加 RATE_LIMIT_ENABLED=false）/ 集成测 `app.fetch` shim 不带 Origin 被拦 403（shim 自动补 localhost）/ mysql2 没 hoist 让 db:push 报错（.npmrc public-hoist）/ logger session 字段被 redact 误伤（从默认列表移除 session）。**测试数**:482 → 557（+75：agent +67 / creator +4 / e2e/slidev/shared 不变）；OWASP Top 10 10/10 ✅；产出 [docs/security/2026-04-audit-report.md](../security/2026-04-audit-report.md) + checklist + gitleaks/pnpm-audit/knip baseline；4 一次性脚本归档 docs/archive/scripts/。CLAUDE.md 阶段进展升到 1–9 ✅ | Phase 9 真正价值不在 plan 列的 7 缺口而在**审计期发现的 2 个意外漏洞**——MCP per-user 隔离（A01）+ Hono wildcard middleware 泄漏；后者证明"集成 mount 测试"不可缺（sub-router 单测撞不到的 bug） |
| 2026-04-27 | **Phase 10 关闭**（按 [plan 19](../plans/19-phase10-production-deploy.md) 11 commit:608297a 10-A healthz / 96c0da2 10-B deploy 脚手架 / 569ce68 10-D deploy.sh / eec6691 runbook+roadmap 入口 / 7400b35 RDS 路径 / 61f311a nginx 两阶段 bootstrap / 3efc857 跨过 6 踩坑 / fe2ef86 db-backup pipefail / a3b313e 验收回填 / 9b7af19 NODE_ENV=development / 6ba5d15 nginx gzip）。**部署成果**:`https://lumideck.illegalscreed.cn` 上线、HTTPS Let's Encrypt 自动续期、阿里云 RDS 复用 quiz 实例新建 lumideck 库、agent + slidev pm2 双进程、crontab 02:00 daily mysqldump 备份保留 30 天。**6 条实施期踩坑**(全部提炼 CLAUDE.md 已知坑):(1) macOS openrsync 协议 29 vs 远端 31 → brew rsync;(2) 远端 Alibaba Cloud Linux 用 dnf 不是 apt;(3) **nginx HTTPS 必须分两阶段 bootstrap**(含 ssl_certificate 路径但证书未申请时 nginx -t fail 直接拖死全 nginx,坏 conf 写入是潜在事故源);(4) **monorepo ts 包用 NodeNext ESM `from './x.js'` 写法生产部署前必须 build 出 .js**(packages/shared 加 build script);(5) **pm2 跑 ESM Node app 用 bash wrapper + dotenv-cli**,不要走 -r dotenv/config + DOTENV_CONFIG_PATH 不可靠;(6) **agent fetch slidev 用 localhost 不用 127.0.0.1**,slidev v52 + Vite 5 默认只 bind [::1] IPv6。**性能优化**:nginx gzip 让 SPA 大 chunk 2.35MB → 632KB,加载时间 5.32s → 1.15s(-78%)。**测试增量**:agent 428 → 434(+6:healthz 5 + mount-integration 1)。CLAUDE.md 阶段进展升到 1–10 ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 实施期 plan 19 设计假设(本地 MySQL / `-r dotenv/config` / shared 不打包 / 一阶段 nginx)全部需要修正,但每条都成为长期受益的工程改进而非 bandage |
| 2026-04-28 | **MCP 设置 bug 三连修 + Phase 13 范围扩**。修 [MCPCatalogItem.vue](../../packages/creator/src/components/MCPCatalogItem.vue) / [SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue) / [routes/mcp.ts](../../packages/agent/src/routes/mcp.ts) / [registry.ts](../../packages/agent/src/mcp-registry/registry.ts) / [presets.ts](../../packages/agent/src/mcp-server-repo/presets.ts) / [shared/api.ts](../../packages/shared/src/api.ts)。**Bug A**:复用 LLM Key 复选框永远不显示——根因 Phase 5 后端化 LLM apiKey 后,`/api/auth/llm-settings` 出于安全只回 `hasApiKey: boolean` 不回明文,但前端 `MCPCatalogItem.canReuse` 判 `!!props.llm.apiKey`(永远空)→ 复选框死。修法:加 `hasLlmKey` prop 由 `SettingsModal.hasStoredApiKey` 注入,买 LLM key 后端化的语义。**Bug B**:开关切换 native DOM 和 reactive state 不同步——alert 路径 return 后 server.enabled 没变但 native checkbox 已自己 toggled,`@change` controlled pattern 失败。修法:`@click.prevent="toggleEnabled(!server.enabled)"`,native DOM 完全跟 `:checked` 走。**Bug C(隐性)**:复用语义没持久化——前次设计是 PATCH 时把 sentinel `Bearer $LLM_KEY` 替换成真值落库,下次打开 Modal 看不出"已勾选复用",且用户改 LLM key 后 MCP 不同步。重设计:**sentinel 直接落库 + GET 计算 reuseLlmKey 字段返前端 + activate 时由 [registry.ts](../../packages/agent/src/mcp-registry/registry.ts) 解析 sentinel 替换为当前 LLM apiKey**(用户改 key 后下次重启自动同步)。`McpServerWithStatus` 加 `reuseLlmKey: boolean`。**Bug D**:用户启用 zhipu-vision 后 connect 报 JSON-RPC schema 错——核对 https://docs.bigmodel.cn/cn/coding-plan/mcp/vision-mcp-server 发现智谱视觉理解**只提供 npx (stdio)**,无 StreamableHTTP 端点;Phase 5 写代码时猜的 URL `/api/mcp/vision/mcp` 实际不存在。临时处置:`UNSUPPORTED_SERVER_IDS = {'zhipu-vision'}` 黑名单,GET 过滤、PATCH 拒绝、registry initialize 跳过;`PRESET_MCP_SERVERS` 从 4 减到 3(老用户 DB 残留行不动,前端看不见即可)。**Phase 13 范围扩**:加"stdio transport 支持"作为 Phase 13 交付物之一,解封时机为 Phase 13(catalog 扩展时一并做,顺序经济)。**测试增量**:agent +4(routes-mcp 24 测,新增 sentinel 落库 / sentinel 解析至 transport / 取消复用 / 没存 LLM key 拒绝;预置数从 4 改 3 的两条原断言更新);全 agent test 442/442 过。 | 用户报告"勾选 LLM 复用没有勾选地方 / 开关打开仍显示未启用 / 再次打开报错";追根发现复用 sentinel 协议 + 持久化 + UI controlled 三处都有设计漏洞,且 vision MCP URL 是猜的根本不存在;stdio 工程量大、当前用户也不急,挪到 Phase 13 catalog 扩展时一并做最经济。 |
| 2026-04-27 | **新增 Phase 10.5 候选**(Slidev 解耦 spike,未启动)。Phase 10 上线浏览器实测发现:Slidev iframe 内 Vite dev mode 加载几百个 .vue / .ts module(Slidev client + 两套模板 + 公共组件库),即使 gzip 后首屏仍 30-40 秒。**关键洞察**:Phase 11 的"多 Slidev 进程池 + 双路径"**不解决编辑路径首屏慢问题**,因为编辑路径仍依赖 dev mode HMR。真正的解药是把 Slidev iframe 换成 creator SPA 内的 `<DeckRenderer>` Vue 组件——markdown 解析 + layout 注册 + Phase 7.5 公共组件库直接渲染,跟 creator 一起 vite build,Rollup 打包秒开,reactive prop 替代 HMR。**顺序建议**:Phase 10.5 在 Phase 11 之前做(避免 P11 进程池实现做完又被废,沉没成本 50%);先 1-2 天 spike(写最小 DeckRenderer + grep 两套模板对 `$slidev` runtime API 的依赖)验证可行性后才正式立 plan 20;通过则 P10.5 5-8 天 + P11 缩水到 3-5 天。**roadmap 同步**:顶部引用列表加 Phase 10.5 候选条目;Phase 11 标题与依赖说明同步("多 Slidev 实例" → "多用户并发 + 分享链接 + 多实例部署切换",并加注 `依赖 Phase 10.5 spike 结果调整范围`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 用户 P10 上线后实测发现 dev mode 首屏不可避免地慢(几百个 round trip),提出"提取 Slidev 核心逻辑封装成 Vue 组件"的方向;Claude 评估后认同 — 编辑路径 dev mode 是 P11 双路径方案的盲点,自封装是真正的架构解药;但工作量大且有 markdown parser 边界 / Slidev runtime API 依赖等风险,故先 spike 不直接立 plan |
