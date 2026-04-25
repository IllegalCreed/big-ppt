# Phase X — <主题> 实施文档

> **状态**：待启动 / 进行中 / ✅ 已关闭（YYYY-MM-DD）
> **前置阶段**：plan NN（链接）
> **后续阶段**：plan NN（链接）
> **路线图**：[roadmap.md Phase X](../requirements/roadmap.md)
> **执行子技能**：`superpowers:executing-plans` 或 `superpowers:subagent-driven-development`（按规模选）

**Goal**：一段话讲清本 Phase 要交付什么、为什么要做、不做什么的核心边界。读者读完这一段就知道当前 Phase 的范围。

---

## 关键设计抉择（YYYY-MM-DD 与用户对齐）

> 设计期与用户拍板的非显然决策，每条带"Why"——为什么这样选而不是另一种。
> 任务执行期发现 plan 的 bug 时直接修这里 + 加 prevent-regression 测试，"plan 是活文档"。

1. **<决策点>**：选择 X，理由是 Y；放弃 Z 是因为 W
2. ...

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- 本 Phase 是否引入新环境变量：是 / 否（如是，列清单）
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表（如适用）

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `path/to/file.ts` | 一句话讲清干啥 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `path/to/existing.ts` | 加 X 字段 / 重构 Y 函数 |

### 删除

| 文件 | 原因 |
| ---- | ---- |

---

## 数据模型变更（如适用）

### `<table_name>` 表

```ts
// packages/agent/src/db/schema.ts
<具体改动>
```

迁移策略：drizzle-kit push（dev）+ 数据迁移脚本（如适用）。

---

## 阶段拆分

每个 Task 一个 commit；每步绿测试 + 当步独立可回退。

### Task X-A：<标题>

**目的**：一句话。

**操作**：
1. 改 `path/to/file.ts`：具体怎么改
2. 加单测：测什么
3. 改 manifest / config（如适用）

**验证方法**：
- 跑 `pnpm -F @big-ppt/<pkg> vitest run path/to/file.test.ts`
- 浏览器手验：`pnpm dev`，进入 X 页面，操作 Y，预期看到 Z

**风险**：可能踩到的坑 + 怎么绕。

### Task X-B：...

---

## 验收条件（roadmap.md Phase X 清单映射）

- [ ] 验收点 1（对应 roadmap 第 1 条）
- [ ] 验收点 2
- [ ] 全量回归（`pnpm test` + `pnpm e2e` 全绿）
- [ ] coverage 门槛维持（agent 90/85，creator 75/65）

---

## 不做什么（范围围栏）

- ❌ <用户明确说不做的事>
- ❌ <延到下个 Phase 的事>
- ❌ <永久不做的事>

---

## 执行期偏离（关闭后追加）

> 实际跑下来与 plan 不一致的点，写清"原 plan 怎么说 / 实际怎么做 / 为什么改"。
> plan 不强求和实施 100% 对齐，但偏离必须显式记录。**与"踩坑与解决"区别**：偏离是 plan ≠ 实施；踩坑是 bug + 解法。

- **<偏离点 1>**：原计划 X，实际 Y，原因 Z
- ...

---

## 踩坑与解决（实施期 / 关闭后追加）

> 跑过程中遇到的、需要侦探一阵才搞定的 bug。每条按"症状 / 根因 / 修复 / 防再犯"四段记完整故事，让未来同类问题能直接 grep 到。
>
> **判断要不要提炼一句话到 [CLAUDE.md 已知坑](../../CLAUDE.md#已知坑) 章节**：
> - ✅ 提炼：换个 Phase 同样情景下**还会撞**的（如 schema/工具链/测试基建/构建系统层面的坑）
> - ❌ 不提炼：本 Phase 一次性的业务 bug（写错 if 条件、忘加 await 之类）
> 提炼标准：CLAUDE.md 那条要能让"以后的 Claude 在动手前就主动绕开"，所以必须是**短句 + 操作性强**。

### 坑 1：<一句话症状>

- **症状**：用户/测试看到的现象（带错误信息或日志关键字）
- **根因**：定位到的本质（不是表面）
- **修复**：commit hash / PR / 关键 diff
- **防再犯**：测试 / lint rule / CI 守卫 / 文档备注。**已提炼到 CLAUDE.md**：是 / 否（如是，链接锚点）

### 坑 2：...

---

## 测试数量落地（关闭后追加）

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit       |      |      |      |
| creator unit     |      |      |      |
| shared unit      |      |      |      |
| E2E              |      |      |      |
| coverage lines   |      |      |      |
| coverage branch  |      |      |      |

---

## 模板使用说明（删除此节再发布）

- **不要把 vision/roadmap/requirements 的内容拷过来**——本 plan 只写技术实施
- **类名 / SDK / DB schema / 文件路径**这些 roadmap 里没有的细节，全部在本文档落定
- 设计抉择带 "Why"——未来读者只读 plan 就能理解为什么这样选
- 每条偏离都要在关闭时回写，不要让 plan 与代码各走各的
