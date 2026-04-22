# Lumideck · 幻光千叶

> 通过对话，一键生成专业演示文稿。AI 幻灯片创作工具。

Lumideck 是一个围绕 [Slidev](https://sli.dev/) 构建的 AI 演示文稿生成平台：你跟 ChatPanel 对话，AI 按你的企业模板生成/编辑幻灯片，右侧即时预览。

## 项目结构

这是一个 pnpm workspace + Turborepo monorepo：

| 包                                     | 作用                                            | 端口 |
| -------------------------------------- | ----------------------------------------------- | ---- |
| [`packages/creator`](packages/creator) | Vue 3 前端：ChatPanel + SlidePreview + Settings | 3030 |
| [`packages/agent`](packages/agent)     | Hono 后端：LLM 代理、工具执行、日志、MCP 集成   | 4000 |
| [`packages/slidev`](packages/slidev)   | Slidev 演示框架：模板、幻灯片、图表组件         | 3031 |
| [`packages/shared`](packages/shared)   | 前后端契约 TypeScript types                     | —    |

## 快速开始

```bash
pnpm install
pnpm dev             # 同时起 creator / agent / slidev
```

访问 <http://localhost:3030> 进入 creator；设置 → LLM 填 API Key 即可对话。

## 文档

- [愿景与需求](docs/requirements/)
- [阶段路线图](docs/requirements/roadmap.md)
- [实施计划 / 关闭报告](docs/plans/)
- [技术债](docs/plans/99-tech-debt.md)
- [Lumideck DESIGN.md（视觉系统）](packages/creator/DESIGN.md)

## 阶段进展

- ✅ Phase 1-3：项目基础 + AI 对话 + Monorepo 拆分
- ✅ Phase 3.5：MCP 集成与工具链后端化
- 🚧 Phase 3.6：前端美化（Lumideck 品牌 + design tokens）
- ⏳ Phase 4：编辑与迭代（逐页编辑、undo/redo、slides 架构升级）
