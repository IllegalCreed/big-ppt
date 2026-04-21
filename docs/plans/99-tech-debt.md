# 技术债清单

> 按**清除时机**分组，而不是按严重程度——"时机"才能让每条债对应到具体 Phase 的验收条件上。新增条目请保持此结构：**问题 / 位置 / 影响 / 修复方案 / 触发时机**。

## 总览

| 级别   | 含义                 | 条数 |
| ------ | -------------------- | ---- |
| **P1** | Phase 3 关闭前必须清 | 5    |
| **P2** | Phase 4 关闭前必须清 | 3    |
| **P3** | 非阻塞，有机会再清   | 5    |

---

## P1 — Phase 3 关闭前必须清

### P1-1. Vite middleware 事实上是后端

**位置**：[vite.config.creator.ts](../../vite.config.creator.ts)（385 行）  
**影响**：中间件承担 LLM 代理、工具执行、日志、备份、payload 分片。原本只是 dev-only 代理，现在是关键业务代码，但跟 Vite 生命周期绑死，没法独立部署/测试。  
**修复方案**：拆到 `packages/agent`，用独立 Node 服务（Express 或 Fastify），对外暴露 HTTP API。dev 时 Vite `server.proxy` 转发到 agent 即可。  
**触发时机**：Phase 3 第一优先级

### P1-2. 工具系统完全静态

**位置**：

- [creator/src/prompts/tools.ts](../../creator/src/prompts/tools.ts)（`as const` 字面量数组）
- [creator/src/composables/useAIChat.ts:94-129](../../creator/src/composables/useAIChat.ts)（`executeTool` 是 switch）

**影响**：加一个工具要改两处；接 MCP 时需要动态合并——计划（[04](04-mcp-integration.md)）已考虑但未实施。  
**修复方案**：在 agent 后端维护 tool registry，前端启动时向 agent 请求 `GET /api/tools`；MCP 工具同样注入 registry；`executeTool` 改为 dispatch 到 registry。  
**触发时机**：Phase 3 做 MCP 集成时顺便完成

### P1-3. 没有测试基础设施

**现状**：无 `tsconfig.json` / 无 `vitest.config.ts` / 无 `test/` 目录  
**影响**：2100 行代码零测试，Phase 3 重构不敢动。  
**修复方案**：

- 根 `tsconfig.json` + `packages/*/tsconfig.json`（monorepo）
- 添加 `vitest` + 至少覆盖：
  - logger 的 session / payload 字段路由
  - tool registry 分流
  - slash command handler（`/clear` / `/undo` / `/log` 应该能单元测试）
  - MCP schema → OpenAI tool 格式转换

**触发时机**：Phase 3 monorepo 搭好后、第一次重构代码前

### P1-4. BarChart / LineChart 组件位置错

**位置**：[components/BarChart.vue](../../components/BarChart.vue) / [LineChart.vue](../../components/LineChart.vue)（项目根）  
**影响**：既不在 `creator/src/` 也不在 `packages/`，Phase 3 拆 monorepo 时会无家可归。Slidev 依赖它们作为全局组件（通过 `setup/shiki-*` 或 `components/` 目录约定）。  
**修复方案**：迁到 `packages/slidev/components/`；保留 Slidev 自动导入行为。  
**触发时机**：Phase 3 monorepo 拆分时

### P1-5. `slides.md` 单文件架构 + CSS 重复

**位置**：[slides.md](../../slides.md)（生成出的 8 页 800 行，其中 >70% 是重复 CSS）  
**影响**：

- AI 每页重抄 CSS → 浪费 token / 延长生成时间（实测 Turn 3 花了 303s 生成 16KB）
- 模板改样式要改 N 页
- 大 deck 超出模型输出窗口  
  **修复方案**：
- 全局 CSS 抽到 `packages/slidev/global.css` 和 `style.css`
- 每种布局做成命名 component（`<CoverSlide>` / `<TocSlide>` / `<TwoCol>` / `<DataSlide>`），Slidev 的 layouts 就是这个机制
- AI 只生成"结构 + 内容"，不再抄 CSS

**触发时机**：Phase 3 完成、Phase 4 开始前必须做（Phase 4 的"逐页编辑"依赖此结构）

---

## P2 — Phase 4 关闭前必须清

### P2-1. `write_slides` / `edit_slides` 策略撑不住编辑场景

**位置**：[vite.config.creator.ts](../../vite.config.creator.ts) 的 slidesToolPlugin；prompt 里鼓励 write_slides 重写  
**影响**：Phase 4 用户要"改第 5 页"，AI 仍倾向 write_slides 整体覆盖 → 慢、易错、覆盖其他页。  
**修复方案**：工具拆分为 `create_slide(index, content)` / `update_slide(index, content)` / `delete_slide(index)` / `reorder_slides(order)`；prompt 强制"局部修改必须用 update_slide"。  
**触发时机**：Phase 4 第一迭代

### P2-2. `slides.md.bak` 只有 1 层深

**位置**：[vite.config.creator.ts](../../vite.config.creator.ts) `backupSlides()`  
**影响**：`/undo` 连续两次无效（第二次恢复回同一状态）。Phase 4 多轮编辑时会很痛。  
**修复方案**：`slides.md.history/<ts>-<op>.md` 环形缓冲（保留最近 N 个），`/undo` 步进回退；顺便加 `/redo`。  
**触发时机**：Phase 4 编辑能力上线前

### P2-3. 没有 design tokens

**位置**：`#d00d14` / `"Microsoft YaHei"` / 红色滤镜 filter 表达式，散布在 [templates/company-standard/](../../templates/company-standard/) 每个模板和 [slides.md](../../slides.md) 生成结果里  
**影响**：改色、改字体需要改 N 处；多模板套系时无法复用。  
**修复方案**：

- `templates/<theme>/tokens.css`（或 `tokens.json`）声明 `--brand-primary` / `--brand-font-family` / `--logo-filter-primary` 等
- 模板 CSS 用 var() 引用

**触发时机**：Phase 4 的 slides 架构升级（P1-5）顺带完成

---

## P3 — 非阻塞，有机会再清

### P3-1. Bubble.js 的 Slot warning 是库 bug

**位置**：`@antdv-next/x@0.3.0` 库内部 [Bubble.js:175-184](../../node_modules/.pnpm/@antdv-next+x@0.3.0_antdv-next@1.2.0_vue@3.5.32_typescript@5.9.3___vue@3.5.32_typescript@5.9.3_/node_modules/@antdv-next/x/dist/bubble/Bubble.js#L175-L184)  
**影响**：本地在 [ChatPanel.vue](../../creator/src/components/ChatPanel.vue) 用 VNode 作为 content 绕过，不影响功能。  
**修复方案**：跟踪 `@antdv-next/x` 升级到 0.4+，重新测试 `contentRender` 路径能否不走 slot。  
**触发时机**：看库维护节奏，不主动投入

### P3-2. localStorage 存 API Key

**位置**：[SettingsModal.vue](../../creator/src/components/SettingsModal.vue) `llm-settings`  
**影响**：原型阶段可接受；XSS 即泄漏。  
**修复方案**：Phase 3 后端化后改为 agent 服务存（加密 / 环境变量）；前端只存"已配置"标志位。  
**触发时机**：Phase 5 部署前必须改；Phase 3 可先埋接口

### P3-3. 没有 lint / format

**现状**：无 `.eslintrc` / 无 Prettier 配置  
**影响**：风格不统一，多人协作隐患；但单人开发不紧迫。  
**修复方案**：Phase 3 monorepo 搭好时引入 `eslint-config-antfu`（antfu 风格，轻量）。  
**触发时机**：Phase 3 monorepo 搭建同期

### P3-4. `content_guard.js` 扩展错误只靠文件名过滤

**位置**：[logger.ts:58-59](../../creator/src/composables/logger.ts) `if (/content_(script|guard)\.js/.test(file)) return`  
**影响**：名称规则易变，未来浏览器扩展用不同命名就过滤失败。  
**修复方案**：改成白名单——只记录 `filename` 在 `window.location.origin` 下的错误。  
**触发时机**：Phase 3 完整 error 治理时

### P3-5. 工具名前缀约定不统一

**现状**：本地工具（`read_slides`）、MCP 工具（`mcp__<server>__<tool>`）有不同前缀；未来 SDK 工具（如 `agent_*`）可能冲突。  
**影响**：将来扩展命名空间时会麻烦。  
**修复方案**：Phase 3 在 agent 后端定义 `ToolNamespace` 概念，前端不感知。  
**触发时机**：Phase 3 做 tool registry 时

---

## 变更记录

| 日期       | 变更                           | 操作人 |
| ---------- | ------------------------------ | ------ |
| 2026-04-20 | 初始版本，Phase 2 关闭同步产出 | 项目组 |
