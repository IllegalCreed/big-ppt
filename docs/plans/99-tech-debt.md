# 技术债清单

> 按**清除时机**分组，而不是按严重程度——"时机"才能让每条债对应到具体 Phase 的验收条件上。新增条目请保持此结构：**问题 / 位置 / 影响 / 修复方案 / 触发时机**。

## 总览

| 级别   | 含义                 | 条数                           |
| ------ | -------------------- | ------------------------------ |
| **P1** | Phase 3 关闭前必须清 | 5（已清 4，P1-5 延到 Phase 4） |
| **P2** | Phase 4 关闭前必须清 | 3                              |
| **P3** | 非阻塞，有机会再清   | 7                              |

---

## P1 — Phase 3 关闭前必须清

### P1-1. Vite middleware 事实上是后端 ✅（2026-04-21 清）

**原位置**：`vite.config.creator.ts`（385 行，已删）
**影响**：中间件承担 LLM 代理、工具执行、日志、备份、payload 分片。原本只是 dev-only 代理，现在是关键业务代码，但跟 Vite 生命周期绑死，没法独立部署/测试。
**实际修复**：拆到 [packages/agent/](../../packages/agent/)，Hono + @hono/node-server 独立进程（:4000），对外暴露 `/api/llm/chat/completions`（SSE 流透传）/ `/api/read-slides` / `/api/write-slides` / `/api/edit-slides` / `/api/restore-slides` / `/api/list-templates` / `/api/read-template` / `/api/log-event` / `/api/log/latest`。dev 时由 creator 的 [vite.config.ts](../../packages/creator/vite.config.ts) `server.proxy` 转发 `/api` → `http://localhost:4000`。
**触发时机**：Phase 3 第一优先级 — 已于 [06-phase3-closeout.md](06-phase3-closeout.md) 关闭

### P1-2. 工具系统完全静态 ✅（骨架部分，2026-04-21 清；MCP 合并留到 07-mcp-integration.md）

**原位置**：

- 前端 `creator/src/prompts/tools.ts`（`as const` 字面量数组，保留）
- 前端 `useAIChat.ts` 的 `executeTool`（保留，本地工具仍用 switch）

**影响**：加一个工具要改两处；接 MCP 时需要动态合并。
**实际修复（骨架）**：agent 后端建了 tool registry 骨架：[packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts)，暴露 `register / getTool / hasTool / listTools` + LLMTool 投影，含 duplicate 保护。MCP 集成时把本地工具先 register 进去 + 注入 MCP 工具，前端改读 `GET /api/tools` 的任务 **延到 07-mcp-integration.md**（MCP 整体实施时顺带完成）。
**触发时机**：骨架已完成；完全动态化留给 Phase 3.5 / MCP 集成

### P1-3. 没有测试基础设施 ✅（2026-04-21 清）

**实际修复**：

- 根 [tsconfig.base.json](../../tsconfig.base.json) + 各包独立 `tsconfig.json` extends 它
- vitest 落地，[vitest.workspace.ts](../../vitest.workspace.ts) 聚合 `packages/*`
- 覆盖：
  - [packages/agent/test/tool-registry.test.ts](../../packages/agent/test/tool-registry.test.ts)（注册 / 查找 / duplicate 保护 / LLMTool 投影）
  - [packages/agent/test/logger.test.ts](../../packages/agent/test/logger.test.ts)（payload 分片 / session id 清洗 / getLatestSession 三种 fallback）
  - [packages/agent/test/slides-store.test.ts](../../packages/agent/test/slides-store.test.ts)（read/write/backup/restore + editSlides 四种分支）
  - [packages/agent/test/similarity.test.ts](../../packages/agent/test/similarity.test.ts)
  - [packages/creator/test/shared-contract.test.ts](../../packages/creator/test/shared-contract.test.ts)（契约类型编译守门）
- 31 tests 全绿，`pnpm exec turbo run test` < 1s

**Slash command 单测**（原计划项）：未抽离到独立 composable（仍在 ChatPanel.vue 内联），延到 Phase 4 重构编辑能力时顺带 extract。

**MCP schema → OpenAI tool 格式转换**（原计划项）：延到 07-mcp-integration.md。

**触发时机**：已完成

### P1-4. BarChart / LineChart 组件位置错 ✅（2026-04-21 清）

**原位置**：项目根 `components/BarChart.vue` / `LineChart.vue` / `Counter.vue`（已删）
**实际修复**：迁入 [packages/slidev/components/](../../packages/slidev/components/)，Slidev 的 `components/` 目录约定自动导入生效。
**触发时机**：Phase 3 monorepo 拆分时 — 已完成

### P1-5. `slides.md` 单文件架构 + CSS 重复 ⏸（延到 Phase 4）

**位置**：[packages/slidev/slides.md](../../packages/slidev/slides.md)（8 页 800 行，其中 >70% 是重复 CSS）
**影响**：

- AI 每页重抄 CSS → 浪费 token / 延长生成时间（实测 Turn 3 花了 303s 生成 16KB）
- 模板改样式要改 N 页
- 大 deck 超出模型输出窗口

**修复方案**：

- 全局 CSS 抽到 `packages/slidev/global.css` 和 `style.css`
- 每种布局做成命名 component（`<CoverSlide>` / `<TocSlide>` / `<TwoCol>` / `<DataSlide>`），Slidev 的 layouts 就是这个机制
- AI 只生成"结构 + 内容"，不再抄 CSS

**触发时机**：Phase 4 开始前必须做（Phase 4 的"逐页编辑"依赖此结构）。Phase 3 scope 已围栏排除。

---

## P2 — Phase 4 关闭前必须清

### P2-1. `write_slides` / `edit_slides` 策略撑不住编辑场景

**位置**：[packages/agent/src/routes/slides.ts](../../packages/agent/src/routes/slides.ts) + [packages/agent/src/slides-store/](../../packages/agent/src/slides-store/)；prompt 里鼓励 write_slides 重写
**影响**：Phase 4 用户要"改第 5 页"，AI 仍倾向 write_slides 整体覆盖 → 慢、易错、覆盖其他页。
**修复方案**：工具拆分为 `create_slide(index, content)` / `update_slide(index, content)` / `delete_slide(index)` / `reorder_slides(order)`；prompt 强制"局部修改必须用 update_slide"。
**触发时机**：Phase 4 第一迭代

### P2-2. `slides.md.bak` 只有 1 层深

**位置**：[packages/agent/src/slides-store/index.ts](../../packages/agent/src/slides-store/index.ts) 的 `backupSlides()`
**影响**：`/undo` 连续两次无效（第二次恢复回同一状态）。Phase 4 多轮编辑时会很痛。
**修复方案**：`slides.md.history/<ts>-<op>.md` 环形缓冲（保留最近 N 个），`/undo` 步进回退；顺便加 `/redo`。
**触发时机**：Phase 4 编辑能力上线前

### P2-3. 没有 design tokens

**位置**：`#d00d14` / `"Microsoft YaHei"` / 红色滤镜 filter 表达式，散布在 [packages/slidev/templates/company-standard/](../../packages/slidev/templates/company-standard/) 每个模板和 [slides.md](../../packages/slidev/slides.md) 生成结果里
**影响**：改色、改字体需要改 N 处；多模板套系时无法复用。
**修复方案**：

- `templates/<theme>/tokens.css`（或 `tokens.json`）声明 `--brand-primary` / `--brand-font-family` / `--logo-filter-primary` 等
- 模板 CSS 用 var() 引用

**触发时机**：Phase 4 的 slides 架构升级（P1-5）顺带完成

---

## P3 — 非阻塞，有机会再清

### P3-1. Bubble.js 的 Slot warning 是库 bug

**位置**：`@antdv-next/x@0.3.0` 库内部
**影响**：本地在 [packages/creator/src/components/ChatPanel.vue](../../packages/creator/src/components/ChatPanel.vue) 用 VNode 作为 content 绕过，不影响功能。
**修复方案**：跟踪 `@antdv-next/x` 升级到 0.4+，重新测试 `contentRender` 路径能否不走 slot。
**触发时机**：看库维护节奏，不主动投入

### P3-2. localStorage 存 API Key

**位置**：[packages/creator/src/components/SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue) `llm-settings`
**影响**：原型阶段可接受；XSS 即泄漏。
**修复方案**：Phase 5 部署前必须改为 agent 服务存（加密 / 环境变量）；前端只存"已配置"标志位。agent 已独立进程，接口可直接加在 `/api/settings`。
**触发时机**：Phase 5 部署前必须改

### P3-3. 没有 lint / format ✅（2026-04-21 清）

**实际修复**：

- [packages/creator/eslint.config.ts](../../packages/creator/eslint.config.ts)：Vue 3.6-era 官方 `defineConfigWithVueTs` + `eslint-plugin-vue` + `eslint-config-prettier`
- [packages/agent/eslint.config.js](../../packages/agent/eslint.config.js)：`typescript-eslint` 通用 TS 规则
- 根 [.prettierrc.json](../../.prettierrc.json) + [.prettierignore](../../.prettierignore)：semi=false / singleQuote / printWidth=100 / trailingComma=all
- 全量 `pnpm run format` 一次 / `pnpm exec turbo run lint` 各包独立跑

**触发时机**：Phase 3 monorepo 搭建同期 — 已完成

### P3-4. `content_guard.js` 扩展错误只靠文件名过滤

**位置**：[packages/creator/src/composables/logger.ts](../../packages/creator/src/composables/logger.ts) `if (/content_(script|guard)\.js/.test(file)) return`
**影响**：名称规则易变，未来浏览器扩展用不同命名就过滤失败。
**修复方案**：改成白名单——只记录 `filename` 在 `window.location.origin` 下的错误。
**触发时机**：Phase 3 完整 error 治理时

### P3-5. 工具名前缀约定不统一

**现状**：本地工具（`read_slides`）、MCP 工具（`mcp__<server>__<tool>`）有不同前缀；未来 SDK 工具（如 `agent_*`）可能冲突。
**影响**：将来扩展命名空间时会麻烦。
**修复方案**：在 agent 后端定义 `ToolNamespace` 概念，前端不感知。tool registry 骨架已建（[packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts)），MCP 集成时正式落定 namespace 规范。
**触发时机**：07-mcp-integration.md 做 MCP 工具动态注入时

### P3-7. Slidev 工具栏图标走离线预生成（UnoCSS 上游 bug 的 workaround）

**位置**：

- [packages/slidev/scripts/gen-icons.mjs](../../packages/slidev/scripts/gen-icons.mjs)（离线扫 `@slidev/client` 里的 `i-carbon:*` / `i-ph:*` / `i-svg-spinners:*` class，用显式 async `collections` loader 的 UnoCSS 生成 CSS）
- [packages/slidev/style.css](../../packages/slidev/style.css)（`@import './styles/icons.css'`，Slidev 项目级全局样式入口）
- [packages/slidev/styles/icons.css](../../packages/slidev/styles/icons.css)（生成产物，33KB，含 59 个图标的 SVG data URL）
- [.npmrc](../../.npmrc) 的 `public-hoist-pattern[]=@iconify-json/*` 配合 iconify 包在根 `node_modules/` 顶层可见

**背景**：pnpm isolated monorepo 下，`@unocss/preset-icons` 66.x 的 `collectionsNodeResolvePath` 自动解析管线彻底失效 —— 即便在 Slidev 之外的裸 Node 脚本里复现仍然 `failed to load icon`。Slidev 的 `setupUnocss` 写死了依赖这条自动路径，其 UI 工具栏（NavControls / 幻灯片导航 / Overview / Presenter 等）所有 `i-carbon:*` 类全部渲染为空。

**诊断链**（关键测试点）：

| 测试 | 结果 | 结论 |
|------|------|------|
| `@iconify/utils` 的 `loadNodeIcon('carbon', 'minimize', { cwd })` 独立跑 | ✅ 返回 SVG | Iconify 底层健康 |
| `mlly.resolvePath('@iconify-json/carbon/icons.json', { url })` | ✅ 解析到文件 | 模块解析健康 |
| `presetIcons({ collections: { carbon: async loader } })` 显式注入 | ✅ 生成 CSS | UnoCSS 手动模式 OK |
| `presetIcons({ collectionsNodeResolvePath: [...] })` 自动模式 | ❌ `failed to load` | **UnoCSS 自动管线 regression** |
| `presetIcons({})` 零配置 | ❌ `failed to load` | 同上 |
| 用户 `setup/unocss.ts` 加第二个 `presetIcons` 显式 collections | ❌ loader 不被触发 | UnoCSS 多 preset 合并时（同名）被前者 "认领" |

**当前方案**：离线预生成 → Slidev 全局 style.css @import。优点：确定、零运行时开销、Slidev 升级不影响渲染只需 `pnpm run gen-icons` 重跑。缺点：33KB 死重；新图标需要手动重跑 script。

**上游修复路线**（Anthony Fu 同时维护 UnoCSS 和 Slidev，沟通成本低）：

1. **minimal repro**：独立 repo，仅 `package.json` + `test.mjs` 复现 `presetIcons({ collectionsNodeResolvePath })` 失败，带 UnoCSS 66.6.8 / Node 22 / pnpm 10 版本信息
2. **二分定位**：往回试 UnoCSS 65.x → 64.x，找到 regression commit
3. **issue 首选给 UnoCSS**：[unocss/unocss](https://github.com/unocss/unocss/issues) —— 这是真正的 bug 源头
4. **备用 PR 给 Slidev**：让 `setupUnocss()` 显式传 `collections: { carbon: async loader, ... }` 当 fallback —— 即便 UnoCSS 不修，Slidev 也更鲁棒
5. **沟通渠道**：GitHub issue / Discord slidev 频道 / Anthony Fu 个人 GitHub（他响应通常一周内）

**清除时机**：上游 UnoCSS 修 + 升级后删除 gen-icons 流程。删除范围：`scripts/gen-icons.mjs` / `style.css` / `styles/` 目录 / `.npmrc` 的 `public-hoist-pattern`（如果其他依赖也不需要） / slidev 的 `@iconify-json/*` dependencies（恢复成 transitive）。

---

### P3-6. creator 有 11 条 `any` 警告（Phase 2 遗留）

**位置**：

- `packages/creator/src/components/ChatPanel.vue` 5 处
- `packages/creator/src/composables/logger.ts` 3 处（Vue errorHandler/warnHandler 签名等）
- `packages/creator/src/composables/useAIChat.ts` 3 处（catch(err: any)、SSE delta 解析等）

**现状**：`pnpm exec turbo run lint` 报 0 errors / 11 warnings，全部 `@typescript-eslint/no-explicit-any`
**影响**：类型安全度有折扣；实际逻辑都对，LLM stream 解析、errorHandler 签名等处用 any 是实务惯例。
**修复方案**：渐进替换，按影响面大小；catch 签名可改 `unknown`，SSE delta 可加 interface。
**触发时机**：Phase 4 第一次修改到相关文件时顺带清理

---

## 变更记录

| 日期       | 变更                                                                | 操作人 |
| ---------- | ------------------------------------------------------------------- | ------ |
| 2026-04-20 | 初始版本，Phase 2 关闭同步产出                                      | 项目组 |
| 2026-04-21 | Phase 3 关闭：P1-1 / P1-2 骨架 / P1-3 / P1-4 / P3-3 清除；新增 P3-6 | 项目组 |
| 2026-04-21 | 新增 P3-7：Slidev 图标用离线预生成绕 UnoCSS 66.x 自动 resolve bug，记录上游 PR 路线 | 项目组 |
