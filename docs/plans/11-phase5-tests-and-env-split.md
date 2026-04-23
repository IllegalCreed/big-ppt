# Phase 5 补测 + Env 分层 实施文档

> **状态**：待开始（2026-04-23 规划完成）
> **规划文件**：`~/.claude/plans/docs-deck-deck-slidev-lucky-locket.md` 的「Phase 5 补测轨道」章节
> **前置阶段**：Phase 5C（2026-04-23 已闭环，见 [10](10-phase5-user-deck-versions.md)）
> **路线图依赖**：不阻塞 Phase 5.5 部署；但 **P5.5 上线前必须完成 commit 1–7**，E2E（commit 8）可推迟

**Goal**：把 Phase 5 新增的十个模块从"仅 curl smoke 验证"升级到"90% lines / 85% branches 覆盖 + 真测试 DB + Playwright E2E 三场景"；同时把 env 拆分为 development / test / production 三层，消除当前单一 `.env.local` 对测试造成的污染风险。

---

## 关键设计抉择（2026-04-23 与用户对齐）

1. **测试 DB**：阿里云 RDS 上新建 `lumideck_test` 库 + `lumideck_test_user` 账号，与 dev 同 server 不同 schema。不用 docker、不用 in-memory fake。理由：版本/编码完全一致，零抽象层风险；~50ms RTT × 每测 5×TRUNCATE 约 250ms/case，可接受
2. **覆盖率门槛**：lines 90 / branches 85 作为 CI 全局阈值；auth / crypto / slidev-lock / middleware-auth 四个安全关键模块单独 95/90 per-file override。不要求"100% 无限接近"——UI 分支和 CSS fallback 收益太低
3. **E2E 工具**：Playwright（新 `packages/e2e/` workspace），独立 `pnpm e2e` 入口，不进 turbo test 流水（避免与 vitest 抢端口）
4. **组件测试 API 层**：MSW 2.x 拦截 fetch，不 mock 产线代码
5. **测试 DB 重置**：per-test `beforeEach` TRUNCATE 5 张表 + `__resetForTesting()` 清 slidev-lock 内存；vitest `fileParallelism: false` 串行跑
6. **Env 分层工具**：`dotenv-cli`（与 quiz-backend 一致；跨 tsx / vitest / drizzle-kit 通用），不用 Node 20+ 的 `--env-file`

---

## ⚠️ Secrets 红线（继承 Phase 5）

所有 `.env.*.local` 继续不进 git。三份 local 都被 `.gitignore` 的 `.env.*` / `*.local` 命中。**三份 example 必须用反向白名单加回来**（`!.env.development.example` 等）。

每次 commit 前 `git status` 检查。禁用 `git add -A`。

---

## Env 分层方案

### 新增文件
| 文件 | 用途 | 入库 |
|---|---|---|
| `packages/agent/.env.development.example` | 字段清单 + 本地占位 | ✅ 入库 |
| `packages/agent/.env.test.example` | 指向 lumideck_test 的字段样板 | ✅ 入库 |
| `packages/agent/.env.production.example` | 部署时注入的字段清单 | ✅ 入库 |
| `packages/agent/.env.development.local` | dev 真实 creds | ❌ gitignored |
| `packages/agent/.env.test.local` | lumideck_test 真实 creds | ❌ gitignored |
| `packages/agent/.env.production.local` | prod 机器上的 creds | ❌ gitignored |

### 保留文件
- `packages/agent/.env.local` 作为 dev 别名，向后兼容 Phase 5 工作流；新 `pnpm dev` 优先读 `.env.development.local`，前者不存在时兜底读 `.env.local`

### scripts（`packages/agent/package.json`）
```
dev           → dotenv -e .env.development.local -e .env.local -- tsx watch src/index.ts
test          → dotenv -e .env.test.local -- vitest run
test:watch    → dotenv -e .env.test.local -- vitest
start         → dotenv -e .env.production.local -- node dist/index.js
db:push       → dotenv -e .env.development.local -e .env.local -- drizzle-kit push
db:push:test  → dotenv -e .env.test.local -- drizzle-kit push
init-db       → node scripts/init-db.mjs --env=development
init-test-db  → node scripts/init-db.mjs --env=test
```

### 源码守卫
- [packages/agent/src/index.ts](../../packages/agent/src/index.ts) 顶部 `dotenv.config` 加 `if (!process.env.DATABASE_URL)` guard：dotenv-cli 已注入时不覆盖
- [packages/agent/drizzle.config.ts](../../packages/agent/drizzle.config.ts) 同上

### .gitignore
追加白名单：
```
!.env.development.example
!.env.test.example
!.env.production.example
```

---

## DI Seams（最小侵入）

真实 test DB 优先 → 除下列两处外不改源码：

- [packages/agent/src/crypto/apikey.ts](../../packages/agent/src/crypto/apikey.ts) 加 `__setMasterKeyGetterForTesting(fn | null)`，默认仍读 `process.env.APIKEY_MASTER_KEY`
- [packages/agent/src/slidev-lock.ts](../../packages/agent/src/slidev-lock.ts) 加 `__resetForTesting()` 清内存锁

其他模块（auth / decks / lock / persist / middleware）不改，全走 `lumideck_test`。

---

## 测试 DB 生命周期

1. **首次（一次性）**：`pnpm -F @big-ppt/agent init-test-db` — 创建 DB + user + 写 `.env.test.local`
2. **每次 `pnpm test` 前**（本地/CI）：`pnpm -F @big-ppt/agent db:push:test` — drizzle-kit push 同步 schema，幂等
3. **每个集成 test 的 `beforeEach`**：`resetDb()` — `SET FOREIGN_KEY_CHECKS=0` → TRUNCATE 5 张表 → `__resetForTesting()` → `SET FOREIGN_KEY_CHECKS=1`
4. `afterAll`（每个 suite）：`closeDb()` 释放连接池

vitest 串行配置：
```ts
// vitest.config.ts
test: {
  fileParallelism: false,
  pool: 'threads',
  poolOptions: { threads: { singleThread: true } },
}
```

---

## 新增测试清单

### 后端（`packages/agent/test/`）76 cases

| 文件 | 类型 | cases | 核心验证 |
|---|---|---|---|
| `crypto-apikey.test.ts` | U | 6 | round-trip / tamper IV / tamper ciphertext / 版本前缀 / 密钥缺失 / 密钥长度错 |
| `slidev-lock.test.ts` | U | 10 | 抢占 / 同 session 覆盖 / 冲突返回 holder / heartbeat 三态 / release 幂等 / fakeTimer 5min 边界 |
| `context.test.ts` | U | 6 | ALS 外返回 EMPTY / runInRequest 嵌套 / setTurnId / setActiveDeckId / runInTurn 兼容 shim |
| `middleware-auth.test.ts` | I | 7 | 无 cookie / 无效 sid / 过期 / 有效 / requireAuth 401 / validateSessionFromCookie 四分支 |
| `routes-auth.test.ts` | I | 12 | register 400/409/201 / login 400/401/200 / logout / me / llm-settings PUT+GET 加密回环 / 空 apiKey 保留旧值 |
| `routes-decks.test.ts` | I | 14 | CRUD 完整 / 401/403/404 / 软删不上列表 / restore 前移 current_version_id / chats append 有序 / cross-user 隔离 |
| `routes-lock.test.ts` | I | 8 | activate 成功 / 跨用户 403 / 他人占用 409 / release 幂等 / heartbeat 三态 / lock-status isMe |
| `slides-store-persist.test.ts` | I | 6 | 无 activeDeckId 跳过 / 同内容跳过 / 新内容落版本 / turnId 写入 / 匿名 authorId=null / deleted deck 静默跳过 |
| `slidev-proxy.test.ts` | I | 4 | 无 cookie 401 / 非持有者 403 / 持有者 200 + 路径透传 / WS upgrade 无 auth destroy |
| `db-schema.test.ts` | I | 3 | users 删 → sessions/decks cascade / decks 删 → versions+chats cascade / deck_versions.author_id SET NULL |
| `_setup/test-db.ts` | helper | — | `resetDb()` + 连接复用 |
| `_setup/factories.ts` | helper | — | `createTestUser` / `loginAndGetCookie` / `createDeck` / `appendVersion` |

### 前端（`packages/creator/test/`）23 cases

| 文件 | cases | 核心验证 |
|---|---|---|
| `OccupiedWaitingPage.spec.ts` | 5 | 渲染 holder / 5s 轮询 / status=unlocked emit / unmount 清 interval |
| `VersionTimeline.spec.ts` | 5 | turnId 分组 / current badge / 点击 restore 调 API / 按 createdAt 倒序 / 空列表提示 |
| `DeckEditorCanvas.spec.ts` | 5 | 默认渲染 title / 双击切 input / Enter commit / Esc cancel / api 错误显示副标题 |
| `useAuth.spec.ts` | 4 | login 成功 / 失败 error / me null / logout 清 user |
| `useDecks.spec.ts` | 4 | list 注入 / create 新增 / delete 移除 / 409 抛原样错误 |

MSW setup 在 `test/_setup/msw.ts` 导出 server handlers，各 spec 复用。

### E2E（`packages/e2e/`）3 场景

新 workspace：`packages/e2e/{package.json, playwright.config.ts, tests/*.spec.ts}`。启两个真后端（agent:4100 + creator:3030，均指 `lumideck_test`）。

| 文件 | 场景 |
|---|---|
| `tests/happy-path.spec.ts` | 注册 → 登录 → /decks 空 → 新建 → 编辑页 → iframe 加载 → 发消息 → 刷新对话保留 → 返回列表 |
| `tests/lock-conflict.spec.ts` | A 占用 → B 打开同 deck 看等待页 → A 释放 → B 5s 内自动进入 |
| `tests/negative-auth.spec.ts` | 错密码 toast / 重复邮箱 409 / 未登录访问 /decks 跳 /login |

Playwright `globalSetup` 从 Node 直连 DB helper 清库（不暴露 HTTP 路由）。

---

## 覆盖率配置

### agent
- 新依赖：`@vitest/coverage-v8`
- [packages/agent/vitest.config.ts](../../packages/agent/vitest.config.ts) 加 coverage：
  - `provider: 'v8'`
  - `reporter: ['text', 'html', 'lcov', 'json-summary']`
  - `include: ['src/**/*.ts']`
  - `exclude: ['src/**/*.d.ts', 'dist/**', 'test/**', 'scripts/**', 'src/index.ts']`（bootstrap 段已由 `slidev-proxy.test.ts` 覆盖业务逻辑）
  - `thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 }`
  - per-file overrides `95/90`：`crypto/apikey.ts` / `slidev-lock.ts` / `middleware/auth.ts` / `routes/auth.ts`

### creator
- 新依赖：`@vitest/coverage-v8` + `msw`
- 同样加 coverage；`include: ['src/**/*.{ts,vue}']`；exclude `main.ts` / `router/` / `styles/`
- 初始阈值 lines 85 / branches 75（Vue 组件首轮难到 90），在 commit 7 结束时再评估收紧到 90/85

---

## Commit 顺序（每步独立可 `pnpm test && pnpm type-check`）

### 1. `chore(test): env 分层 + dotenv-cli 改造`
- 三份 example（入库）
- `packages/agent/package.json` scripts 改写
- `src/index.ts` + `drizzle.config.ts` 加 dotenv guard
- `.gitignore` 白名单
- 保留 `.env.local` dev 别名；148 个存量测试不动

### 2. `chore(test): init-test-db 脚本 + init-db 加 flag`
- 改 `scripts/init-db.mjs` 加 `--env` / `--database-url`
- 新 `scripts/init-test-db.mjs` 作为 wrapper
- README 更新 runbook：首次用户怎么跑初始化
- 本地跑一次 `pnpm init-test-db` + `pnpm db:push:test`

### 3. `refactor(test): 加 DI seams`
- `crypto/apikey.ts` 加 `__setMasterKeyGetterForTesting`
- `slidev-lock.ts` 加 `__resetForTesting`
- 共改 2 个源文件，现有测试无感知

### 4. `test(phase-5): 单元测试 apikey / slidev-lock / context`
- 纯 U 测试，不依赖 DB；22 cases，测试数 148 → 170

### 5. `test(phase-5): 集成测试 auth / decks / lock / persist / schema / proxy / middleware`
- 接 lumideck_test；`_setup/test-db.ts` + `_setup/factories.ts`；`fileParallelism:false`
- 54 cases，测试数 170 → ~224

### 6. `test(creator): 组件测试 + MSW`
- 5 个 spec + MSW setup；测试数 ~224 → ~247

### 7. `chore(coverage): 启用 @vitest/coverage-v8 + 90/85 阈值`
- 加依赖；两份 vitest.config.ts 加 coverage block
- 本地 `pnpm test -- --coverage` 首次跑达标；在门槛上调整 per-file override

### 8. `test(e2e): Playwright 三个场景`
- 新 `packages/e2e` workspace；独立 `pnpm e2e` 入口
- 不进 turbo test 流水，CI 分两 job

---

## 验证

```bash
# 8 commit 全部落地后
pnpm -F @big-ppt/agent init-test-db   # 一次性
pnpm -F @big-ppt/agent db:push:test   # 同步 schema
pnpm test                              # vitest 全绿（~247 cases）
pnpm test -- --coverage                # 通过 90/85 门槛
pnpm e2e                               # Playwright 3 spec 全绿

# DB 隔离验证
mysql -u lumideck_user -p -D lumideck -e "SELECT COUNT(*) FROM users"        # dev DB 数据完整
mysql -u lumideck_test_user -p -D lumideck_test -e "SELECT COUNT(*) FROM users"  # test DB 被测试清空
```

---

## 风险与取舍

| 风险 | 缓解 |
|---|---|
| 每测 TRUNCATE × RDS ~250ms / 80 cases ≈ 20s | 可接受；若慢了切 Option B（beforeAll seed / afterAll truncate）给非 auth/lock suite |
| `src/index.ts` bootstrap 不易覆盖 | exclude 它；业务逻辑（`authorizeSlidevAccess`）已在 `slidev-proxy.test.ts` 覆盖；`server.listen`/`registerLocalTools` 跳过 |
| MSW 破坏性变更 | 固定 2.x major 版本 |
| Playwright 与 vitest 抢端口 | E2E 独立 `pnpm e2e` 入口；agent 走 4100，dev agent 仍 4000 |
| dotenv-cli 与源码 dotenv 双加载冲突 | `if (!process.env.DATABASE_URL)` guard 避让 |
| 初始化工作量 | commit 1~3 半天；4~5 一天半；6~7 半天；8 一天。约 **3~3.5 工作日** |
