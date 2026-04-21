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

## Phase 4：编辑与迭代

**目标**：支持通过对话对已生成的幻灯片进行逐页精细调整。

**交付物**：

- 工具集扩展：`create_slide` / `update_slide` / `delete_slide` / `reorder_slides`（拆分现 `write_slides`/`edit_slides`）
- slides.md 架构升级：全局 CSS 抽到 `global.css` + layout 组件，AI 不再每页重抄 CSS
- 布局切换、样式调整、单页增删
- 预览侧支持单页定位 / 高亮

**验收条件**：

- [ ] 对 8 页幻灯片做"把第 3 页改成两栏"的指令，耗时 < 30 秒
- [ ] AI 不再一次性重写整个 slides.md（单次 tool_call 只改一页）
- [ ] slides.md 总行数下降 50% 以上（CSS 外移）

**依赖**：Phase 3 完成

---

## Phase 5：导出与部署

**目标**：完善导出功能，支持云端部署。

**交付物**：

- PDF 导出
- PPTX 导出
- 一键部署到阿里云服务器
- 本地演示模式优化

**依赖**：Phase 4 完成

---

## Phase 6：高级功能（远期）

**目标**：扩展高级能力。

**可能方向**：

- 多语言支持
- 团队共享模板
- 版本历史（替代简单的 `.bak` 机制）
- 协同编辑
- 自定义主题编辑器

---

## 路线图变更记录

| 日期       | 变更                                                                                     | 原因                                                                               |
| ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2026-04-20 | Phase 2 关闭，验收条件写入；MCP 计划（04）合并进 Phase 3                                 | Phase 2 范围已超出"原型验证"；MCP client 应跑在独立 agent 后端而非 Vite middleware |
| 2026-04-20 | Phase 3 新增"测试基础设施"、明确 BarChart/LineChart 组件迁移                             | 重构前补网；根目录杂散组件应进 monorepo                                            |
| 2026-04-20 | Phase 4 新增"slides.md 架构升级"、工具拆分                                               | write_slides 一次吐 16KB 5 分钟才完，架构撑不住编辑场景                            |
| 2026-04-21 | Phase 3 拆为两步：本轮只做 monorepo + agent + 工具链基建，MCP 延到 07-mcp-integration.md | 04-mcp 原计划寄生于 Vite middleware；先做后端独立再做 MCP，减少返工                |
| 2026-04-21 | Phase 3 关闭（9 步迁移，P1-1/P1-2 骨架/P1-3/P1-4 技术债清除）                            | 按 06-phase3-monorepo-agent.md 计划执行完成，验收条件全部满足                      |
