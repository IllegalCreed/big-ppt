# Big-PPT 开发路线图

> 本路线图是"交付里程碑"的视角。每个 Phase 有**清晰的验收条件**和**不做什么**的边界，防止范围蔓延。配套文档：
>
> - Phase 1-2 实际交付：[docs/plans/01](../plans/01-project-init.md) / [02](../plans/02-ai-integration.md) / [03](../plans/03-chat-ui-fixes.md) / [05](../plans/05-phase2-closeout.md)
> - Phase 3 待办（含 MCP）：[docs/plans/04-mcp-integration.md](../plans/04-mcp-integration.md)
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

## Phase 3：架构重组 + MCP 集成 🔜

**目标**：把"事实上的后端"从 Vite middleware 迁出，建成可独立运行的 `packages/agent` 服务；同步接入通用 MCP 客户端。

**交付物**：

- pnpm workspace monorepo 搭建
  - `packages/slidev` — 幻灯片渲染（现有内容 + 根目录的 BarChart/LineChart 组件迁入）
  - `packages/creator` — 聊天 UI 前端（纯 UI，不做 IO）
  - `packages/agent` — Node.js 后端：Agent 主循环 + 工具执行 + LLM 代理 + 日志 + MCP client
- 前端与 agent 通过稳定的 HTTP API 通信，不再依赖 Vite dev proxy
- 通用 MCP 集成（[04-mcp-integration.md](../plans/04-mcp-integration.md)）：预置目录 + 自定义 server + 动态工具合并
- 基础测试基础设施：`tsconfig` + `vitest` + 关键 composable / middleware 单元测试

**验收条件**：

- [ ] 前端不再直接 fetch `/api/*` 走 Vite middleware，改为调 agent 服务（本地可一命令起整套）
- [ ] SettingsModal 里启用智谱 web-search MCP 后，对话中能触发 `mcp__*` 工具并返回实时结果
- [ ] `pnpm test` 可跑，核心逻辑（工具分流、日志索引、MCP schema 转换）有测试覆盖
- [ ] [99-tech-debt.md](../plans/99-tech-debt.md) 里 P1 级别技术债全部清除

**状态**：待开始

**依赖**：Phase 2 已关闭

**不做什么**：

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

| 日期       | 变更                                                         | 原因                                                                               |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 2026-04-20 | Phase 2 关闭，验收条件写入；MCP 计划（04）合并进 Phase 3     | Phase 2 范围已超出"原型验证"；MCP client 应跑在独立 agent 后端而非 Vite middleware |
| 2026-04-20 | Phase 3 新增"测试基础设施"、明确 BarChart/LineChart 组件迁移 | 重构前补网；根目录杂散组件应进 monorepo                                            |
| 2026-04-20 | Phase 4 新增"slides.md 架构升级"、工具拆分                   | write_slides 一次吐 16KB 5 分钟才完，架构撑不住编辑场景                            |
