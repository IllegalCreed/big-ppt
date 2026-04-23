# Lumideck · 幻光千叶

> 通过对话，一键生成专业演示文稿。AI 幻灯片创作工具。

Lumideck 是一个围绕 [Slidev](https://sli.dev/) 构建的 AI 演示文稿生成平台：登录后选择/新建 deck，跟 ChatPanel 对话，AI 按你的企业模板生成/编辑幻灯片，右侧即时预览；每次保存自动进版本历史，可随时回滚。

## 项目结构

这是一个 pnpm workspace + Turborepo monorepo：

| 包                                     | 作用                                                                         | 端口 |
| -------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| [`packages/creator`](packages/creator) | Vue 3 前端：登录/注册、deck 列表、编辑器、ChatPanel + SlidePreview + Settings | 3030 |
| [`packages/agent`](packages/agent)     | Hono 后端：Auth、Deck CRUD、LLM 代理、工具执行、MCP、Slidev 反代鉴权         | 4000 |
| [`packages/slidev`](packages/slidev)   | Slidev 演示框架：模板、幻灯片、图表组件（生产绑 127.0.0.1，由 agent 反代）   | 3031 |
| [`packages/shared`](packages/shared)   | 前后端契约 TypeScript types                                                  | —    |
| [`packages/e2e`](packages/e2e)         | Playwright 端到端测试（三场景：happy-path / lock-conflict / negative-auth）  | —    |

## 快速开始

```bash
pnpm install

# 首次：建开发库 + lumideck_test 库（共用同一 MySQL server）
pnpm -F @big-ppt/agent init-db            # 建 lumideck + 写 .env.development.local
pnpm -F @big-ppt/agent init-test-db       # 建 lumideck_test + 写 .env.test.local
pnpm -F @big-ppt/agent db:push            # 推 schema 到开发库
pnpm -F @big-ppt/agent db:push:test       # 推 schema 到测试库

pnpm dev             # 同时起 creator / agent / slidev
```

访问 <http://localhost:3030> → 注册 → 登录 → 设置中填 LLM API Key → 新建 deck 开始对话。

### 环境分层

三层 env，每层都有 `.env.{env}.example`（入库，占位符）和 `.env.{env}.local`（gitignored，真实值）：

| 层级        | local 文件                                    | 触发命令                |
| ----------- | --------------------------------------------- | ----------------------- |
| development | `packages/agent/.env.development.local`      | `pnpm dev`              |
| test        | `packages/agent/.env.test.local`             | `pnpm test`             |
| production  | `packages/agent/.env.production.local`       | `pnpm start`（部署时）   |

**切勿把 `.env.*.local` 提交到 git**（根 `.gitignore` 已全线屏蔽）。

## 测试与覆盖率

```bash
pnpm test                              # 两包全量：agent 208 + creator 49
pnpm -F @big-ppt/agent test:coverage   # 门槛 lines 90 / branches 85
pnpm -F @big-ppt/creator test:coverage # 门槛 lines 75 / branches 65
pnpm -F @big-ppt/e2e install-browsers  # 首次装 Chromium（~92 MB）
pnpm -F @big-ppt/e2e test              # Playwright 5 场景（真浏览器 + 真后端 + 真 DB）
```

安全关键模块（`crypto/apikey` / `slidev-lock` / `middleware/auth`）走 95/90 per-file 门槛。E2E 用 `lumideck_test` 独立库，每个 test case `beforeEach` TRUNCATE。

## 文档

- [愿景与需求](docs/requirements/)
- [阶段路线图](docs/requirements/roadmap.md)
- [实施计划 / 关闭报告](docs/plans/)
- [技术债](docs/plans/99-tech-debt.md)
- [Lumideck DESIGN.md（视觉系统）](packages/creator/DESIGN.md)

## 阶段进展

- ✅ Phase 1–3：项目基础 + AI 对话 + Monorepo 拆分
- ✅ Phase 3.5：MCP 集成与工具链后端化
- ✅ Phase 3.6：前端美化（Lumideck 品牌 + design tokens）
- ✅ Phase 4：编辑与迭代（四件套工具、undo/redo、slides.md 800→90 行）
- ✅ Phase 5：用户系统 + Deck + 版本历史 + 单实例占用锁（内存锁 + Slidev 反代鉴权）
- ✅ Phase 5 补测轨道：env 分层 + 单元/集成/E2E 测试 + coverage 门槛（262 tests）
- ⏳ Phase 5.5：首次部署（单实例上线 / 域名 + HTTPS / 备份）
- ⏳ Phase 6：多 Slidev 实例 + 多用户并发
- ⏳ Phase 7/8：导出 / 导入
