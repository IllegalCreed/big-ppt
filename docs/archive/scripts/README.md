# 归档脚本

> 这些脚本是历史 Phase 实施期的**一次性迁移工具**——已经在 dev / prod 环境跑完，
> 任务完成。Phase 9-G 仓库卫生评估时统一归档到此目录，从 `packages/agent/scripts/`
> 移走，**减少新成员困惑 + 缩减运行时攻击面**（生产 image build 不再需要 ship 这些）。
>
> 保留代码的目的：**考古参考** —— 未来类似场景（schema 重命名 / layout 迁移）时
> 复制改造比从零写快；以及验证历史决策的可追溯性。

## 脚本清单

| 脚本 | Phase | 用途 | 何时跑过 | 状态 |
| ---- | ----- | ---- | -------- | ---- |
| `backfill-template-id.ts` | 6B | 把现有 `decks.template_id` 全量回填默认值 `beitou-standard`（Phase 6B 加列后老数据 NULL） | dev + prod 各跑一次（2026-04-24 前后） | ✅ 完成，幂等可重跑无副作用 |
| `migrate-deprecated-layouts.ts` | 7.5D-4 | 把旧 layout 名（`*-data` / `*-two-col` / `*-image-content`）替换为新 5-layout 标准（`*-content` 等）+ 落新 version | dev + prod 各跑一次（2026-04-26 前后） | ✅ 完成，幂等 |
| `rename-template-id.ts` | 7A | `decks.template_id='company-standard'` 全量改 `'beitou-standard'`（Phase 7A 模板重命名） | dev + prod 各跑一次（2026-04-25 前后） | ✅ 完成，幂等 |
| `seed-demo-decks.ts` | dev only | 给 dev 环境塞演示 deck 数据，方便手验视觉 | 偶发，按需跑 | 归档原因：纯 dev 工具，无生产用途；新成员可读源码改造 |

## 重新启用脚本

如果某天确实需要再跑某个脚本（如新接 prod 环境数据迁移），步骤：

```bash
git mv docs/archive/scripts/<name>.ts packages/agent/scripts/
# 在 packages/agent/ 下跑
pnpm exec dotenv -e .env.development.local -- tsx scripts/<name>.ts
# 跑完再归档回来
git mv packages/agent/scripts/<name>.ts docs/archive/scripts/
```

## 仍保留的运行时脚本

`packages/agent/scripts/` 留下的脚本是基础设施（每次新搭环境都跑），**不归档**：

- `init-db.mjs` — 创建 lumideck_dev 数据库 + agent 用户 + 写 .env.development.local
- `init-test-db.mjs` — 创建 lumideck_test 数据库 + 测试用户 + 写 .env.test.local

`packages/slidev/scripts/`：

- `gen-icons.mjs` — P3-7 UnoCSS bug workaround，每次新增 icon 跑一次

`scripts/`（顶层）：

- `generate-template-thumbnails.ts` — 每加新模板跑 `pnpm gen:thumbnails`（Phase 7C 落定）
- `validate-template-tokens.ts` — Phase 7.5A token schema 校验
