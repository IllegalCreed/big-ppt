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
  - L* 内部组件（按需）
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

- [ ] `--ld-*` token 规范定稿（22 项 4 类），`validate-template-tokens` 两套模板都过
- [ ] 两套模板 layouts 从 7 收敛到 5（cover / back-cover / toc / section-title / content）
- [ ] 全仓无模板私有 chart / 布局 / 媒体组件残留
- [ ] AI 用三类公共组件生成内容页的 prompt contract test 通过（≥ 18 条断言）
- [ ] 公共组件单测覆盖完整（栅格 ≥ 16 / 装饰 ≥ 6 / 内容块 ≥ 12）
- [ ] **切模板手验：内容字节级一致性人工通过 + 装饰组件几何一致 / 配色随 token 切换**（核心断言）
- [ ] deterministic 切模板路径单测 ≥ 6（`analyzeDeckPurity` 三类污染信号识别 + pure → 字符串替换 / not-pure → LLM fallback）
- [ ] 现有所有 E2E 全绿（不能挂；11 / 11）

**状态**：待开始（实施详见 [plan 16](../plans/16-phase75-template-layering.md)）

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

- [ ] `pnpm outdated` 无 major 滞后（除非有明确拒绝理由，记入 tech-debt）
- [ ] `pnpm audit --audit-level=high` ≤ Phase 9 启动可接受水平（高危/严重 0 条；moderate 评估）
- [ ] 全量回归测试 100% 通过（262+ tests + 5 E2E）
- [ ] P3-7 / P3-1 给出 verdict（清除或保留）

**状态**：待开始

**依赖**：Phase 7 完成

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

- [ ] `pnpm audit --audit-level=high` = 0
- [ ] gitleaks 全历史扫 = 0 leaked secret
- [ ] OWASP Top 10 checklist 10/10 打勾 + 每项附证据
- [ ] 产出 `docs/security/2026-XX-audit-report.md` 留存
- [ ] 仓库内 `scripts/` 目录里所有脚本都能给出"保留 / 删除 / 通用化"的明确判定，无"过时但还在那"的状态

**状态**：待开始

**依赖**：Phase 8 完成

**不做什么**：

- ❌ 非 L3 范围合规认证（ISO27001 / SOC2）
- ❌ 外包 pen test（本次自审）
- ❌ SAST / DAST 工具链集成到 CI（留后续）

---

## Phase 10：首次部署（单实例上线，原 Phase 5.5 下沉）

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

- [ ] 公网域名可访问，HTTPS 证书正确
- [ ] 注册 → 登录 → 建 deck → 编辑 → 登出 → 重登全流程通
- [ ] 第二个浏览器登录另一个账号，进入相同 deck 看到等待页
- [ ] agent 崩溃/重启后，数据全在，用户重新登录能继续
- [ ] DB 备份文件每日一份，可恢复
- [ ] **无任何敏感文件出现在 git 历史**（.env.*.local / 密钥 / 密码）

**状态**：待开始

**依赖**：Phase 9 完成

**不做什么**：

- ❌ 多实例并发（Phase 11）
- ❌ CDN / 多地区部署
- ❌ 自动化 CI/CD 流水线（Phase 16+）

---

## Phase 11：多 Slidev 实例 + 多用户并发 + 多实例部署切换

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

**目标**：当前只预置了 4 个智谱 MCP。把社区与官方常用且对 PPT 创作有直接增益的 MCP 整理成 catalog，降低用户接入成本。每个预置卡片填好 endpoint、必要 headers、场景说明，让用户从"加 MCP"流程减到分钟级。

**交付物**（具体候选名单 / 接入细节见对应 plan）：

- **MCP catalog 调研**：从社区与官方目录中筛选 5-8 个对 PPT 创作链路最匹配的预置候选，落档候选名单 + 选型理由
- **catalog 卡片**：每个 MCP 在前端"MCP Servers"tab 里独立卡片，含 name / description / endpoint / required headers / 场景说明 / 接入步骤
- **catalog 分组**：按"内容素材 / 数据获取 / 文档协作 / AI 推理增强"等场景分组展示
- **兼容性测试**：每个新 MCP 的 transport 通畅 + 工具命名规范不破 + 至少 1 个工具能 list
- **安全审查**：每个新 MCP 的 token / OAuth 流程评估，敏感 header 走加密存储
- **接入文档**：每个预置 MCP 的步骤说明 + 已知坑（rate limit / 必要权限 / 网络可达性）

**验收条件**：

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
- `slides.md.history` 环形缓冲升级（P2-2 已随 Phase 5 的 deck_versions 天然解决，可复盘是否还需要文件级 undo）

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
| 2026-04-23 | Phase 5 技术栈 SQLite+argon2 → **MySQL+bcrypt**（drizzle push 模式）；Phase 5 范围追加**单实例占用锁**（`slidev_lock` + heartbeat + 等待页）；新增 **Phase 5.5** 首次单实例部署；Phase 6 改为"多实例 + 多用户并发 + 多实例部署切换"合并；原 Phase 7（导出+部署）拆为 **Phase 7 导出** 和 **Phase 8 导入**；原 Phase 8 远期重编号为 Phase 9+ | 用户希望 Phase 5 完成后就具备单实例上线条件；MySQL 便于后续多实例共享存储；bcrypt 与既有 quiz-backend 经验复用 |
| 2026-04-23 | Phase 5 关闭（Pre-5A + 5A + 5B + 5B-refactor + 5C + 5C-fix + 5C-UX + 5C-polish，共 8 条 commit）。实施期偏离：单实例锁从 `slidev_lock` 表改为 agent 进程内存对象；新增 Slidev 反代鉴权（`/api/slidev-preview/*` + 非锁持有者 403）防止预览泄露；deck 编辑页标题双击 inline 改名 | 内存锁天然原子 + 绕开循环外键/时区坑；Slidev `:3031` 原生对外暴露是 P5.5 上线前的硬漏洞；UX 细节 |
| 2026-04-23 | Phase 5 补测轨道关闭（docs + 8 条 commit = 9 条）。env 拆成 development/test/production 三层（dotenv-cli 驱动）；新增 `packages/e2e` workspace（Playwright + chromium）；agent 覆盖率 lines 94.63 / branches 86.15（90/85 门槛过），creator 80.82 / 72.22（75/65 门槛过）；测试数 148 → **262**（agent 208 + creator 49 + E2E 5） | 用户明确要求单测 + 集成测 + E2E 全覆盖；测试 DB 隔离需要 env 分层；覆盖率门槛变为 CI gate 基础 |
| 2026-04-23 | P2-4 提前清：`JsonFileRepo` 用 AES-256-GCM 加密 `data/mcp.json` 里的 headers value；`/api/mcp/servers` 补 `requireAuth`（修 Phase 5 遗留未登录读 token 漏洞）+ GET 脱敏 + PATCH 支持 `***` 保留旧值；前端 `MCPCatalogItem.vue` 适配。测试 262 → 268 | 用户要求 Phase 5.5 部署前清技术债；兼顾扫出的真实安全漏洞 |
| 2026-04-23 | **Post-Phase 5 路线图重规划**：部署前插入 Phase 6（模板架构）/ Phase 7（第二套模板+UI）/ Phase 8（依赖全量升级）/ Phase 9（安全 Audit L3）四个产出周期。原 Phase 5.5 部署下沉为 **Phase 10**；原 Phase 6（多实例）→ Phase 11；原 Phase 7（导出）→ Phase 12；原 Phase 8（导入）→ Phase 13；原 Phase 9+（远期）→ Phase 14+。Phase 5 与之后所有 Phase 的"不做什么"/"依赖"编号同步更新 | 用户要求部署前做完模板扩展（第二套模板 + 切换 UI）与全量安全 review（含依赖升级为前置）。Gate 严格串行：6→7→8→9→10 不可并行（除 6 尾段可起草 7 设计稿） |
| 2026-04-24 | Phase 6 实施计划落地：[plan 12](../plans/12-phase6-template-architecture.md) 拆 6A（manifest + starter 骨架）/ 6B（decks.template_id + createDeck 加载 starter）/ 6C（prompt 迁 agent + A/B contract test）/ 6D（switch-template 迁移流水）四步增量；manifest 新增 `starterSlidesPath`，新建 deck 即带 3 页骨架预览（封面「请填写标题」/ 内容页占位 / 封底），不再空白；`theme_id` 和 `template_id` 并存不合并；不加 feature flag | 用户确认部署前先建完整模板架构；seed 骨架痛点（新建 deck 右侧预览空白）纳入 6A/6B 一并解决；theme variant 语义留给未来 |
| 2026-04-24 | Phase 6 关闭（4 条 commit：6A/6B/6C/6D）。实施期偏离：无重大偏离；`switch_template` 工具加入 tool registry（tools 数 9→10），LLM 重写由 `RewriteFn` 可注入 DI 替换便于单测。测试 262+6(6A) → 268+6(6B) → 274+17(6C) → 291+24(6D) ＝ **281 条 agent 本底**（281 + creator 49 + E2E 5 = 335 总数）；coverage lines 94.44 / branches 85.75 维持 90/85 门槛 | 按 plan 12 拆四步完成，无需偏离；RewriteFn DI 让 LLM 不可用场景下也能完整测试状态机 |
| 2026-04-24 | **Phase 7 范围调整**：拆为 **7A / 7B / 7C / 7D** 四子步。7A = A 模板从临时 id `company-standard` 重命名为真实公司 id `beitou-standard`（北投集团），硬切无 alias + DB UPDATE 迁移 + schema DEFAULT 改名；7B = 第二家公司竞业达模板 `jingyeda-standard`；7C = 前端选择/切换 UI；7D = 3 条新 E2E spec。**命名约定确立**：`<公司 slug>-<用途>`（全拼音小写），预留同一公司多套场景扩展空间 | A 模板原 id `company-standard` 过于通用，第二套模板即将引入需要对称命名；硬切避免长期 legacy 债；Phase 7 开始前定死命名约定防止 B 模板命名时再返工 |
| 2026-04-24 | **Phase 7B 关闭**（视觉骨架，5 条 commit：333a024 / 0fb253a / b4be7fd / 58e23e5 / cef6944）。jingyeda-standard 完整模板视觉骨架（tokens.css 用 `--jyd-*` 命名空间 / 7 个 `jingyeda-*` layout vue 子目录化 / `LJydHeader` 共用顶部色条 / chart 组件改为 CSS 变量取色 / 仿宋 + 微软雅黑双字体栈 / em + fr + % 全比例化）。实施期偏离：用户临时调整执行顺序为 7B → 7A 而非串行 7A→7B（"先把视觉调好再做工程化"）；jingyeda manifest 暂无 thumbnail（参考图不应作缩略图，留 7C 实现 slidev 截图机制时统一补） | 用户给定竞业达 5 张 PPT 参考图后多轮迭代视觉（封面三段比例 / banner 2×2 grid / 字体颜色 / 信息栏 grid 居中 / header 三段色块 + 外阴影 / 封底 message+org 分层 + 等宽 等），每轮在前端预览验证 |
| 2026-04-25 | **Phase 7A 关闭**（5 条 commit：284b90a tokens 命名空间 / cfbad77 模板目录+字面量+DB schema+资源 URL / 23ab769 layouts/components 加 beitou 前缀+子目录+manifest layout name / 7e9e699 删 public/templates 冗余副本 / e6918e1 chart fallback 改中性灰 + beitou-data 显式注入）。`templates/company-standard` → `beitou-standard` 全套硬切重命名，零 alias；DB schema DEFAULT 同步 + 新增 scripts/rename-template-id.ts 一次性数据迁移脚本（dev/prod 各跑一次，幂等）。实测 slidev cli vite server.fs.allow 默认放开 user root，`public/templates/` 副本冗余可删。测试 281 + 49 + 5 = 335 全绿，全仓零 `company-standard` 字面量残留（仅 rename 脚本保留 FROM_ID 常量） | plan 13 拆 11 个 task，实际执行时把强耦合的 7A-2/5/6/7 合并为单一 commit cfbad77 避免中间红测试状态；plan 13 不变，作历史记录 |
| 2026-04-25 | **Phase 7C 关闭**（前端选择/切换 UI 全链路）。subagent-driven 模式跑 plan 14 共 8 个 task，14 条 commit：c3b440d tagline manifest 字段 / 444f76b 缩略图 playwright 自动截图脚本（含 a5612f7+89ba35c 修 JSDoc 里 *​/​ 字面提前关闭注释 bug + scripts/tsconfig.json + tsx 显式 dep）/ 8529f7c useSwitchTemplateJob 5+1 单测（含修 plan 原 migrating progress 钳到 0.51 不动的 bug）/ 5bb2431 TemplatePickerModal 共用组件 4 测 + Teleport + disableTeleport prop（VTU 2 不跨 Teleport 边界 query）/ 340c8f7 switch 模式打通 + DeckEditorCanvas 顶栏 Layers 按钮 + X 按钮 progress 守卫 / b103164 progress/success/error 三视图 + emit 类型修语义错误（newVersionName→newTemplateName）/ 2eb4303 UndoToast + VersionTimeline highlight pulse + DeckEditorCanvas 联动 + onUnmounted 清 timer / 9c62e5c E2E 冒烟（顺手修了 7C-4 引入的 /list-templates 缺 /api 前缀 prod bug + 加 _test/reset-lock 解 lock-conflict 后续测试 409 + happy-path 适配 picker modal 流程）。测试 335 → 281+72+3 = 356 unit + 6 e2e = 362（实超预期 +8）。完整 3 条切换流 E2E 留 Phase 7D / plan 15 | subagent-driven-development 流程：每 task 派 implementer → spec reviewer → code reviewer 三段；多次踩到 plan 自身 bug（JSDoc closure / migrating 公式 / emit 字段语义）后用 fix commit 同步修 plan + 加 prevent-regression 测试，"plan 是活文档，发现错就改"；过程中暴露 7C-4 的 API 路径 prod bug + lock 跨测污染基础设施缺陷，归在 7C-8 一并修 |
| 2026-04-25 | **Phase 7D 关闭**（plan 15，4 task / 4 commit + plan doc）。**7D-A** schema bug 修：`deckVersions` 加 nullable `template_id` 列（drizzle push dev + lumideck_test）+ `template-switch-job` snapshot 写 fromTemplateId/新 version 写 toTemplateId + `routes/decks` restore 端点 fallback 同步 `decks.template_id`（旧数据 NULL 不动向前兼容）；测试 +4 涵盖 3 种 restore case + db-schema 列存在；这是 7D-3 双向可逆的硬前置。**7D-B** `rewriteForTemplate` 加 `BIG_PPT_TEST_REWRITE_MODE=skeleton` 分支：env 命中时直接 `readStarter(toTemplateId)` 跳 LLM；测试 +2。**7D-C** P3-10 全清：`packages/agent/src/app.ts` 抽出 Hono app 单例（不带启动副作用，仅装配）+ creator `package.json` 加 workspace dep + 新建 `test/_setup/integration.ts`（loadDotenv .env.test.local + 替换 globalThis.fetch 为 app.fetch shim + cookie jar + 透传 useTestDb/factories）+ `vitest.config.ts` 加 `fileParallelism: false`（共享 lumideck_test 必须串行）；3 个契约 spec 改造：useAuth 6 测真链路、useDecks 5 测真 CRUD + 跨用户 403 ownership、useSwitchTemplateJob 4 测真状态机（fake RewriteFn DI 走完 pending→snapshotting→migrating→success）；5 个 UI spec 保留 msw 不动；测试 72 → 71（少 1 净）。**7D-D** E2E：`playwright.config.ts` agent webServer env 加 `BIG_PPT_TEST_REWRITE_MODE=skeleton`；helpers/db.ts 加 `getDeckByIdSql` / `getCurrentVersionContent` / `getTemplateLayoutNames` / `extractLayouts`；3 条新 spec：`template-switch-create.spec.ts`（picker UI + DB.templateId 落地 + content layout 全在 jingyeda 白名单）/ `template-switch-existing.spec.ts`（顶栏切换模板按钮 → picker → 选 jingyeda → 等切换完成 → UndoToast 出现 + DB 验证）/ `template-switch-undo.spec.ts`（点 UndoToast 的 /undo → VersionTimeline 高亮 → 点 .restore-btn → DB.templateId 回 beitou + 内容字符串字节级一致 + layout 全在 beitou 白名单）。测试数 294 agent + 71 creator + 3 shared = 368 unit + 9 e2e = 377 total。 | 用户主动确认"全清 P3-10"+ 选择 deckVersions.templateId 列 schema 修法（最干净 / 符合"version 是不可变快照"语义）；E2E 用 env 控制 skeleton mode 跳 LLM 是个低成本设计，让 webServer 启动时就配置好 |
| 2026-04-26 | **路线图三处调整**：(1) **Phase 9 加仓库卫生清理**交付物——一次性迁移脚本（`backfill-template-id.ts` / `rename-template-id.ts`）评估删除，保留的脚本要求"通用化"，已结案 plan 评估归档；(2) **导出/导入前插入两个新 Phase**——Phase 12 多 LLM Provider 兼容（Anthropic Claude + Google Gemini 原生接口）/ Phase 13 预制 MCP 服务扩展（catalog 5-8 个）；原 Phase 12（导出）→ **Phase 14**，原 Phase 13（导入）→ **Phase 15**，原 Phase 14+（远期）→ **Phase 16+**；所有跨 Phase 引用同步更新；(3) **vision.md 加远期愿景章节"模板生态系统"**——明确模板分两层架构：**第一层** 5 个模板独有 layout（cover / end / toc / section-title / content 骨架）；**第二层** 所有模板共享的内容页部件（两栏 / 田字格 / 九宫格 / 各类 chart / KV 列表等）下沉到 `@lumideck/template-components` 公共组件库，**只读 `--ld-*` token 自动配色**，模板切换时内容页完全无损。配套：创作者脚手架 + 模板市场 + tokens.css 完整 schema（颜色 / 字体 / 形状 / 阴影 4 类 token）。原 P14+ 的"团队共享模板 / 主题系统与自定义主题编辑器"两条合并为指向 vision.md 的引用。**顺手修**：vision.md / requirements.md 里 Phase 5.5 / 6 / 7 / 8 等过时编号校对到当前 10/11/14/15 | 用户提出 P9 应该清理一次性迁移脚本（不通用就别留）；多 LLM provider 优先级高于导出（避免被 OpenAI 兼容代理丢能力）；用户进一步明确模板心智："内容页里的两栏 / 田字格 / 数据卡片不应该写死在模板里，所有模板都用得上，只读 token 配色就行；模板真正独有的就是封面 / 封底 / 目录 / 章节标题 / 内容页骨架这 5 个 layout"——这是分两层架构的核心抉择 |
| 2026-04-26 | **新增 Phase 7.5 模板分层重构（公共组件库 POC）**：在 Phase 8 之前插入。5 个子步：7.5A token 规范定稿（`--ld-*` schema）/ 7.5B 两套模板的 tokens.css 按规范增补 / 7.5C 抽公共组件到 `packages/slidev/components/common/`（布局 + 图表 + 媒体三类）+ 删除私有 chart 组件 / 7.5D 每套模板 layouts 收敛到 5 个标准（cover / end / toc / section-title / content）+ AI prompt 重写 / 7.5E starter 改公共组件 + 切模板字节级 E2E。**核心验收**：切换模板时内容页 `deck_versions.content` 字节级一致（仅 layout 名字 / 私有 token 引用变化，公共组件用法不变）。后续 Phase 编号不顺延，仍是 Phase 8/9/10... | 用户明确"越早越好"——只有 2 套模板时重构成本最低（×N 边际成本未累积）；Phase 8/9 工程性工作正好基于新干净架构扫一遍；Phase 10 上线后重构成本暴涨。脚手架 / 市场 / npm 发布留 Phase 16+ 不做 |
| 2026-04-26 | **文档分工五层定位明确 + 三大文档重构**：(1) **`CLAUDE.md` 新建**——工程指南（技术栈 / 命令 / 架构 / 约定 / 坑），每次对话自动加载；(2) **vision.md 重写**——只剩"产品形态 + 商业模式畅想"两维度，删所有技术细节（CSS / 类名 / SDK / 表名）；新增"商业模式畅想"章节（内部工具 → 行业 SaaS → 模板创作者市场三阶段路径）；模板分两层心智从技术描述改为产品价值描述；(3) **requirements.md 重写**——FR 表删除 Phase 编号承诺（避免编号 drift 同步），新增 FR-12/13/14/15（分享链接 / MCP catalog / 模板分层架构 / 模板生态远期）；(4) **roadmap.md 瘦身**——Phase 7.5/8/9/10/11/12/13/14/15 的交付物全部收敛到"做什么 / 验收什么"颗粒度，具体类名 / SDK / DB schema / 文件路径剥离到对应 plan。统一定位规则：vision = 产品/商业；requirements = 功能点；roadmap = 阶段排期；plans/NN = 技术实施；CLAUDE.md = 工程指南 | 用户提出文档定位模糊——之前的改动把技术细节误塞进 vision/roadmap，导致非技术读者 / 未来 Claude 都难以快速定位关键信息；统一文档分工后，每层只承担一个职责，长期维护成本下降 |
| 2026-04-26 | **Phase 7.5 plan 落地**（[plan 16](../plans/16-phase75-template-layering.md)）：子步从原 5 个细化为 7 个（C 拆为 C-1 栅格 8 个 / C-2 装饰 2 个种子 / C-3 内容块 6 个）；公共组件分**栅格 / 装饰 / 内容块** 三类（首版 16 个），装饰类（PetalFour / ProcessFlow）几何全公共、配色读 token 自适应（**否定"花瓣 SVG 是模板私有装饰"**）；切模板加 **deterministic 字符串替换路径**——`analyzeDeckPurity` 判 5 档自由度（档 1-3 pure / 档 4-5 not-pure），pure 跳 LLM 直接换 frontmatter `layout:` 前缀，not-pure fallback LLM 重写；AI prompt 加"工作模式 5 档自由度"段，明示档 4-5（chart.js 现写 / `<script setup>` 原创组件）的代价；**字节级一致 E2E 改为人工双 deck 比对**（不写自动化）；prompt 投放走全塞 system prompt（首版 ~2500 token），未来组件库 25+ 切分层 lazy load 已登记进 [99-tech-debt.md](../plans/99-tech-debt.md) | 用户多轮抉择把 layout / component 边界、装饰几何归属、AI 自由度边界、切模板字节级保证机制全部澄清；plan 比 roadmap 原版更精确（roadmap 仅定方向，plan 落实施细节） |
