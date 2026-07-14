# Lumideck · 幻光千叶

> 通过对话，一键生成专业演示文稿。AI 幻灯片创作工具。

Lumideck 是一个 AI 演示文稿生成平台：登录后新建 deck，与 ChatPanel 对话，AI 按企业模板生成和编辑幻灯片；`DeckRenderer` 统一承担编辑预览、放映、演讲者视图、导出和公开分享。内容仍兼容项目既有的 Slidev 风格 markdown。

## 项目结构

这是一个 pnpm workspace + Turborepo monorepo：

| 包                                     | 作用                                                                          | 端口 |
| -------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| [`packages/creator`](packages/creator) | Vue 3 前端：登录/注册、deck 列表、编辑器、ChatPanel + SlidePreview + Settings | 3030 |
| [`packages/agent`](packages/agent)     | Hono 后端：Auth、Deck/Share CRUD、LLM 代理、工具执行、MCP                     | 4000 |
| [`packages/slidev`](packages/slidev)   | 纯设计系统包：模板、layouts、图表组件和 prompt catalog                        | —    |
| [`packages/shared`](packages/shared)   | 前后端契约 TypeScript types                                                   | —    |
| [`packages/e2e`](packages/e2e)         | Playwright 端到端测试                                                         | —    |

## 快速开始

```bash
pnpm install

# 首次：建 lumideck_dev / lumideck_test（同一台 MySQL/RDS 不同库；prod 库叫 lumideck）
pnpm -F @big-ppt/agent init-db            # 建 lumideck_dev + 写 .env.development.local
pnpm -F @big-ppt/agent init-test-db       # 建 lumideck_test + 写 .env.test.local
pnpm -F @big-ppt/agent db:push            # 推 schema 到开发库
pnpm -F @big-ppt/agent db:push:test       # 推 schema 到测试库

pnpm dev             # 同时起 creator / agent
```

访问 <http://localhost:3030> → 注册 → 登录 → 设置中填 LLM API Key → 新建 deck 开始对话。

### 环境分层

三层 env，每层都有 `.env.{env}.example`（入库，占位符）和 `.env.{env}.local`（gitignored，真实值）：

| 层级        | local 文件                              | 触发命令               |
| ----------- | --------------------------------------- | ---------------------- |
| development | `packages/agent/.env.development.local` | `pnpm dev`             |
| test        | `packages/agent/.env.test.local`        | `pnpm test`            |
| production  | `packages/agent/.env.production.local`  | `pnpm start`（部署时） |

**切勿把 `.env.*.local` 提交到 git**（根 `.gitignore` 已全线屏蔽）。

## 测试与覆盖率

```bash
pnpm test                              # 全 workspace 单测与集成测试
pnpm -F @big-ppt/agent test:coverage   # 门槛 lines 90 / branches 85
pnpm -F @big-ppt/creator test:coverage # 门槛 lines 75 / branches 65
pnpm -F @big-ppt/e2e install-browsers  # 首次装 Chromium（~92 MB）
pnpm -F @big-ppt/e2e test              # Playwright（真浏览器 + 真后端 + 真 DB）
```

安全关键模块（`crypto/apikey` / `middleware/auth`）有独立 coverage 门槛。E2E 使用 `lumideck_test` 独立库并串行运行。

## 文档

- [愿景与需求](docs/requirements/)
- [阶段路线图](docs/requirements/roadmap.md)
- [实施计划 / 关闭报告](docs/plans/)
- [技术债](docs/plans/99-tech-debt.md)
- [Lumideck DESIGN.md（视觉系统）](packages/creator/DESIGN.md)

## 阶段进展

- ✅ Phase 1–13：AI 编辑、多模板、用户/版本/MCP、多 LLM 与素材管理
- ✅ Phase 14：PDF / PNG zip / PPTX 客户端导出
- ✅ Phase 15：`.lumideck` 归档导出与原子导入
- ✅ Phase 15.5：CI、lint、类型、bundle budget 与浏览器守门
- ✅ Phase 16：原生 PresentationViewer、演讲者模式、公开分享、画笔；Slidev runtime 退役
- ✅ Phase 17：配图风格资产库、跨 deck 复用与按需 AI 探索

> 产品边界：不提供 Markdown / PPTX 外部格式导入；跨账号、跨实例恢复使用 `.lumideck` 归档。
