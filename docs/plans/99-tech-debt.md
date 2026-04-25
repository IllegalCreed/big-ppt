# 技术债清单

> 按**清除时机**分组，而不是按严重程度——"时机"才能让每条债对应到具体 Phase 的验收条件上。新增条目请保持此结构：**问题 / 位置 / 影响 / 修复方案 / 触发时机**。

## 总览

| 级别   | 含义                 | 条数                                               |
| ------ | -------------------- | -------------------------------------------------- |
| **P1** | Phase 3 关闭前必须清 | 5（全部清除：Phase 3 清 4 条，Phase 4 清 P1-5）                   |
| **P2** | Phase 4 关闭前必须清 | 4（**全部清除**：P2-1/P2-2/P2-3 Phase 4 清；**P2-4 2026-04-23 提前清**） |
| **P3** | 非阻塞，有机会再清   | 10（Phase 4 清 P3-6；**Phase 5 清 P3-2**；P3-NEW 字体/视觉回归；**P3-10 2026-04-25 7C 暴露**）    |

---

## P1 — Phase 3 关闭前必须清

### P1-1. Vite middleware 事实上是后端 ✅（2026-04-21 清）

**原位置**：`vite.config.creator.ts`（385 行，已删）
**影响**：中间件承担 LLM 代理、工具执行、日志、备份、payload 分片。原本只是 dev-only 代理，现在是关键业务代码，但跟 Vite 生命周期绑死，没法独立部署/测试。
**实际修复**：拆到 [packages/agent/](../../packages/agent/)，Hono + @hono/node-server 独立进程（:4000），对外暴露 `/api/llm/chat/completions`（SSE 流透传）/ `/api/read-slides` / `/api/write-slides` / `/api/edit-slides` / `/api/restore-slides` / `/api/list-templates` / `/api/read-template` / `/api/log-event` / `/api/log/latest`。dev 时由 creator 的 [vite.config.ts](../../packages/creator/vite.config.ts) `server.proxy` 转发 `/api` → `http://localhost:4000`。
**触发时机**：Phase 3 第一优先级 — 已于 [06-phase3-closeout.md](06-phase3-closeout.md) 关闭

### P1-2. 工具系统完全静态 ✅（骨架部分，2026-04-21 清；完全清零 2026-04-21）

**原位置**：

- 前端 `creator/src/prompts/tools.ts`（`as const` 字面量数组，保留）
- 前端 `useAIChat.ts` 的 `executeTool`（保留，本地工具仍用 switch）

**影响**：加一个工具要改两处；接 MCP 时需要动态合并。
**实际修复（骨架）**：agent 后端建了 tool registry 骨架：[packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts)，暴露 `register / getTool / hasTool / listTools` + LLMTool 投影，含 duplicate 保护。MCP 集成时把本地工具先 register 进去 + 注入 MCP 工具，前端改读 `GET /api/tools` 的任务 **延到 07-mcp-integration.md**（MCP 整体实施时顺带完成）。
**触发时机**：骨架已完成；完全动态化留给 Phase 3.5 / MCP 集成

**实际修复（完全）**：Phase 3.5 按 [07-mcp-integration.md](07-mcp-integration.md) 执行完成：

- 本地 5 工具 `registerLocalTools()` 注册进 `tool-registry`
- agent 新增 `GET /api/tools` / `POST /api/call-tool`，前端 `useAIChat` 动态拉工具列表，`executeTool` 收敛为一行 fetch
- MCP HTTP client 以 `mcp__<serverId>__<toolName>` 命名动态注入 registry；`McpServerRepo` 抽象（JsonFileRepo 实现）为 Phase 5 DB 留迁移口

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

### P1-5. `slides.md` 单文件架构 + CSS 重复 ✅（2026-04-22 清）

**原位置**：[packages/slidev/slides.md](../../packages/slidev/slides.md)（8 页 800 行，其中 >70% 是重复 CSS）
**实际修复**（Phase 4 Step 3/4/5 完成）：

- `templates/<theme>/tokens.css` 集中品牌变量（`--c-brand` / `--ff-brand` / `--logo-red-filter` / `--c-brand-gradient` 等）
- `packages/slidev/global.css` 做入口 `@import` tokens.css + `.slidev-layout` 基底
- 7 个 Slidev 原生 layouts：cover / toc / content / two-col / data / image-content / back-cover（放 `packages/slidev/layouts/*.vue`）
- 3 个 L* 内部复用组件：LCoverLogo / LTitleBlock / LMetricCard（只被 layouts import，AI prompt 不暴露）
- slides.md 从 **800 → 90 行（−88.75%）**，0 处 `<style>` 块、0 处 hex 硬编码

**触发时机**：已于 [09-phase4-edit-iterate.md](09-phase4-edit-iterate.md) Step 3-5 完成

---

## P2 — Phase 4 关闭前必须清

### P2-1. `write_slides` / `edit_slides` 策略撑不住编辑场景 ✅（2026-04-22 清）

**原位置**：[packages/agent/src/routes/slides.ts](../../packages/agent/src/routes/slides.ts) + [packages/agent/src/slides-store/](../../packages/agent/src/slides-store/)；prompt 里鼓励 write_slides 重写
**实际修复**（Phase 4 Step 6 + 8 完成）：

- slides-store 新增四件套：`createSlide({index, layout, frontmatter, body})` / `updateSlide({index, frontmatter?, body?, replaceFrontmatter?})` / `deleteSlide(index)` / `reorderSlides(order)`
- 工具 registry 从 5 → 9 条（四件套 + 原 5 条）
- `writeSlides` 加**store 层护栏**：已有 ≥1 页时返回 error 引导用四件套（不依赖 prompt 自律）
- prompt 重写教 AI 粒度判定：小改 edit_slides / 整页改 update_slide / 增删 create|delete_slide / 排序 reorder
- **Step 8.5 实测补丁**：工具层 `coerceIndex/coerceInt/coerceIntArray` 宽容 LLM（尤其 GLM）把 integer 传成字符串；prompt 加"换 layout 必 replaceFrontmatter=true"硬规则防脏数据
- 实测 4 个修改场景 AI **0 次** write_slides 调用

**触发时机**：已于 [09-phase4-edit-iterate.md](09-phase4-edit-iterate.md) Step 6-8.5 完成

### P2-2. `slides.md.bak` 只有 1 层深 ✅（2026-04-22 清）

**原位置**：[packages/agent/src/slides-store/index.ts](../../packages/agent/src/slides-store/index.ts) 的 `backupSlides()`（已删）
**实际修复**（Phase 4 Step 1 + 1.5 完成）：

- 新 [packages/agent/src/slides-store/history.ts](../../packages/agent/src/slides-store/history.ts)：线性版本栈 + 环形缓冲（默认 20 层，`BIG_PPT_HISTORY_MAX` env 可调）
- 物理存储：`packages/agent/data/slides-history/<hash>/<ts>-<op>.md`（hash = `sha1(slidesPath).slice(0, 8)`，为 Phase 5 deckId 预留）
- `pointer.json` 维护 `currentIndex` / `files[]` / `lastTurnId`，支持 /undo 步进 + /redo
- **轮次聚合（Step 1.5）**：用 `AsyncLocalStorage` 在 `/api/call-tool` 入口 `runInTurn(turnId, fn)` 包裹 tool.exec；同一 user message 内多次 appendHistory 合并为**一条** history 条目 —— /undo 一次回整轮不卡中间态
- /undo /redo API 返回 `{ message, position: { index, total } }`，UI 显示"已撤销到第 N / M 版"

**触发时机**：已于 [09-phase4-edit-iterate.md](09-phase4-edit-iterate.md) Step 1 + 1.5 完成

### P2-3. 没有 design tokens ✅（2026-04-22 清）

**原位置**：`#d00d14`（21 处）/ `"Microsoft YaHei"`（8 处）/ 红色 filter 表达式（8 处）散布在 [packages/slidev/templates/company-standard/](../../packages/slidev/templates/company-standard/) 和 [slides.md](../../packages/slidev/slides.md)
**实际修复**（Phase 4 Step 3 完成）：

- [packages/slidev/templates/company-standard/tokens.css](../../packages/slidev/templates/company-standard/tokens.css) 集中声明所有品牌 token：`--c-brand` / `--c-brand-mid` / `--c-brand-deep` / `--c-brand-gradient` / `--ff-brand` / `--logo-red-filter` / `--c-fg-*` / `--c-bg-*`
- [packages/slidev/global.css](../../packages/slidev/global.css) 做主入口 `@import` + `.slidev-layout` 基底
- [packages/slidev/style.css](../../packages/slidev/style.css) 在 icons.css 后追加 `@import './global.css'`
- 7 个模板 md 全量替换为 `var(--*)` 引用；slides.md 和所有 templates（除 DESIGN.md / README.md 文档引用）里 `#d00d14` 计数 0

**触发时机**：已于 [09-phase4-edit-iterate.md](09-phase4-edit-iterate.md) Step 3 完成

### P2-4. MCP 凭证明文存 `data/mcp.json` ✅（2026-04-23 清）

**实际修复**：
- `JsonFileRepo.persist/load` 里用 `crypto/apikey.ts` 的 AES-256-GCM helper 对
  headers 的 value 单独加解密：磁盘上 value 变 `v1:iv:ct:tag`，内存里保持明文
  交给 `mcp-registry` 连 HTTP 用。key 名（`Authorization` / `X-Api-Key`）保留
  便于运维 grep，但 **value 不会在任何 JSON dump 里出现**
- 向后兼容：读到非 `v1:` 开头的明文 value 原样接受（适配老 `data/mcp.json`），
  下次 persist 时自动迁移为密文
- 单条解密失败降级为空串 + warn，避免整个 MCP 列表无法加载
- **顺带修一个 Phase 5 遗留漏洞**：`/api/mcp/servers` 没挂 `requireAuth`，
  未登录也能拿到 headers。改为强制登录，且 GET 响应把 headers value 脱敏为
  `***`；PATCH 支持 `***` 语义 = 保留旧值（同 llm-settings 空 apiKey 模式）
- 前端 `MCPCatalogItem.vue`：input 空 + 已有旧 key 时 placeholder
  提示"已设置 · 留空保留原值"，不再渲染脱敏值到输入框；勾"复用 LLM Key"
  和用户重新填值两条路径发真值

**新增测试**（11 cases）：
- `mcp-server-repo.test.ts`：3 条（持久化加密 / 兼容旧明文 / 内存仍明文）
- `routes-mcp.test.ts`：7 条（未登录 401 × 2 / GET 脱敏 × 2 / PATCH *** 保留 /
  覆盖旧值 / 磁盘无明文 / 兼容老文件）

**触发时机**：已于 2026-04-23 提前于 Phase 5.5 清完

---

## P3 — 非阻塞，有机会再清

### P3-1. Bubble.js 的 Slot warning 是库 bug

**位置**：`@antdv-next/x@0.3.0` 库内部
**影响**：本地在 [packages/creator/src/components/ChatPanel.vue](../../packages/creator/src/components/ChatPanel.vue) 用 VNode 作为 content 绕过，不影响功能。
**修复方案**：跟踪 `@antdv-next/x` 升级到 0.4+，重新测试 `contentRender` 路径能否不走 slot。
**触发时机**：看库维护节奏，不主动投入

### P3-2. localStorage 存 API Key ✅（2026-04-23 清）

**实际修复**：Phase 5A 完成
- 新增 [packages/agent/src/crypto/apikey.ts](../../packages/agent/src/crypto/apikey.ts) AES-256-GCM 加解密，master key 从 `APIKEY_MASTER_KEY` 环境变量读
- `users.llm_settings` 列存密文（JSON: `{provider, apiKey, baseUrl, model}`）
- `/api/auth/llm-settings` PUT 接口加密写入；GET 只返 `{provider, model, baseUrl, hasApiKey}` 不泄漏 apiKey
- 前端 [SettingsModal.vue](../../packages/creator/src/components/SettingsModal.vue) 去掉 `localStorage` 读写 API Key 的分支
- LLM 代理 [routes/llm.ts](../../packages/agent/src/routes/llm.ts) 从 `ctx.user.llm_settings` 解密后取 key，不再信任客户端 Authorization header

**触发时机**：Phase 5A（2026-04-23 commit `df142f5`）

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

### P3-5. 工具名前缀约定不统一 ✅

**现状**：本地工具（`read_slides`）、MCP 工具（`mcp__<server>__<tool>`）有不同前缀；未来 SDK 工具（如 `agent_*`）可能冲突。
**影响**：将来扩展命名空间时会麻烦。
**修复方案**：在 agent 后端定义 `ToolNamespace` 概念，前端不感知。tool registry 骨架已建（[packages/agent/src/tools/registry.ts](../../packages/agent/src/tools/registry.ts)），MCP 集成时正式落定 namespace 规范。
**触发时机**：07-mcp-integration.md 做 MCP 工具动态注入时

**Phase 3.5 已落定 `mcp__<id>__<tool>` 规范**（见 [07-mcp-integration.md](07-mcp-integration.md)）。

### P3-7. Slidev 工具栏图标走离线预生成（UnoCSS 上游 bug 的 workaround）

**位置**：

- [packages/slidev/scripts/gen-icons.mjs](../../packages/slidev/scripts/gen-icons.mjs)（离线扫 `@slidev/client` 里的 `i-carbon:*` / `i-ph:*` / `i-svg-spinners:*` class，用显式 async `collections` loader 的 UnoCSS 生成 CSS）
- [packages/slidev/style.css](../../packages/slidev/style.css)（`@import './styles/icons.css'`，Slidev 项目级全局样式入口）
- [packages/slidev/styles/icons.css](../../packages/slidev/styles/icons.css)（生成产物，33KB，含 59 个图标的 SVG data URL）
- [.npmrc](../../.npmrc) 的 `public-hoist-pattern[]=@iconify-json/*` 配合 iconify 包在根 `node_modules/` 顶层可见

**背景**：pnpm isolated monorepo 下，`@unocss/preset-icons` 66.x 的 `collectionsNodeResolvePath` 自动解析管线彻底失效 —— 即便在 Slidev 之外的裸 Node 脚本里复现仍然 `failed to load icon`。Slidev 的 `setupUnocss` 写死了依赖这条自动路径，其 UI 工具栏（NavControls / 幻灯片导航 / Overview / Presenter 等）所有 `i-carbon:*` 类全部渲染为空。

**诊断链**（关键测试点）：

| 测试                                                                     | 结果                | 结论                                         |
| ------------------------------------------------------------------------ | ------------------- | -------------------------------------------- |
| `@iconify/utils` 的 `loadNodeIcon('carbon', 'minimize', { cwd })` 独立跑 | ✅ 返回 SVG         | Iconify 底层健康                             |
| `mlly.resolvePath('@iconify-json/carbon/icons.json', { url })`           | ✅ 解析到文件       | 模块解析健康                                 |
| `presetIcons({ collections: { carbon: async loader } })` 显式注入        | ✅ 生成 CSS         | UnoCSS 手动模式 OK                           |
| `presetIcons({ collectionsNodeResolvePath: [...] })` 自动模式            | ❌ `failed to load` | **UnoCSS 自动管线 regression**               |
| `presetIcons({})` 零配置                                                 | ❌ `failed to load` | 同上                                         |
| 用户 `setup/unocss.ts` 加第二个 `presetIcons` 显式 collections           | ❌ loader 不被触发  | UnoCSS 多 preset 合并时（同名）被前者 "认领" |

**当前方案**：离线预生成 → Slidev 全局 style.css @import。优点：确定、零运行时开销、Slidev 升级不影响渲染只需 `pnpm run gen-icons` 重跑。缺点：33KB 死重；新图标需要手动重跑 script。

**上游修复路线**（Anthony Fu 同时维护 UnoCSS 和 Slidev，沟通成本低）：

1. **minimal repro**：独立 repo，仅 `package.json` + `test.mjs` 复现 `presetIcons({ collectionsNodeResolvePath })` 失败，带 UnoCSS 66.6.8 / Node 22 / pnpm 10 版本信息
2. **二分定位**：往回试 UnoCSS 65.x → 64.x，找到 regression commit
3. **issue 首选给 UnoCSS**：[unocss/unocss](https://github.com/unocss/unocss/issues) —— 这是真正的 bug 源头
4. **备用 PR 给 Slidev**：让 `setupUnocss()` 显式传 `collections: { carbon: async loader, ... }` 当 fallback —— 即便 UnoCSS 不修，Slidev 也更鲁棒
5. **沟通渠道**：GitHub issue / Discord slidev 频道 / Anthony Fu 个人 GitHub（他响应通常一周内）

**清除时机**：上游 UnoCSS 修 + 升级后删除 gen-icons 流程。删除范围：`scripts/gen-icons.mjs` / `style.css` / `styles/` 目录 / `.npmrc` 的 `public-hoist-pattern`（如果其他依赖也不需要） / slidev 的 `@iconify-json/*` dependencies（恢复成 transitive）。

---

### P3-8. 字体未自托管（Phase 3.6 遗留）

**位置**：[packages/creator/src/styles/tokens.css](../../packages/creator/src/styles/tokens.css) 的 `--font-sans` / `--font-serif` / `--font-mono` 全部走 system font stack

**影响**：Inter / Source Serif 4 / Noto Serif SC 不是所有系统都预装。Windows 用户可能回退到 Microsoft YaHei + Georgia，观感与设计稿有轻度偏差；离线场景无 Google/Adobe Fonts CDN。Phase 3.6 单机 dev 环境可接受。

**修复方案**：Phase 5 部署前评估：

- `@fontsource/inter` + `@fontsource/source-serif-4` + `@fontsource/noto-serif-sc`（NPM 自托管）
- 或在 Nginx / CDN 托管 `.woff2`，`index.html` 显式 `<link rel="preload">`

**触发时机**：Phase 5 部署前

---

### P3-9. 前端视觉回归无自动化（Phase 3.6 遗留）

**位置**：全局 UI 层

**影响**：Phase 3.6 引入 design tokens 后，任何 token 改动可能波及 20+ 文件的显示；目前仅靠人眼对比截图。Phase 4 将大量增加组件，缺视觉回归工具会让 tokens 调整的代价升高。

**修复方案**：

- 引入 Playwright + `toHaveScreenshot()`（截图快照比对）
- 关键页面：主视图 / 设置 LLM tab / 设置 MCP tab（三种状态）/ 滑动 divider
- CI 在 PR 上跑，失败生成 diff 图

**触发时机**：Phase 4 前期，配合"逐页编辑"UI 密度提升一起做

---

### P3-10. creator 单测过度依赖 msw mock，应改为真实 agent + lumideck_test 集成测（Phase 7C 暴露）

**位置**：`packages/creator/test/*.spec.ts`（10 个 spec 全部）

**影响**：

- 7C-4 把 `<img src>` 写成 `/templates/...`（缺 `/api/` 前缀），unit 测全用 msw mock 任意 URL 给假数据，**整套 72 个测试全绿**。E2E 那条 picker spec 当时只断言 `expect(thumbs).toHaveCount(2)`（DOM 元素存在），src 错也照过。直到 dev/prod 浏览器打开看到 broken image 才暴露。
- 同样的盲点会让 API 路径 / 请求体 schema / 响应字段更名 / auth header 形式等所有"前后端契约层"的 bug 在 unit 测看不见。
- 项目本来就有 `lumideck_test`（远程 MySQL 阿里云 RDS），agent 测试已经全用真 DB（281 条）。creator 这边 fast-cycle 借口 msw 是 Phase 5 补测轨道遗留惯性。

**用户原话（2026-04-25）**：

> "我给了你一个专门的测试库，就是让你放心调用后端，什么叫端到端。除了需要调用 llm 或者 mcp 的部分，其他的你有什么可 mock 的"

**修复方案**：

- **保留** msw 的少量场景：纯 UI 行为（state machine / class binding / transition / event emit）
- **改用真实 agent + lumideck_test** 的场景：所有验证 API 契约的测（list / create / update / version restore / switch-template / lock / chats / list-templates / 静态资源加载 …）
- 为 creator 测建立 `_setup/integration.ts`：beforeAll 起一个 in-process Hono agent（不开网络端口，直接 fetch handler）+ 共享同一份测试 DB；afterEach `truncateAllTables()`
- 只 mock：LLM API（外部 cost）+ MCP HTTP transport（外部网络）
- E2E 也要从"DOM 元素存在"升级到"功能真正工作"：图片必须 `naturalWidth > 0`、按钮点击后必须真有响应、版本回滚后 deck 内容必须真的变

**触发时机**：Phase 7D（与 plan 15 的 3 条切换流 E2E 一并做），或独立提一个 testing-infra 重构 mini-phase

**短期已做**（2026-04-25 7C-补丁）：

- TemplateCard / TemplatePreviewPane URL 改 `/api/templates/...`
- agent 加 `GET /api/templates/:id/:filename`（白名单 png/jpg/svg/webp + 防 traversal），加 7 条真实集成测覆盖 200/404/400/traversal
- E2E template-picker spec 加 `naturalWidth > 0` + `request.get(src).status === 200` + content-type 断言
- 测试 281+72+3 = 356 → 288+72+3 = 363 unit + 6 e2e = 369 total

---

### P3-6. creator 有 11 条 `any` 警告（Phase 2 遗留） ✅（2026-04-22 清）

**原位置**：
- `packages/creator/src/components/ChatPanel.vue` 5 处（SlashCommand 类型 / bubbleItems `any[]` / onTrigger / catch）
- `packages/creator/src/composables/logger.ts` 3 处（Vue errorHandler/warnHandler 签名）
- `packages/creator/src/composables/useAIChat.ts` 3 处（catch 分支）

**实际修复**（Phase 4 Step 9 完成）：

- ChatPanel 抽出 [useSlashCommands composable](../../packages/creator/src/composables/useSlashCommands.ts)，斜杠指令代码从 120 行内联缩到 4 行调用；bubbleItems 改成 `BubbleItem[]` 接口
- logger.ts 用 `unknown` + `VueInstanceLike` 类型别名接住 errorHandler/warnHandler 的 instance，不再 any
- useAIChat.ts 4 个 catch 分支改 `catch (err)` + `const e = err as Error`
- shared-contract.test.ts 清 2 条 unused import

**结果**：`pnpm -F @big-ppt/creator lint` **0 errors / 0 warnings**（从 15 → 0）

**触发时机**：已于 [09-phase4-edit-iterate.md](09-phase4-edit-iterate.md) Step 9 完成

---

## 变更记录

| 日期       | 变更                                                                                                                                                                                                                        | 操作人 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-04-20 | 初始版本，Phase 2 关闭同步产出                                                                                                                                                                                              | 项目组 |
| 2026-04-21 | Phase 3 关闭：P1-1 / P1-2 骨架 / P1-3 / P1-4 / P3-3 清除；新增 P3-6                                                                                                                                                         | 项目组 |
| 2026-04-21 | 新增 P3-7：Slidev 图标用离线预生成绕 UnoCSS 66.x 自动 resolve bug，记录上游 PR 路线                                                                                                                                         | 项目组 |
| 2026-04-21 | Phase 3.5 关闭：P1-2 完全清零；P3-5 标 ✅；新增 P2-4（MCP 凭证加密）；P2 条数 3→4                                                                                                                                           | 项目组 |
| 2026-04-22 | Phase 3.6 完成：creator design tokens + DESIGN.md 落地，Lumideck · 幻光千叶 品牌上线；新增 P3-8（字体自托管）+ P3-9（视觉回归）；P3 条数 7→9；注：P2-3（slidev templates tokens）独立于 creator，仍保留待 Phase 4 P1-5 清除 | 项目组 |
| 2026-04-22 | Phase 4 完成：P1-5 / P2-1 / P2-2 / P2-3 / P3-6 清除；slides.md 800→90 行；四件套工具 + /undo /redo 轮次聚合 + 单页预览定位；工具层 integer 宽容 coerce；creator lint 0 errors / 0 warnings | 项目组 |
| 2026-04-23 | Phase 5 完成：P3-2 清除（localStorage API Key → 后端 AES-256-GCM 加密存 `users.llm_settings`）；P2-4 MCP 凭证加密**未**在 Phase 5 做，挪到 Phase 5.5 部署前必须清；Phase 5 补测轨道落地后总测试数 262（agent 208 + creator 49 + E2E 5）、coverage 门槛 agent 90/85 + creator 75/65 都过 | 项目组 |
| 2026-04-23 | **P2-4 提前清完**：JsonFileRepo 落盘时用 AES-256-GCM 加密 headers value（复用 `crypto/apikey.ts`），`/api/mcp/servers` 上 requireAuth + GET 脱敏 value 为 `***` + PATCH 支持 `***` 保留旧值语义；前端 `MCPCatalogItem.vue` 适配脱敏 UI；顺带修了 Phase 5 遗留的 "未登录可读 MCP headers" 漏洞；测试 +11 = 268；P2 条数 3/4 → 4/4 | 项目组 |
| 2026-04-25 | **新增 P3-10**：Phase 7C 暴露 creator 单测过度依赖 msw mock，整套 72 测全绿但 `<img src>` 缺 `/api/` 前缀的 prod bug 直到 dev 浏览器才发现。用户提醒"给了 lumideck_test 测试库就是让你放心调后端，除了 LLM/MCP 没什么可 mock 的"。短期 7C-补丁修了 URL 路径 + agent 加 `/api/templates/:id/:filename` 静态路由 + E2E 强化（naturalWidth > 0 / HTTP 200 断言）；中期改造 creator 测用真实 agent + lumideck_test 留 Phase 7D | 项目组 |
