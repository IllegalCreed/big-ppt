# Phase 3 — Monorepo 拆分 + Agent 后端 + 工具链基建 实施文档

> **状态**：✅ 已关闭（2026-04-21，9 步迁移；详见 [06-phase3-closeout.md](06-phase3-closeout.md)）
> **前置阶段**：Phase 2（[05-phase2-closeout.md](05-phase2-closeout.md)）
> **后续阶段**：Phase 3.5 MCP 集成（[07-mcp-integration.md](07-mcp-integration.md)）
> **路线图**：[roadmap.md Phase 3](../requirements/roadmap.md)
> **执行子技能**：`superpowers:executing-plans` — inline 顺序执行
>
> 创建日期：2026-04-21 / 关闭目标：清掉 [99-tech-debt.md](99-tech-debt.md) P1 级技术债的骨架部分（P1-1/P1-2 骨架/P1-3/P1-4），为 Phase 4 编辑器能力、Phase 5 部署做好准备。

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- 本 Phase 不引入新环境变量；后续阶段（5+）才引入 `SESSION_SECRET` / `APIKEY_MASTER_KEY` / `DATABASE_URL`
- 每次 `git commit` 前 `git status` 人工检查，禁用 `git add -A`

---

## Context

Phase 2 关闭后（见 [05-phase2-closeout.md](05-phase2-closeout.md)），项目仍卡在三个阻塞问题：

1. **Vite middleware 事实上是后端**（`vite.config.creator.ts` 385 行承担 LLM 代理 / 工具执行 / 日志 / 备份）。绑死 Vite 生命周期，无法独立部署、测试、扩展 MCP。
2. **无测试基础设施**（无 `tsconfig.json`、无 `vitest.config.ts`，2100 行代码零测试），重构不敢动。
3. **无 lint / format**，风格漂移。

加上项目结构扁平（`creator/` + `components/` + `templates/` + `slides.md` + `vite.config.creator.ts` 都在根），Slidev 和 Creator 共用根 `package.json`、没有模块边界。继续加 MCP / 编辑器只会更糟。

**Phase 3 目标**：建成可独立运行的 monorepo，四个包（creator / slidev / agent / shared）各有脚手架、独立 `package.json`，Agent 后端独立跑，测试 / lint / format 全部就位。

**严格范围围栏**（[roadmap.md Phase 3](../requirements/roadmap.md)）：

- ✅ monorepo 拆分 + 四个包脚手架
- ✅ agent 后端独立进程
- ✅ vitest + eslint/prettier 基建落地
- ❌ **不做 MCP 集成本身**（延到 `07-mcp-integration.md`）
- ❌ **不做编辑器能力**（Phase 4）
- ❌ **不做部署**（Phase 5）
- ❌ **不升级 Vue / Slidev / antdv-next 大版本**

---

## 技术选型（已拍板）

| 项            | 选型                          | 脚手架                                     |
| ------------- | ----------------------------- | ------------------------------------------ |
| 前端          | Vue 3 + TS                    | `pnpm create vue@latest`                   |
| 幻灯片        | Slidev                        | `pnpm create slidev@latest`                |
| 后端          | Hono（SSE 原生）              | `pnpm create hono@latest`（nodejs target） |
| 测试          | Vitest                        | 随 Vue 脚手架                              |
| Lint + Format | ESLint flat config + Prettier | 随 Vue 脚手架                              |
| Monorepo      | pnpm workspace + Turborepo    | 手工配                                     |
| Shared        | 纯 types 包 `@big-ppt/shared` | 手工建                                     |

---

## 最终 Monorepo 结构

```
big-ppt/
├── package.json              # workspace root：仅跑 turbo / 全局脚本，无 runtime 依赖
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.js          # flat config
├── .prettierrc.json
├── .prettierignore
├── vitest.workspace.ts
├── docs/                     # 保留
├── logs/                     # 保留（不在 VCS）
└── packages/
    ├── slidev/               # 幻灯片渲染
    ├── creator/              # Vue3+TS 对话 UI 前端
    ├── agent/                # Node 后端（Hono）：LLM 代理 + 工具执行 + 日志
    └── shared/               # API 契约 types（纯 types，无 runtime）
```

## 分步迁移

**策略**：每步独立 commit，中间态可回滚。commit message 用中文。

### Step 0：同步文档 ✅

本文档本身 + [04-mcp-integration.md](04-mcp-integration.md) 加废弃标记。

### Step 1：Monorepo 骨架 + 根级工具链

根文件：

- `pnpm-workspace.yaml` 声明 `packages/*`
- 根 `package.json` 改成纯编排（无 runtime deps，devDeps：turbo / typescript / vitest / eslint / prettier / eslint-plugin-vue / @vue/eslint-config-typescript / eslint-config-prettier / globals）
- `turbo.json`：build / dev / test / lint / format / type-check 任务
- `tsconfig.base.json`：strict + ES2022 + ESNext + Bundler
- `eslint.config.js`：flat config，`eslint-plugin-vue` + `@vue/eslint-config-typescript` + `eslint-config-prettier` 末位
- `.prettierrc.json`：semi=false / singleQuote / printWidth=100 / trailingComma=all
- `.prettierignore`：dist / .output / logs / pnpm-lock.yaml / `packages/slidev/slides.md`（避免破坏 Slidev markdown）
- `vitest.workspace.ts`：`defineWorkspace(['packages/*'])`
- `mkdir packages/`

**验收**：`pnpm install` 通过；`pnpm exec turbo run lint` 空通过。

### Step 2：packages/shared

`@big-ppt/shared`，纯 types。从 `creator/src/composables/useAIChat.ts` 提炼：

- `src/chat.ts` — `ChatMessage` / `LLMSettings` / `ToolCall`
- `src/tools.ts` — `ToolDef` / `LLMTool`
- `src/api.ts` — 各 API Request/Response
- `src/index.ts` — re-export

### Step 3：packages/creator

**3.1**：`pnpm create vue@latest creator`（TS / Router 否 / Pinia 否 / Vitest 是 / ESLint 是 / Prettier 是）。删掉脚手架自带的 eslint / prettier 配置，合并进根。`@big-ppt/shared: workspace:*`。runtime deps：`@antdv-next/x` / `antdv-next`。

**3.2**：迁入 `creator/src/` 全部（App / components / composables / prompts / main）+ `index.html`。fetch 保持相对 `/api/*`，`vite.config.ts` 配 `server.proxy`：`/api` → `http://localhost:4000`。端口固定 :3030。

### Step 4：packages/slidev

先搬 slidev 是因为 agent 需要稳定的 `packages/slidev/slides.md` 路径。

**4.1**：`pnpm create slidev@latest slidev`，默认主题，端口 :3031。

**4.2**：迁入根 `slides.md` / `slides.md.bak` / `components/BarChart.vue` + `LineChart.vue` + `Counter.vue` / `templates/` / `snippets/` / `pages/` / `public/`。合并 `netlify.toml` / `vercel.json`（原版优先）。

### Step 5：packages/agent

**5.1**：`pnpm create hono@latest agent`（nodejs target），端口固定 :4000。

**5.2**：把 `vite.config.creator.ts` 的 middleware 拆到 `packages/agent/src/`：

- `routes/llm.ts` — SSE 代理（`hono/streaming` 的 `streamSSE` helper）
- `routes/slides.ts` — read/write/edit/restore
- `routes/templates.ts` — list/read
- `routes/log.ts` — log-event / log/latest + payload 分片
- `tools/registry.ts` — tool registry 骨架（不接 MCP）
- `slides-store/` — slides.md 备份封装
- `logger/` — session 聚合

路径解析：启动时向上找 `pnpm-workspace.yaml` 定位 monorepo root，拼 `packages/slidev/slides.md`。环境变量 `BIG_PPT_SLIDES_PATH` 可覆盖。

### Step 6：接通 + 清理

1. 顶层 `pnpm dev` = `turbo run dev --parallel`，三个服务同时起
2. 端到端手动走一遍对话 → 生成 → 预览
3. `git rm -r creator/ vite.config.creator.ts components/ templates/ snippets/ pages/ public/ slides.md slides.md.bak`
4. 根 `package.json` 移除旧 scripts

### Step 7：测试基建

最少覆盖：

- `packages/creator/test/slash-commands.test.ts`（5 个 slash command）
- `packages/agent/test/tool-registry.test.ts`
- `packages/agent/test/logger.test.ts`
- `packages/shared/test/api.test.ts`（契约编译守门）

### Step 8：lint + format 全量跑

1. `pnpm exec eslint . --max-warnings=0` 修 error
2. `pnpm exec prettier . --write` 全量格式化
3. 每包 `lint` 脚本：`eslint src/`
4. 根 scripts：`lint` / `format` / `format:check`

### Step 9：关 Phase 3

1. [roadmap.md](../requirements/roadmap.md) Phase 3 验收条件打勾 + 状态 "已完成"
2. [99-tech-debt.md](99-tech-debt.md) P1-1/P1-2（骨架）/P1-3/P1-4/P3-3 关闭
3. 新建本目录 `06-phase3-closeout.md`（对齐 05 格式）

---

## 端到端验证（Phase 3 关闭用）

```bash
pnpm install
pnpm dev                                    # creator :3030 / agent :4000 / slidev :3031
# 浏览器对话 "2026 Q1 技术团队 OKR 对齐会" → 生成 → 预览

pnpm exec turbo run build                   # 三包 exit 0
pnpm exec turbo run test                    # 全绿
pnpm run format:check
pnpm exec turbo run lint -- --max-warnings=0
```

---

## 风险与回退

| 风险                                | 缓解                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| ESLint flat config 与老插件不兼容   | 用 `@eslint/compat` 的 `fixupConfigRules` 过渡；优先原生支持 flat 的插件           |
| Hono `streamSSE` 与智谱流式响应对齐 | Hono 底层 Web Streams，fetch + TextDecoder 路径通；兜底 `streamText` 或裸 `stream` |
| Slidev 脚手架配置覆盖原部署         | Step 4.2 用 git diff 比较，以根目录原版为准                                        |
| 分步中间态不能 E2E                  | commit message 注明"依赖下一步才能 E2E"，保留上一 commit 作为回退锚点              |

---

## 不做什么（范围围栏）

见 Context 的范围围栏段。另：

- slides.md 架构升级（P1-5）延 Phase 4
- 工具拆分（create_slide / update_slide 等）延 Phase 4
- slides.md.history 环形缓冲（P2-2）延 Phase 4
- design tokens（P2-3）延 Phase 4
- localStorage 存 apiKey（P3-2）延 Phase 5

---

## 执行期偏离（关闭后追加）

- **MCP 集成 Step 拆出**：原计划 06 顺势带 MCP，实际拆为独立 [plan 07](07-mcp-integration.md) 再做，理由是先把 agent 后端独立出来再接 MCP 比寄生于 Vite middleware 干净
- **超额交付 `__resetPathsForTesting()` 钩子 + `BIG_PPT_SLIDES_PATH` / `BIG_PPT_LOGS_DIR` env 覆盖**：测试隔离 + 给 Phase 5 部署铺路顺手做
- **`/healthz` 健康检查路由**：原计划无，实际 E2E 验证用顺手加（Phase 10 部署期会复用）

---

## 踩坑与解决

> Phase 3 主要是迁移工作，工程性踩坑较少；下面这条是迁移期识别的关键基建依赖。

### 坑 1：UnoCSS presetIcons 自动 resolve 在 monorepo 解析失败

- **症状**：Slidev 启动时图标 CSS 不生成，UI 图标全部消失
- **根因**：UnoCSS 66.x 在 monorepo 下 `presetIcons({ collectionsNodeResolvePath })` 没法定位 `@iconify-json/*` 子包
- **修复**：commit `dbac7e6` — 离线预生成图标 CSS（`packages/slidev/scripts/gen-icons.mjs`）+ `.npmrc` 加 `public-hoist-pattern[]=@iconify-json/*` 兜底
- **防再犯**：tech-debt 记 P3-7，Phase 8 升级 UnoCSS 时复检；CLAUDE.md "已知坑" 已收录
- **已提炼到 CLAUDE.md**：是

---

## 测试数量落地

| 指标         | 起点 | 终点（关闭时） |
| ------------ | ---- | -------------- |
| agent unit   | 0    | 26             |
| creator unit | 0    | 5              |
| **合计**     | 0    | **31**         |

> 测试基建从零搭起，覆盖工具分流 / 日志索引 / 备份策略 / 类型契约。详细分布见 [06-phase3-closeout.md](06-phase3-closeout.md)。
