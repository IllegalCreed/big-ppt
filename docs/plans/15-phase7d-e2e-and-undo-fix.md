# Phase 7D — E2E 切换流 + /undo 模板可逆 + creator 测试基建改造

> **状态**：待启动（2026-04-25 设计收敛）
> **前置阶段**：Phase 7A ✅ / 7B ✅ / 7C ✅（[plan 14](14-phase7c-template-ui.md)）
> **路线图**：[roadmap.md Phase 7](../requirements/roadmap.md)
> **执行子技能**：参考 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按 task 推进；step 用 checkbox 跟踪。

**Goal**：补齐 roadmap Phase 7 剩余两条验收（`pnpm e2e` 9 条全绿 + 双向切换可逆），同时清掉 7C 暴露的两个硬前置——schema bug（`deckVersions` 无 `template_id` 列导致 /undo 切回旧模板时 `decks.template_id` 不同步）和技术债 **P3-10**（creator 单测过度依赖 msw mock）。

---

## 关键设计抉择（与用户对齐）

1. **/undo 模板可逆修法**：`deckVersions` 加 nullable `template_id` 列（drizzle push）。switch-template-job 写 snapshot version 带 `fromTemplateId`、写新 version 带 `toTemplateId`。restore 端点新行为：版本 `templateId` 非空则同步 `decks.template_id`，NULL（旧数据）则保持原行为不动。语义上 deck_version 升级为完整快照。
2. **E2E LLM 处理**：env 开关 `BIG_PPT_TEST_REWRITE_MODE=skeleton` 时 `rewriteForTemplate` 直接读 `templates/<toTemplateId>/starter.md` 当结果，不走 LLM。`packages/e2e/playwright.config.ts` 的 agent webServer 注入此 env。生产 / 一般测试不受影响。
3. **creator 测试基建改造（P3-10 全清）**：`packages/agent/src/index.ts` 抽出 `app.ts` 导出 Hono app 单例。`packages/creator/package.json` 加 `@big-ppt/agent: workspace:*` devDep。新建 `packages/creator/test/_setup/integration.ts`：beforeEach 调 agent 测试 DB reset；提供 `appFetch(req)` wrapper 让 composable 测试不走真网络直接 `app.fetch(req)`。3 个契约 spec（useAuth / useDecks / useSwitchTemplateJob）改用集成测；5 个 UI spec（DeckEditorCanvas / UndoToast / VersionTimeline / TemplatePickerModal / OccupiedWaitingPage）保留 msw。LLM / MCP 仍 mock（外部 cost）。
4. **「内容合规」断言策略**：每页 frontmatter 提取 `layout` 字段，断言全在 toTemplate manifest layouts 白名单内。skeleton mode 用 starter.md 当结果，行为可预测，断言不会 flaky。
5. **commit / 测试节奏**：四个 task 串行增量，每 task 独立 commit，每 task 完结 `pnpm test && pnpm e2e` 全绿；coverage 门槛不掉（agent 90/85、creator 75/65）。

---

## ⚠️ Secrets 安全红线（HARD，沿用 Phase 5/6/7A-C）

- `.gitignore` 规则不要动
- 本 Phase **不引入新环境变量**（仅一个测试用 env `BIG_PPT_TEST_REWRITE_MODE`，不写入任何 .env.* 文件，仅 playwright.config.ts inline 注入）
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
|---|---|
| `packages/agent/src/app.ts` | 抽出 Hono `app` 实例 export，方便 in-process 测试调用 |
| `packages/creator/test/_setup/integration.ts` | in-process app + lumideck_test 共享 DB 集成基建 |
| `packages/e2e/tests/template-switch-create.spec.ts` | 7D-1：新建走 jingyeda 完整链路 |
| `packages/e2e/tests/template-switch-existing.spec.ts` | 7D-2：beitou deck 切到 jingyeda + 内容合规 |
| `packages/e2e/tests/template-switch-undo.spec.ts` | 7D-3：切完 /undo 回旧模板 + 旧内容 |

### 修改

| 文件 | 职责 |
|---|---|
| `packages/agent/src/db/schema.ts` | `deckVersions.templateId: varchar(64)` nullable |
| `packages/agent/src/template-switch-job.ts` | snapshot version 写 `fromTemplateId` / 新 version 写 `toTemplateId` |
| `packages/agent/src/routes/decks.ts` | restore 端点：version.templateId 非空则同步 decks.templateId；createDeck 初始 version 带 templateId |
| `packages/agent/src/template-rewrite.ts`（task 开始时 grep 确认实际位置） | 加 skeleton mode 分支：env 命中时 readStarter 跳 LLM |
| `packages/agent/src/index.ts` | 改 `import { app } from './app.ts'` |
| `packages/creator/package.json` | 加 `@big-ppt/agent: workspace:*` devDep |
| `packages/creator/test/useAuth.spec.ts` | msw → integration（断言真实 401/200/201 + cookie） |
| `packages/creator/test/useDecks.spec.ts` | msw → integration（DB 真实 CRUD + 409 holder） |
| `packages/creator/test/useSwitchTemplateJob.spec.ts` | msw → integration（注入 fake RewriteFn 走真状态机） |
| `packages/e2e/playwright.config.ts` | agent webServer env 加 `BIG_PPT_TEST_REWRITE_MODE=skeleton` |
| `packages/e2e/tests/helpers/db.ts` | 加 `getDeckByIdSql(id)` helper（直读 lumideck_test 验 templateId） |
| `packages/agent/test/template-switch-job.test.ts` | 新 expects 含 templateId 字段 |
| `packages/agent/test/routes-decks.test.ts` | restore 端点新增 3 条同步 case |
| `packages/agent/test/db-schema.test.ts` | 验证 deckVersions.template_id 存在 |
| `docs/requirements/roadmap.md` | 7D 关闭：验收勾选 + 变更记录 |
| `docs/plans/99-tech-debt.md` | P3-10 标 ✅（移到完成区） |

### 涉及的关键现有路径（直接复用，不重写）

- `packages/agent/test/_setup/test-db.ts` 的 `useTestDb()` / `resetDb()` — creator 集成测复用
- `packages/agent/test/_setup/factories.ts` 的 `createTestUser` / `createSessionFor` / `createLoggedInUser` / `createDeckDirect` — creator 集成测复用
- `packages/agent/src/template-switch-job.ts:76-81` 的 `RewriteFn` 类型 — useSwitchTemplateJob 集成测注入 fake
- `packages/agent/src/routes/decks.ts:26-33` 的 `__setRewriteFnForTesting` — useSwitchTemplateJob 集成测注入入口
- `packages/e2e/tests/helpers/db.ts` 的 `truncateAllTables` / `_test/reset-lock` — 7D 三条 spec 复用
- `packages/e2e/tests/template-picker.spec.ts:14-81` 的 picker 流程 selector — 7D-1 / 7D-2 复用

---

## Task 7D-0：基线确认 + 工作准备

**Files**: 无修改

- [ ] **Step 1：跑全测试确认基线**

```bash
cd /Users/zhangxu/workspace/big-ppt
pnpm test
pnpm -F @big-ppt/e2e exec playwright install chromium 2>/dev/null || true
pnpm e2e  # 6 条应全绿
```

- [ ] **Step 2：grep 关键现有实现位置**

```bash
rg -n "rewriteForTemplate" packages/agent/src
rg -n "__setRewriteFnForTesting" packages/agent
rg -n "readStarter" packages/agent/src
```

记下 rewriteForTemplate 的实际所在文件（plan 假设 `template-rewrite.ts`，实际可能不同）。

---

## Task 7D-A：deckVersions.templateId 字段 + restore 同步

**Files**: `packages/agent/src/db/schema.ts` / `packages/agent/src/template-switch-job.ts` / `packages/agent/src/routes/decks.ts` / `packages/agent/test/db-schema.test.ts` / `packages/agent/test/template-switch-job.test.ts` / `packages/agent/test/routes-decks.test.ts`

- [ ] **Step 1：schema 加列**
  - `deckVersions` 加 `templateId: varchar('template_id', { length: 64 })`（nullable，无 default）
- [ ] **Step 2：drizzle push 同步两个库**

```bash
pnpm -F @big-ppt/agent db:push        # dev 库
pnpm -F @big-ppt/agent db:push:test   # lumideck_test
```

- [ ] **Step 3：`template-switch-job.ts` runSwitchJob**
  - snapshot version `insert` 加 `templateId: deck.templateId`（fromTemplateId）
  - 新 version `insert` 加 `templateId: job.to`（toTemplateId）
- [ ] **Step 4：`routes/decks.ts` restore 端点**
  - 查 version 时把 templateId 一起带出
  - 若 `version.templateId != null`：`decks.update.set({ currentVersionId, templateId: version.templateId })`
  - 若 NULL：保持原行为只更 currentVersionId（向前兼容旧数据）
- [ ] **Step 5：`routes/decks.ts` createDeck**
  - 初始 version `insert` 加 `templateId: <new deck templateId>`，保证未来历史完整
- [ ] **Step 6：测试**
  - `db-schema.test.ts` 加 1 条：验证 `deck_versions.template_id` 列存在
  - `template-switch-job.test.ts` 更新 expects：snapshot version templateId === from / 新 version templateId === to
  - `routes-decks.test.ts` 加 3 条 restore case：
    - (a) 切模板成功后用 snapshot version restore → decks.templateId 回旧
    - (b) 同模板内回滚（普通 version） → decks.templateId 不变
    - (c) 旧版本 templateId NULL → decks.templateId 不改（向前兼容）
- [ ] **Step 7：跑全测试**

```bash
pnpm test
pnpm e2e
```

**Commit**: `feat(phase-7d): deckVersions 加 templateId 列 + restore 端点同步 decks.template_id`

---

## Task 7D-B：rewriteForTemplate skeleton mode

**Files**: `packages/agent/src/template-rewrite.ts`（实际位置以 7D-0 grep 结果为准）/ 对应单测

- [ ] **Step 1：定位 rewriteForTemplate 实际文件**
  - 7D-0 已确认；如有疑问再次 `rg -n "rewriteForTemplate"`
- [ ] **Step 2：函数入口加 skeleton mode 分支**
  - `if (process.env.BIG_PPT_TEST_REWRITE_MODE === 'skeleton') return readStarter(toTemplateId)`
  - 注释标明仅供 E2E 使用、生产不影响
- [ ] **Step 3：单测加 1 条**
  - vitest 通过 `vi.stubEnv('BIG_PPT_TEST_REWRITE_MODE', 'skeleton')` 验证返回 starter.md 内容、不调 LLM mock
- [ ] **Step 4：跑全测试**

```bash
pnpm test
```

**Commit**: `feat(phase-7d): rewriteForTemplate 加 BIG_PPT_TEST_REWRITE_MODE=skeleton 分支供 E2E`

---

## Task 7D-C：creator 测试基建改造（P3-10 全清）

**Files**: `packages/agent/src/app.ts`（新）/ `packages/agent/src/index.ts` / `packages/creator/package.json` / `packages/creator/test/_setup/integration.ts`（新）/ `packages/creator/test/useAuth.spec.ts` / `packages/creator/test/useDecks.spec.ts` / `packages/creator/test/useSwitchTemplateJob.spec.ts`

- [ ] **Step 1：抽 `packages/agent/src/app.ts`**
  - 把 index.ts 里 Hono app 装配代码（`new Hono()` + middleware + route 挂载）搬到 app.ts
  - export `const app`
  - index.ts 改成 `import { app } from './app.ts'` 后 `serve({ fetch: app.fetch, port })`
  - agent 全测应仍绿（仅文件位置变动）
- [ ] **Step 2：creator 加 workspace dep**
  - `packages/creator/package.json` devDependencies 加 `"@big-ppt/agent": "workspace:*"`
  - 跑 `pnpm install`
- [ ] **Step 3：建 `packages/creator/test/_setup/integration.ts`**
  - export `appFetch(input: string, init?: RequestInit)`：构造 Request，调 `app.fetch(req)` 返 Response
  - export `setupIntegration()`：beforeEach 调 agent test-db 的 resetDb；维护 cookie jar（提取 Set-Cookie，注入下次 Cookie 头）
  - 直接 `import { useTestDb } from '@big-ppt/agent/test/_setup/test-db'`（如果 path 不通就 import 相对路径或加 exports map）
- [ ] **Step 4：useAuth.spec.ts msw → integration**
  - 删 msw mock 路由
  - register 201 / login 200 cookie / logout 200 / me 401 全用 appFetch 验证
  - 校验真实响应字段结构（`user.id` / `user.email` / `hasLlmSettings`）
- [ ] **Step 5：useDecks.spec.ts msw → integration**
  - 先 createLoggedInUser 拿 cookie
  - listDecks / createDeck / deleteDeck / activate 409 holder 全 appFetch 验证
  - 验证 DB 状态变化（drizzle select 查 decks 表）
- [ ] **Step 6：useSwitchTemplateJob.spec.ts msw → integration**
  - `__setRewriteFnForTesting` 注入返回固定 jingyeda md 的 fake RewriteFn
  - appFetch POST `/api/decks/:id/switch-template` + 轮询 GET `/api/switch-template-jobs/:jobId`
  - 验证完整状态机：pending → snapshotting → migrating → success
  - 验证 DB：decks.templateId 已更新；新 version 已插
- [ ] **Step 7：UI 5 spec 完全不动**（DeckEditorCanvas / UndoToast / VersionTimeline / TemplatePickerModal / OccupiedWaitingPage）
- [ ] **Step 8：跑全测试 + coverage 门槛**

```bash
pnpm test
pnpm -F @big-ppt/agent test:coverage   # ≥ 90/85
pnpm -F @big-ppt/creator test:coverage # ≥ 75/65
pnpm e2e
```

**Commit**: `refactor(phase-7d): creator 契约 spec 从 msw 迁到 in-process agent + lumideck_test 集成测 (P3-10 全清)`

---

## Task 7D-D：3 条 E2E spec + 路线图关闭 + tech-debt 清零

**Files**: `packages/e2e/playwright.config.ts` / `packages/e2e/tests/helpers/db.ts` / `packages/e2e/tests/template-switch-create.spec.ts`（新）/ `packages/e2e/tests/template-switch-existing.spec.ts`（新）/ `packages/e2e/tests/template-switch-undo.spec.ts`（新）/ `docs/requirements/roadmap.md` / `docs/plans/99-tech-debt.md`

- [ ] **Step 1：playwright.config.ts agent webServer env**
  - `env: { AGENT_PORT: ..., BIG_PPT_TEST_REWRITE_MODE: 'skeleton' }`
- [ ] **Step 2：helpers/db.ts 扩展**
  - 加 `getDeckByIdSql(id: number): Promise<{ id, title, templateId, currentVersionId }>` 直读 lumideck_test
  - 加 `getCurrentVersionContent(deckId: number): Promise<string>` 查最新 version 的 content
- [ ] **Step 3：template-switch-create.spec.ts (7D-1)**
  - 注册 → URL `/decks` → 点新建 deck 按钮 → picker → 选 jingyeda 卡 → 填标题 → 创建 → URL `/decks/\d+`
  - 等编辑器顶栏标题
  - 断言：`getDeckByIdSql(id).templateId === 'jingyeda-standard'`
  - 断言：当前 version content 里所有 `layout: <name>` 字段全在 jingyeda manifest layouts 白名单内
- [ ] **Step 4：template-switch-existing.spec.ts (7D-2)**
  - 注册 → 通过 API 创 beitou deck（用 helpers 跳 picker） → 进 `/decks/:id` 编辑器
  - 顶栏点切换模板按钮 → picker → 选 jingyeda → 点切换（AI 重写）
  - 等 success view（progress → success；skeleton mode 走 starter.md 快速完成）
  - 关窗 → 等 UndoToast 出现
  - 断言：`getDeckByIdSql(id).templateId === 'jingyeda-standard'`
  - 断言：当前 version content layout 全在 jingyeda 白名单
- [ ] **Step 5：template-switch-undo.spec.ts (7D-3)**
  - 复用 7D-2 前半段把 beitou deck 切到 jingyeda（必要时 Page Object 抽公共 setup）
  - 不等 toast 自动消失，点 toast 里的 /undo 链接 → URL 跳 VersionTimeline 高亮 snapshot version
  - 点 snapshot version 的 restore 按钮 → 等 toast 关闭 / 等编辑器刷新
  - 断言：`getDeckByIdSql(id).templateId === 'beitou-standard'`
  - 断言：当前 version content layout 全在 beitou 白名单
  - 断言：内容字符串与切换前 snapshot 一致（精确 equality）
- [ ] **Step 6：roadmap.md 关闭 7D**
  - Phase 7 验收两条勾选（`pnpm e2e 全绿` / `双向切换可逆`）
  - 状态行改为 ✅ 关闭，加 2026-04-25 变更记录行（与 7C 风格一致，记录关键 commit + 实施期偏离）
- [ ] **Step 7：tech-debt.md P3-10 清零**
  - P3-10 标 ✅（移到「已清除」区或保留位置加 ✅ 前缀）
  - 写实际修复内容：抽 app 单例 / 加 _setup/integration.ts / 三个契约 spec 改造 / msw 仅服务 5 个 UI spec
- [ ] **Step 8：跑全测试 + e2e 9 条**

```bash
pnpm test
pnpm e2e  # 9 条全绿
```

**Commit**: `feat(phase-7d): 3 条切换流 E2E + /undo 双向可逆 + roadmap 7D 关闭 + tech-debt P3-10 清零`

---

## 验收条件（路线图 Phase 7）

- [ ] `pnpm test` 全绿（unit 数 ≥ 363；预计 +5 左右）
- [ ] `pnpm -F @big-ppt/agent test:coverage` lines ≥ 90 / branches ≥ 85
- [ ] `pnpm -F @big-ppt/creator test:coverage` lines ≥ 75 / branches ≥ 65
- [ ] `pnpm e2e` 9 条全绿（原 5 + 7C 1 冒烟 + 7D 3）
- [ ] **双向切换可逆**：7D-3 spec 通过即满足 roadmap 验收
- [ ] **creator 3 个契约 spec** 完全跑在真实 agent + lumideck_test 上，msw 仅服务 5 个 UI spec
- [ ] roadmap.md Phase 7 状态改为 ✅ 关闭 + 变更记录追加
- [ ] tech-debt.md P3-10 标 ✅，描述实际修复方案

---

## 验证方法

```bash
# 跑全套 unit + e2e
pnpm test
pnpm e2e

# 单独 coverage 门槛
pnpm -F @big-ppt/agent test:coverage
pnpm -F @big-ppt/creator test:coverage

# 手动验 7D-3 双向可逆（最高保险）
pnpm dev
# 浏览器：注册 → 建 beitou deck → 顶栏切换到 jingyeda → 等切换成功
# → 点 UndoToast 的 /undo → VersionTimeline 高亮 snapshot → 点 restore
# → 编辑器立刻渲染回旧内容 + 旧 layouts 不报错

# 手动验 P3-10 测试基建确实能拦下契约 bug
# 临时改 useDecks.ts 的 fetch URL 加错前缀（e.g. /apii/decks）
# 跑 pnpm -F @big-ppt/creator test → useDecks.spec.ts 应失败而非全绿
```

---

## 不做什么（范围围栏）

- ❌ 不引入新环境变量除 `BIG_PPT_TEST_REWRITE_MODE`（仅 playwright config 内联，不进任何 .env.* 文件）
- ❌ 不动现有 5 个 UI spec 的 msw 路径（DeckEditorCanvas / UndoToast / VersionTimeline / TemplatePickerModal / OccupiedWaitingPage）
- ❌ 不重构 agent test/_setup（直接复用现成的 useTestDb / factories）
- ❌ 不增第 11 个 creator spec（保持现有 10 个）
- ❌ 不写 progress 阶段后台运行能力（plan 14 已 YAGNI）
- ❌ 不动 deckChats 表（与 deck_versions 跨版本保留语义维持）
- ❌ 不在生产代码做模板回退兼容兜底（旧版本 NULL templateId 直接保持原 restore 行为，不做"猜测旧模板"）

---

## 执行期偏离（关闭后追加）

- **schema bug 7D-A 是硬前置**：原 plan 把 7D-A schema 修当作普通 task，实施时发现 7D-3 双向可逆 E2E 完全建立在这个修复上，不修就跑不通。落地时 7D-A 先于 7D-D 完成
- **`BIG_PPT_TEST_REWRITE_MODE=skeleton` 走 webServer env**：E2E 用 env 控制 skeleton mode 跳真 LLM 是低成本设计；playwright.config.ts 里 agent webServer env 直接写死，不进任何 `.env.*` 文件
- **测试净减 1**：plan 预计 +N 创新；7D-C 把 useDecks / useAuth / useSwitchTemplateJob 三个 spec 从 msw 迁到真后端，部分 msw 专用 case 合并（72 → 71）
- **顺手修 P3-10**：plan 14 暴露的"creator 单测过度依赖 msw mock"在 7D-C 全清，作为本 plan 副产品

---

## 踩坑与解决

### 坑 1：deck_versions 缺 templateId 列导致 restore 后 deck.templateId 不同步

- **症状**：用户切模板 → /undo → restore 旧版本，前端显示旧内容但 `decks.template_id` 仍是新模板，下次保存版本时混乱
- **根因**：`deck_versions` 表只存 content + message，没存 templateId 快照；restore 时 routes/decks 端点未联动 `decks.template_id`
- **修复**：commit `34a1ccb` — `deckVersions` 加 nullable `template_id` 列；`template-switch-job` snapshot 写 fromTemplateId / 新 version 写 toTemplateId；restore 端点 fallback 同步 `decks.template_id`（旧数据 NULL 不动向前兼容）
- **防再犯**：版本表必须存"完整快照"，不只是内容；任何 deck-level 字段被切换的地方都要在 version 上反映
- **已提炼到 CLAUDE.md**：否（属于 schema 演化历史）

### 坑 2：persist 写新 version 时漏同步 deck.template_id

- **症状**：切模板成功后 deck 新 version 创建，但 `decks.template_id` 没改
- **根因**：persist 函数职责单一，没考虑联动 deck-level 字段
- **修复**：commit `0d2a349` — persist 写新 version 时同步 `deck.template_id`
- **防再犯**：所有"既更 version 又更 deck-level"的操作要 transaction 包；future ORM event hook 可统一处理
- **已提炼到 CLAUDE.md**：否

### 坑 3：切模板成功后预览仍是旧的（Slidev HMR 协调）

- **症状**：切模板成功，DB 落地新内容，但 iframe 预览仍显示旧 layouts
- **根因**：commit `9bd4f6e` — backend 漏 mirror（slides.md 没更新）+ frontend 漏 refresh（即使 mirror 了，前端也得手动触发 iframe 重载）
- **修复**：先确保 mirror（agent 主动写 packages/slidev/slides.md）；再 commit `81c200d` 改回不再前端调 `slideStore.refresh()`，让 Slidev HMR 自己推（前端调反而触发 race，HMR 已经在路上）
- **防再犯**：CLAUDE.md "Slidev 包的特殊点" 已记录"切换 deck 时让 Slidev HMR 自己处理，前端不调 refresh"
- **已提炼到 CLAUDE.md**：是

### 坑 4：SlidePreview 切模板后 502（Slidev reload 窗口）

- **症状**：切模板瞬间 iframe 报 502
- **根因**：Slidev 收到 mirror 后会触发 reload，reload 窗口（约 200-500ms）期间 dev server 不响应；如果前端这时还 fetch iframe URL 就 502
- **修复**：commit `c92ac31` — SlidePreview 改 probe-then-refresh：先 HEAD 探活，等到 Slidev 起好才刷 iframe
- **防再犯**：所有"重启敏感"的服务前端访问都加 probe；CLAUDE.md "已知坑" 已收录
- **已提炼到 CLAUDE.md**：是

### 坑 5：Slidev `/@server-reactive/nav` 翻页 404

- **症状**：Slidev 翻页时 devtools 看到 `/@server-reactive/nav` 404
- **根因**：双层 proxy（agent → slidev）让 Slidev 内部的 server-reactive endpoint 在 base path 解析时丢失前缀
- **修复**：暂时双层 proxy workaround（agent 转发该 endpoint），登记 P3-11 后续 Slidev 升级再复检
- **防再犯**：CLAUDE.md 已知坑 + tech-debt 双登记
- **已提炼到 CLAUDE.md**：是

### 坑 6：theme 字段兜底白名单缺失导致 :3031 起不来

- **症状**：切模板时 LLM 偶尔在 frontmatter 里塞了奇怪的 theme 字段（如 `theme: jingyeda`），Slidev 没这个 theme 启动失败
- **根因**：rewriteForTemplate 没校验 LLM 输出的 frontmatter 字段
- **修复**：commit `77d2b47` — theme 字段兜底白名单 + 修当前 slides.md 让 :3031 起得来；commit `8156093` — 校验 LLM 返回值合法性 + prompt 加禁止 tool_call 格式
- **防再犯**：所有 LLM 输出落 disk 前要做 schema validation；任何允许 LLM 自由文本的字段都要白名单
- **已提炼到 CLAUDE.md**：否（属于 LLM 输入卫生通用原则，但具体规则在 plan）

### 坑 7：E2E 切模板搞乱 dev slidev

- **症状**：E2E 跑切模板会写到 dev 的 `packages/slidev/slides.md`，把开发者正在看的预览搞乱
- **根因**：mirror 路径默认 dev/test 共用
- **修复**：commit `7b97c85` — E2E mirror 写到 `/tmp` 隔离
- **防再犯**：所有"写 fs"的代码路径在 test env 下都要走可配置的临时目录
- **已提炼到 CLAUDE.md**：否（已嵌入 E2E 配置）

---

## 测试数量落地

| 阶段（commit）| agent | creator | shared | E2E | 合计 |
| ------------- | ----- | ------- | ------ | --- | ---- |
| 入口（plan 14 收）| 281 | 72 | 3 | 6 | 362 |
| 7D-A (34a1ccb deckVersions.templateId 列 + restore) | 285 | 72 | 3 | 6 | 366 |
| 7D-B (8ab7bdb skeleton mode) | 287 | 72 | 3 | 6 | 368 |
| 7D-C (d377115 真后端契约 spec) | 294 | 71 | 3 | 6 | 374 |
| 7D-D (89dab6e 3 条切换流 E2E) | 294 | 71 | 3 | 9 | **377** |

> 最终：294 agent + 71 creator + 3 shared = **368 unit + 9 E2E = 377 total**。
