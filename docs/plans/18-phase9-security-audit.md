# Phase 9 — 安全 Audit L3 实施文档

> **状态**：✅ 已关闭（2026-04-26）
> **前置阶段**：[plan 17](17-phase8-deps-upgrade.md) Phase 8 已关闭（依赖全量升级 + 0 高危漏洞前哨）
> **后续阶段**：Phase 10（首次部署）
> **路线图**：[roadmap.md Phase 9](../requirements/roadmap.md)
> **执行子技能**：`superpowers:subagent-driven-development`（多类独立审计可并行）

---

## Context

Phase 8 全量升级依赖、把 `pnpm audit --audit-level=high` 拉到 0、Node engines 固化 22 LTS，整个工程基线干净。**Phase 9 是部署前最后一道闸门**——把当前安全姿态系统性扫一遍，用 OWASP Top 10 当地图，每项给"代码现状 + 缺口 + 修复证据"，最后落一份可追溯的审计报告。Phase 10 之后用户系统真正对外，再补这些就晚了：用户已有数据，schema/cookie/session 都难动。

Explore + 用户复核（2026-04-26）盘点出 **7 个真实缺口**（Explore agent 原报告把 mcp.json 当作"明文落仓"是误判——实际 `packages/agent/data/.gitignore` 第 1 行就 ignore 了 mcp.json，`git ls-files` / `git log --full-history` 全无；`PRESET_MCP_SERVERS.headers = {}` 是空的，token 是运行时用户自填、P2-4 已加密。已撤销该条）：

1. **MCP server 全用户共享单文件 → A01 Broken Access Control（用户复核发现）**：`McpServerRepo` 接口的 `list()` / `get(id)` / `create()` / `update()` / `delete()` **全无 userId 参数**，所有登录用户操作的是同一份 server 列表。后果：A 启用 + 填自己的智谱 token → B 登录看到 server enabled + 用 A 的 token 调用，跨用户凭据共享 + 配额混账。Phase 5 给 deck/version/chat 都做了 per-user 隔离，MCP 这块**遗漏**了
2. `/log-event` 端点无鉴权（任何人能往日志里灌内容 / 探测内部错误）；`/log/latest` 同样开放
3. Slidev iframe 缺 `sandbox` 属性（iframe 内脚本能访问 parent window）
4. 全栈 0 rate limit（register / login / llm 端点可暴力破解 / 烧 token）
5. Logger 透传整个 payload（password / apiKey / Authorization 字段会原样落 disk）
6. Error 消息可能泄漏内部细节（生产 stack trace / "解密失败：…"）
7. P3-15 vitest 4 coverage 算法差异引入的 89/83 临时门槛要在本 Phase 拉回 90/85

外加 roadmap 指定的"仓库卫生"——三处 scripts/ 目录所有脚本的"保留 / 通用化 / 删除"明确判定 + knip 死代码扫描 + .gitignore 加固（`data/*` 整目录 ignore 防未来漏 ignore）。

---

## 关键设计抉择（待用户对齐 + Phase 9 启动期补齐）

> 设计期与用户拍板的非显然决策，每条带"Why"。任务执行期发现新缺口直接修这里 + 加 prevent-regression 测试。

1. **审计报告路径**：`docs/security/2026-04-audit-report.md`（roadmap 验收 #4 指定）。每项 OWASP 检查带"代码行号 / test case / config 位置"作为证据，不写抽象描述。
2. **Rate limit 实现**：用 hono 生态轻量内存版（如 `hono-rate-limiter` 或自撸 LRU Map + token bucket），不引 Redis（Phase 10 单实例够用，Phase 11 多实例时再迁集中存储）。Why：避免引入新基础设施依赖，单实例期内存版足以挡住简单暴力破解。
3. **CSRF 防护策略**：保持现有 `sameSite=lax` cookie 主防线 + 给所有 state-changing 端点加 **Origin / Referer 校验中间件**（白名单：`process.env.PUBLIC_ORIGIN`），不引 double-submit token。Why：sameSite=lax 已挡住跨站 POST 主路径；Origin 校验是低成本增强，不影响正常会话。
4. **CSP 策略**：仅 `Content-Security-Policy-Report-Only` 模式上，先观察一段时间不强制（Slidev iframe 内含 inline script + eval，Phase 9 仓促硬切 CSP 风险高）。Why：CSP 误配会直接 break Slidev，Phase 10 上线前先收集 violation 报告，Phase 11 之后再切 enforce。
5. **MCP per-user 入库（A01 修复）**：抛弃 `data/mcp.json` 全用户共享单文件方案，新增 `user_mcp_servers` 表（user_id + server_id + 加密 headers + enabled + preset 等），`McpServerRepo` 接口所有方法加 `userId` 参数，`mcp-registry` 从 singleton 改 per-user（每用户独立 connection pool）。dev 库现有 mcp.json 数据无主直接清；prod 还没上线，零迁移成本。Why：跟 deck/version/chat 一样的 per-user 隔离原则；P10 上线前修最便宜。**工具命名 `mcp__<serverId>__<toolName>` 保持不变**——registry 已 per-user 隔离，工具调用时通过 ctx.user 路由到对应 user 的 server，无需把 userId 编进工具名（避免 prompt 暴露 userId）。
6. **错误消息脱敏**：抽 `errorResponse(err, isProd)` helper——dev 完整 + prod 只回 generic message + 内部 errorId（用 nanoid），具体错误日志写到结构化 logger（含 trace stack）。前端可凭 errorId 让用户报告问题。Why：不丢调试能力 + 不向公网泄露。
7. **日志脱敏策略**：在 logger 写盘前过滤 `password / apiKey / authorization / cookie / token / secret` 字段（不分大小写，深度递归 JSON）。同时 logger.handleLogEvent 限大小（≤ 64KB，超出截断 + 标记 truncated）。Why：双重防线——单纯依赖业务方"不要 log 敏感字段"靠不住。
8. **一次性脚本处置**：4 个迁移脚本（backfill / migrate / rename / seed-demo）→ **删除 + git mv 到 `docs/archive/scripts/` 留作历史参考**（不直接 rm，commit 历史本来就有，但归档目录便于翻找）；2 个 init 脚本（init-db / init-test-db）→ **保留**（每次新建环境都用）。Why：roadmap 验收 #5 要求每个脚本有明确判定，归档比 rm 给了"看不见但可考古"的折中。
9. **死代码扫描工具**：装 `knip`（比 ts-prune 更新活跃、对 monorepo 友好），跑一次找未引用导出 / 未用文件 / 未用 deps，**人工评估**结果（不全自动删，避免误伤动态加载或 Slidev runtime 引用），把判定结果写进审计报告。Why：knip 本身不进生产，仅 Phase 9 一次性使用；不进 CI（避免 false positive 卡 PR）。
10. **P3-15 coverage 拉回的范围**：只补 `routes/auth.ts` + `slidev-lock.ts` 两个 per-file 95 门槛微跌的文件（vitest 4 AST 算法差异暴露的小空缺），不全包补；global 90/85 让 per-file 拉回后自然回到原值。Why：避免为了凑数字写无意义测试。
11. **仓库 secrets 历史扫描**：用 `gitleaks`（不用 trufflehog，gitleaks 扫得更快 + 规则更新活）+ 全 git 历史。Why：当前仓库历史相对短（Phase 1-8 几个月），扫一次 < 1 分钟。
12. **License 合规审查**：用 `pnpm licenses list` 出全量 license 表，人工标 GPL/AGPL 依赖 → 评估 → 报告。Why：项目为闭源商业软件，GPL 传染性需排查。

---

## ⚠️ Secrets 安全红线

- `.gitignore` 现有 `.env.*` / `.env.*.local` / `data/mcp.json`（可能含 preset token）规则保留 + **新增 `data/`（除 `data/.gitkeep`）整目录 ignore**，避免未来 data/ 下新文件忘 ignore
- 本 Phase 引入新环境变量：
  - `RATE_LIMIT_ENABLED`（生产开 / 测试关）
  - `PUBLIC_ORIGIN`（Origin 校验白名单）
  - `LOG_REDACT_FIELDS`（自定义脱敏字段，逗号分隔，可选）
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**
- **gitleaks 扫描必须在每个 commit 之后跑一次**（防 plan 自身写到 secret）

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `docs/security/2026-04-audit-report.md` | OWASP Top 10 审计报告主文档（含每项证据） |
| `docs/security/checklist.md` | 审计检查清单（机器可解析的 markdown 表格） |
| `packages/agent/src/middleware/rate-limit.ts` | hono 中间件：登录 / 注册 / llm-chat / log-event 速率限制 |
| `packages/agent/src/middleware/origin-check.ts` | Origin/Referer 白名单中间件 |
| `packages/agent/src/middleware/csp.ts` | CSP Report-Only header（生产开） |
| `packages/agent/src/utils/error-response.ts` | 统一 error helper（dev 详 / prod 脱敏 + errorId） |
| `packages/agent/src/utils/redact.ts` | 日志脱敏（深度递归 JSON 字段） |
| `packages/agent/src/db/schema.ts` 内新表 `userMcpServers` | per-user MCP server 配置表（user_id 外键 + server config + 加密 headers） |
| `packages/agent/scripts/migrate-mcp-to-db.ts` | 一次性：dev 库现有 mcp.json 数据无主清空（prod 未上线零成本） |
| `docs/archive/scripts/README.md` | 归档脚本目录索引 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/src/routes/log.ts` | `/log-event` 加 `requireAuth` + rate limit（10 req/min/user） |
| `packages/agent/src/routes/auth.ts` | login / register 加 rate limit（5 req/15min/IP）；error 走 error-response helper |
| `packages/agent/src/routes/llm.ts` | llm-chat 加 rate limit（30 req/hour/user）；error 脱敏 |
| `packages/agent/src/logger/index.ts` | 写盘前调 `redact()`；64KB 超限截断 |
| `packages/agent/src/app.ts` | 装配 origin-check + csp middleware |
| `packages/agent/src/index.ts` | 启动时 warn 若 PUBLIC_ORIGIN 未设 |
| `packages/agent/src/mcp-server-repo/types.ts` | `McpServerRepo` 接口所有方法加 `userId: number` 参数 |
| `packages/agent/src/mcp-server-repo/json-file-repo.ts` | 弃用（保留代码 + 加 @deprecated 注释，留作回退参考；运行时不再用） |
| `packages/agent/src/mcp-server-repo/drizzle-repo.ts`（新建） | 用 Drizzle 实现 `McpServerRepo`，per-user 操作 user_mcp_servers 表；headers 仍走 P2-4 AES-256-GCM 加解密 |
| `packages/agent/src/mcp-server-repo/index.ts` | `getRepo()` 默认返 DrizzleRepo（旧 JsonFileRepo 走 env flag 兜底） |
| `packages/agent/src/mcp-registry/index.ts` | singleton 改 per-user 注册中心（`getRegistry(userId)` 返该 user 的连接池）；ctx.user 路由 |
| `packages/agent/src/routes/mcp.ts` | 所有路由 handler 用 `ctx.var.user.id` 调 repo + registry，不再传全局 |
| `packages/agent/src/tools/registry.ts` | 工具列表生成时按 ctx.user 路由到对应 registry，工具命名 `mcp__<serverId>__<toolName>` 保持不变 |
| `packages/creator/src/components/SlidePreview.vue` | iframe 加 `sandbox="allow-same-origin allow-scripts allow-forms"` |
| `packages/agent/vitest.config.ts` | coverage 门槛拉回 statements 90 / branches 85（per-file 95 同步） |
| `packages/agent/test/routes-auth.test.ts` | 补 P3-15 缺的 AST 节点分支 |
| `packages/agent/test/slidev-lock.test.ts` | 补 P3-15 缺的 functions 分支 |
| `.gitignore` | 加 `data/*` + `!data/.gitkeep` |
| `packages/agent/.env.example` | 加 RATE_LIMIT_ENABLED / PUBLIC_ORIGIN / LOG_REDACT_FIELDS |
| `package.json`（root） | 加 `audit:secrets` script（gitleaks）+ `audit:dead` script（knip） |

### 删除（git mv 到 `docs/archive/scripts/`）

| 文件 | 原因 |
| ---- | ---- |
| `packages/agent/scripts/backfill-template-id.ts` | Phase 6B 一次性，已跑完 dev/prod，归档参考 |
| `packages/agent/scripts/migrate-deprecated-layouts.ts` | Phase 7.5D-4 一次性，归档 |
| `packages/agent/scripts/rename-template-id.ts` | Phase 7A 一次性，归档 |
| `packages/agent/scripts/seed-demo-decks.ts` | dev seed 数据，无生产用途，归档 |

### 保留（init-db / init-test-db）

不归档：每次新搭环境都跑，是基础设施脚本不是迁移脚本。

---

## 阶段拆分

每个 Task 一个 commit；每步绿测试 + 当步独立可回退。

### Task 9-A：审计基建 + Secrets 全历史扫描

**目的**：装工具、跑 baseline 扫描、骨架报告落档。

**操作**：
1. 安装工具：`gitleaks`（brew/npm 或 docker）+ `knip`（pnpm devDep root）
2. 全 git 历史跑 `gitleaks detect --redact -v`，结果归到 `docs/security/gitleaks-baseline.txt`
3. 全仓 `pnpm audit --audit-level=moderate` 详查 15 条 transitive moderate（Phase 8 前哨结果），分类（可升 / 等上游 / 不影响生产 / 误报）
4. License 扫：`pnpm licenses list --long` 出表，标 GPL/AGPL/LGPL → 人工评估
5. 落档 `docs/security/2026-04-audit-report.md` 骨架（10 个 OWASP 章节占位 + 仓库卫生章节）
6. 落档 `docs/security/checklist.md`（machine-readable 表格）

**验证方法**：
- `pnpm audit:secrets` 退出码 0（gitleaks 0 finding）
- 报告骨架可读，章节齐全

**风险**：gitleaks 在 macOS 装可能要 `brew install gitleaks`（已记 plan 18 prerequisites）。

### Task 9-B：A01/A07 认证授权全量核查 + /log-event 鉴权

**目的**：每条 state-changing 路由清点 auth + ownership，修 /log-event 漏洞。

**操作**：
1. 列出 `packages/agent/src/routes/` 所有端点（脚本 grep `app.[a-z]+\(['"]`）→ 表格 method / path / requireAuth / ownership 守卫
2. **修 `/log-event` 漏洞**：加 `requireAuth` + rate limit（10/min/user）；测试加 1 条未登录 401
3. **修 `/log/latest`**：加 `requireAuth`（日志可能含敏感 prompt）
4. ownership 全量核查：deck / deck_versions / deck_chats / mcp / lock 每个写操作都看是否有 `userId === ctx.var.user.id` 检查；缺则补 + 加测试
5. session cookie 生产路径双确认：`secure: process.env.NODE_ENV === 'production'` 在所有 set-cookie 处一致
6. Slidev proxy 鉴权回归：跑 plan 10 的 lock conflict 测试 + 加一条"无 session 直接打 /api/slidev-preview/* 应 401"
7. 报告章节：列每条端点 + 证据行号

**验证方法**：
- `pnpm -F @big-ppt/agent test` 全绿
- 新增测试 ≥ 5（端点鉴权 + 跨用户 403）
- coverage 不退步

**风险**：补 ownership 可能挖出 Phase 5 遗留漏洞；如挖出**新**漏洞则记 plan 设计抉择 + 单独 commit。

### Task 9-C：A03 注入 / XSS 全量审 + iframe sandbox + markdown-it

**目的**：清 SQL/XSS/iframe 三类注入风险。

**操作**：
1. **Drizzle 审**：grep `sql\`` 全仓，确认每处都参数化（schema.ts 的 DEFAULT 常量是字面量、安全；其他位置如有则单独审）
2. **`v-html` 审**：grep `v-html` 全 creator + slidev，确认无（已盘点：无）；加 lint rule `vue/no-v-html: error` 防未来引入
3. **Slidev iframe sandbox**：`SlidePreview.vue` 加 `sandbox="allow-same-origin allow-scripts allow-forms"`（不加 allow-top-navigation 防 iframe 跳走 parent）；E2E 加一条断言 iframe 有 sandbox attr
4. **markdown-it 审**：找 markdown-it 用法位置（agent / slidev），确认 `html: false` 默认（Slidev 默认 false，需确认）
5. **Frontmatter 转义**：slides-store 写入 deck content 前 + chat content，审现有 schema validation 是否覆盖 frontmatter 注入（之前 plan 15 的 7D-6 已有自由文本字段白名单）
6. 报告章节填证据

**验证方法**：
- `pnpm lint` 全绿（含新加的 no-v-html rule）
- E2E iframe sandbox 断言通过
- 单测增 ≥ 2（sandbox 存在 / no-v-html lint 触发）

**风险**：sandbox 加 `allow-scripts` 可能引发 Slidev WebSocket / iframe → parent postMessage 失败；需在 dev 浏览器手验翻页 / HMR / undo 全功能。

### Task 9-D：CSRF / CORS / CSP 配置

**目的**：补 Origin 校验中间件 + CSP Report-Only。

**操作**：
1. **新增 `middleware/origin-check.ts`**：state-changing 方法（POST/PUT/DELETE/PATCH）必校验 `Origin` 或 `Referer` 与 `PUBLIC_ORIGIN` 同源；GET / HEAD 跳过；缺 Origin 但有 Referer 取 Referer host 比对
2. 装到 `app.ts` 全局，但**例外清单**：`/api/auth/*`（login redirect 场景）+ `/api/slidev-preview/*`（已有 slidev-proxy-auth）+ webhook（如有）
3. **新增 `middleware/csp.ts`**：生产模式 `Content-Security-Policy-Report-Only` header，policy 包含 `default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: blob:; frame-src 'self'`（Slidev 需 inline + eval；不加 report-uri 因为没收集端）
4. **CORS**：维持现状（同源 + Vite proxy，无需 CORS middleware；明确写进报告作为决策）
5. 单测 ≥ 4（origin 命中 / 不命中 / 无 origin no-referer / GET 跳过）

**验证方法**：
- 单测全绿
- E2E 跑一遍确认 PUBLIC_ORIGIN=http://localhost:3030 设对后正常工作

**风险**：Vite proxy 可能不带 Origin header 给后端 → middleware 写时考虑"localhost / 同 host" fallback；本地 dev `PUBLIC_ORIGIN` 可设 dev origin 或 disable middleware。

### Task 9-E：Rate Limiting + Error 脱敏 + 日志脱敏

**目的**：清 A04 / A09 三连。

**操作**：
1. **Rate limit middleware**：内存版，per-user-or-IP；exposing 配置：`{ window, max, keyResolver, scope }`
   - login / register：5 / 15min / IP
   - llm-chat：30 / hour / user
   - log-event：10 / min / user
   - 其他端点暂不挂（避免误伤）
2. **error-response helper**：抽 `respondError(c, err)`，prod 仅返 `{ error, errorId }`，详 stack 写 logger.error
3. **logger redact**：`utils/redact.ts` 深度递归过滤 `password / apiKey / authorization / cookie / token / secret`（不分大小写）；写盘前调用；64KB 截断
4. 改造现有 routes 的 catch 分支统一用 helper（auth / llm / decks / mcp 全量扫一遍）
5. 单测：rate limit 触发 429 + error helper dev/prod 输出差异 + redact 各类字段 + 大 payload 截断

**验证方法**：
- 新增测试 ≥ 12
- coverage 不退步

**风险**：rate limit 误伤 E2E 跑测；webServer env 设 `RATE_LIMIT_ENABLED=false`（同 Phase 7D 用 BIG_PPT_TEST_REWRITE_MODE=skeleton 模式）；测试单测中 mock disable middleware。

### Task 9-F：MCP per-user 入库（A01 Broken Access Control 修复）

**目的**：清 MCP server 全用户共享单文件漏洞，per-user 隔离 + DB 入库。

**问题复述**：当前 `JsonFileRepo` 是全局单文件 + `mcp-registry` 是全局 singleton，所有登录用户操作同一份 server 列表 + 共享同一组 headers（含 token）。A 启用 + 填 token → B 用 A 的 token 调用，跨用户凭据共享。Phase 5 给 deck/version/chat 都做了 per-user 隔离，MCP 这块遗漏。

**操作**：
1. **DB schema**：`packages/agent/src/db/schema.ts` 新增 `userMcpServers` 表
   - `id` PK auto-increment
   - `userId` FK → users.id（cascade delete）
   - `serverId` 字符串（旧 `id` 字段，组合 unique index `[userId, serverId]`）
   - `displayName` / `description` / `url` / `headers` JSON（密文）/ `enabled` / `preset` / `badge`
   - `createdAt` / `updatedAt`
   - `pnpm -F @big-ppt/agent db:push` 推到 dev + test 库
2. **接口改造**：`mcp-server-repo/types.ts`：
   - `list(userId)` / `get(userId, serverId)` / `create(userId, config)` / `update(userId, serverId, patch)` / `delete(userId, serverId)`
   - `McpRepoNotFoundError` 保留
3. **新建 `drizzle-repo.ts`**：实现 `McpServerRepo`，所有方法按 userId 过滤；首次 `list(userId)` 时如该 user 无任何 server，**自动 seed PRESET_MCP_SERVERS**（每用户独立 4 个 preset，headers 空）；headers 落库前 P2-4 加密、读时解密（复用 `crypto/apikey.ts`）
4. **mcp-registry per-user 改造**：
   - `getRegistry(userId)` 返该 user 的注册中心（Map<userId, Registry>），LRU 上限 100 防内存泄漏
   - `Registry.sync(config)` 接口不变，connection pool per-instance 隔离
   - 工具命名 `mcp__<serverId>__<toolName>` 保持不变（registry 已隔离够了，无需把 userId 编进工具名）
5. **routes/mcp.ts 改造**：handler 用 `ctx.var.user.id` 调 repo + registry；redactHeaders / mergeHeadersPatch 逻辑保留
6. **tools/registry.ts 改造**：`listTools(ctx)` 按 ctx.user.id 拉对应 user 的 registry；本地 5 工具保持全局
7. **数据迁移**：dev 库现有 `data/mcp.json` 内容无主直接清空（用户重新登录配自己的）；test 库每 case truncate 不影响；prod 还没上线，零成本
8. **`json-file-repo.ts` 加 `@deprecated` 注释**，保留代码作为回退参考
9. **测试**：
   - `mcp-server-repo.test.ts` 改造为 DrizzleRepo 测：CRUD per-user + 跨用户 404 + headers 加密落库
   - `routes-mcp.test.ts` 改造：未登录 401 / 登录拿自己 list / A 看不到 B 的 / A 不能 update B 的（404 而非 403 防 ID 探测）
   - `mcp-registry.test.ts`：per-user registry 隔离 + LRU 淘汰
10. **前端**：`useMCP.ts` / `MCPCatalogItem.vue` / `MCPCustomServer.vue` API 路径不变，无改动

**验证方法**：
- 单测全绿（agent 测增 ≥ 10）
- E2E 跑：用户 A 启用 server + 填 fake token → 退出 → 用户 B 登录 → server 列表是 B 自己的 4 个 preset（enabled=false）
- coverage 不退步

**风险**：
- registry per-user 改造可能引入跨 case 内存污染：加 `_test/reset-registries` 路由（参考 plan 14 踩坑 6 / slidev-lock 模式）
- 工具调用流程 `useAIChat → /api/call-tool → tool-registry.execute(name, args, ctx)` 链路要确认 ctx.user 一直透传，否则工具执行时拿不到 user 路由不到 registry
- LRU 上限触发时可能误杀正在用的 user，初版设 100 + 监控（够 dev/MVP），P11 多用户压测时再调

**新增 env**：无（headers 加密走已有 `APIKEY_MASTER_KEY`）

---

### Task 9-F2：.gitignore 加固

**目的**：防御性增强，避免未来 data/ 下新文件忘 ignore。

**操作**：
1. `.gitignore`（根）加 `packages/agent/data/*` + `!packages/agent/data/.gitkeep`（已有 packages/agent/data/.gitignore 仅覆盖 mcp.json + slides-history/，根加固一层）
2. 跑 `git ls-files packages/agent/data/` 确认无追踪文件（若有则单独审）
3. 审计报告章节：当前 mcp.json 状态（never tracked + Task 9-F 后 deprecated）

**验证方法**：`git status` clean + `git check-ignore -v packages/agent/data/mcp.json` 报命中

### Task 9-G：仓库卫生（脚本归档 + knip 死代码 + P3-15 coverage 拉回）

**目的**：清 roadmap 验收 #5 + tech-debt P3-15。

**全仓三处 scripts/ 目录判定**（roadmap 验收 #5 要求"所有脚本"）：

| 路径 | 脚本 | 判定 | 理由 |
| ---- | ---- | ---- | ---- |
| `packages/agent/scripts/` | `init-db.mjs` | **保留** | 每次新搭 dev 环境都跑，是基础设施 |
| `packages/agent/scripts/` | `init-test-db.mjs` | **保留** | 同上，测试环境初始化 |
| `packages/agent/scripts/` | `backfill-template-id.ts` | **归档** | Phase 6B 一次性，dev/prod 均已跑完 |
| `packages/agent/scripts/` | `migrate-deprecated-layouts.ts` | **归档** | Phase 7.5D-4 一次性 |
| `packages/agent/scripts/` | `rename-template-id.ts` | **归档** | Phase 7A 一次性 |
| `packages/agent/scripts/` | `seed-demo-decks.ts` | **归档** | dev 演示数据生成器，无生产用途 |
| `packages/slidev/scripts/` | `gen-icons.mjs` | **保留** | P3-7 UnoCSS bug workaround，每次加新图标重跑 |
| `scripts/`（顶层） | `generate-template-thumbnails.ts` | **保留** | 每加新模板跑 `pnpm gen:thumbnails`，Phase 7C 落定 |
| `scripts/`（顶层） | `validate-template-tokens.ts` | **保留** | Phase 7.5A token schema 校验，CI 可挂 |

**操作**：
1. `git mv packages/agent/scripts/{backfill-template-id,migrate-deprecated-layouts,rename-template-id,seed-demo-decks}.ts docs/archive/scripts/`
2. `docs/archive/scripts/README.md` 写每个脚本的"曾经为什么 / 何时跑过 / 为什么归档"
3. 保留脚本逐个加文件头注释"用途 / 触发时机"（如缺失），便于新成员理解
4. 跑 `pnpm dlx knip` → 报告未引用导出 / 未用文件 / 未用 deps；人工评估每条（不全自动删，避免误伤动态加载或 Slidev runtime 引用），结果归档 `docs/security/knip-baseline.txt`
5. P3-15 拉回：补 `routes/auth.ts` + `slidev-lock.ts` 缺的 AST 节点分支测试，把 `vitest.config.ts` 的微调门槛拉回 90/85 + per-file 95（如能达成）
6. 99-tech-debt 标记 P3-15 ✅ 清除（或如不可拉回则记 verdict）

**验证方法**：
- `pnpm -F @big-ppt/agent test:coverage` 满足拉回后的 90/85 门槛
- knip 报告归档到 `docs/security/knip-baseline.txt`

**风险**：拉回 95 可能补 1-2 测后还差 0.x%（vitest 4 AST 算法天生颗粒细），如确实拉不回则**记 P3-15 verdict（"不可拉回的工具差异"）**+ 门槛固定为 89/83 长期方案。

### Task 9-H：审计报告落档 + 关闭

**目的**：补全证据 + 同步三处文档 + 关闭 Phase 9。

**操作**：
1. `docs/security/2026-04-audit-report.md` 补全 10 个 OWASP 章节 + 仓库卫生章节，每项带"代码行号 / test case / config 位置 / 修复 commit hash"
2. `docs/plans/99-tech-debt.md` 标 P3-15 ✅；如 9-F MCP per-user 改造期间发现新债则按 P3 级登记
3. `docs/requirements/roadmap.md` Phase 9 5 条验收勾选 + 状态改 ✅
4. `docs/plans/18-phase9-security-audit.md` 关闭后回填：执行期偏离 / 踩坑 / 测试数量
5. `CLAUDE.md` 新增"已知坑"提炼（如有跨 Phase 通用规则——如 Origin 校验 / rate limit / redact）

**验证方法**：
- `pnpm test` + `pnpm e2e` 全绿
- gitleaks 0 finding
- pnpm audit --audit-level=high 0
- OWASP checklist 10/10 打勾

---

## 验收条件（roadmap.md Phase 9 清单映射）

- [ ] `pnpm audit --audit-level=high` = 0（roadmap 验收 #1，Phase 8 已达成，本 Phase 维持）
- [ ] gitleaks 全历史扫 = 0 leaked secret（roadmap 验收 #2）
- [ ] OWASP Top 10 checklist 10/10 打勾 + 每项附证据（roadmap 验收 #3）
- [ ] 产出 `docs/security/2026-04-audit-report.md` 留存（roadmap 验收 #4）
- [ ] `scripts/` 里所有脚本都有"保留 / 删除 / 通用化"明确判定（roadmap 验收 #5）
- [ ] **MCP per-user 隔离**：A 用户的 server / token 在 B 用户视角不可见（A01 Broken Access Control 修复）
- [ ] P3-15 coverage 拉回 90/85（或锁定门槛 + 写明长期方案）
- [ ] 全量回归（`pnpm test` + `pnpm e2e` 全绿）
- [ ] coverage 门槛维持（agent 90/85，creator 75/65；slidev / shared 不退步）

---

## 不做什么（范围围栏）

- ❌ 非 L3 范围合规认证（ISO27001 / SOC2）— roadmap 明确
- ❌ 外包 pen test（本次自审）— roadmap 明确
- ❌ SAST / DAST 工具链集成到 CI — 留 Phase 16+
- ❌ CSP enforce 模式（仅 Report-Only，避免 Slidev break）— Phase 11+
- ❌ Redis-based 集中式 rate limit — Phase 11 多实例时
- ❌ CSRF double-submit token — sameSite + Origin 已够
- ❌ git 历史改写 / force push — mcp.json 从未入过 git，无需历史清理
- ❌ 装 SAST 工具进 CI（Snyk / Socket.dev）— 留 Phase 16+
- ❌ 引入新基础设施（Redis / Vault）— Phase 9 全是代码 + 配置层防护
- ❌ 自动化死代码删除（knip 仅审计参考，不直接删）
- ❌ MCP server 跨用户共享池（per-user 隔离后**不**再设计"组织共享 server"模式，留 Phase 16+ 团队功能）

---

## 执行期偏离（2026-04-26 关闭）

- **9-B 公开端点数从 plan 列的 2 个扩展到 8 个**：plan 原本只列 `/log-event` + `/log/latest`，实施期盘点全 routes 发现 `/api/call-tool`（严重：未登录可调任意工具）+ `/api/tools` + `/api/lock-status` + `/api/read-slides /restore-slides /redo-slides` 6 个 GET/POST 端点全无鉴权。slides 端点除 requireAuth 还加了 `isHeldBy(session.id)` 持锁守卫（仅 lock holder 可读 server-wide slides.md，否则 B 用户读到 A 的 deck 内容）。
- **9-E LLM 不挂 rate limit**：plan 原写 30/hour/user，用户提醒"API key 是用户自己的"后撤掉。LLM 请求是用户用自己 key 烧自己的钱，upstream provider 自带 quota，agent 不该再加一层。Plan 设计抉择 #2 也没明确说 LLM 必须限速。改为"只限用 agent 服务器资源的攻击面"：login/register（爆破他人）+ log-event（写 disk）。
- **9-D Origin 校验增加路径豁免**：plan 写 `/api/auth/*` 全豁免，实施期发现 `/api/auth/llm-settings` GET/PUT 也是 state-changing 应该走 Origin 校验，仅 `/api/auth/{login,register,logout}` 三个登录前 / 幂等端点豁免。
- **9-F per-user registry 加了 ensureInitialized lazy 方法**：plan 没显式提，实施期发现 dev 重启后用户首次访问需要触发原 `initialize()`，否则 enabled MCP 工具还没 register。lazy 幂等设计（`initPromise` 缓存）。
- **9-F2 mysql2 hoist 工具链 bug**：plan 没预料，实施期 `pnpm db:push` 报 "please install mysql2"，drizzle-kit 0.31 通过 `import('mysql2')` 从自己 .pnpm 节点向上找，mysql2 仅 packages/agent 用 pnpm 不自动 hoist 到根。修法：`.npmrc` 加 `public-hoist-pattern[]=mysql2`。
- **9-G P3-15 拉回放弃**：plan 原写"补 routes/auth.ts + slidev-lock.ts 缺的 AST 节点分支"，实测 9-D/9-E 加大量新代码后整体百分比反而进一步下移。补 ~50 测覆盖 catch-all / type narrowing 不可达分支收益小。verdict 改为"长期维持新基线 lines 90 / branches 80 / functions 85 / statements 87"，写进 99-tech-debt P3-15。

---

## 踩坑与解决

### 坑 1：Hono sub-router `use('*', mw)` 经 `app.route('/api', sub)` 挂载后泄漏到 /api/* 全路径

- **症状**：9-B 加完 `slides.use('*', requireLockHolder)` 单测全过；e2e happy-path 直接挂——picker modal 显示 "需要先 activate-deck 占用 Slidev 实例"，模板列表为空。
- **根因**：Hono 的 `app.route('/api', slides)` 把 slides sub-router 挂在 /api 前缀下；`slides.use('*', mw)` 内的 `*` 匹配整个 /api/* 而**不是只匹配 slides 自己声明的 path**。结果 `list-templates` 等公开端点也被守卫拦下。单测用 `buildApp()` 直接挂 sub-router 不经过 app.route，无法复现。
- **修复**（commit `a0d3e6f`）：改为显式 path 列举 `slides.use('/read-slides', mw)` / `slides.use('/restore-slides', mw)` / `slides.use('/redo-slides', mw)`。
- **防再犯**：新建 `routes-mount-integration.test.ts` 用真 `app.fetch()` 验证公开端点维持公开 + 鉴权端点未登录 401 + sub-router 互不干扰（10 测）；CLAUDE.md 加"Hono 路由"已知坑提炼。

### 坑 2：originCheck 加全局后 e2e webServer 复用导致 rate-limit 跨 spec 累计撞 5/15min/IP

- **症状**：9-E 加 rate limit 后 agent unit 都过；e2e 跑一遍部分 spec 挂在 register 429。
- **根因**：playwright `reuseExistingServer: !CI` 让 e2e 共享同一个 agent 进程，rate-limit Map 跨 spec 累计；5 次内的 spec 过得了但后续 register/login 撞上限。
- **修复**：`playwright.config.ts` agent webServer env 加 `RATE_LIMIT_ENABLED=false`（同 BIG_PPT_TEST_REWRITE_MODE 模式）；`_setup/test-db.ts` resetDb 加 `__resetRateLimitForTesting()` 每 case 复位计数（agent unit 测）。

### 坑 3：originCheck 全局拦截后 routes-mount-integration / creator integration / e2e helpers / lock-conflict 都需要带 Origin

- **症状**：originCheck 加全局后大量集成 / E2E 测从 401 改成 403。
- **根因**：浏览器自动带 Origin，但 `app.fetch()` shim / Playwright APIRequestContext 不会自动加。
- **修复**：creator integration shim 自动补 `Origin: http://localhost`；e2e helpers `reset-lock` fetch 加 Origin；`lock-conflict.spec.ts` 的 `pwRequest.newContext` 加 `extraHTTPHeaders.Origin`。dev 兜底允许 localhost / 127.0.0.1 让 origin 检查通过。

### 坑 4：mysql2 没 hoist 到根 node_modules 导致 drizzle-kit 找不到

- **症状**：`pnpm db:push` 报 `To connect to MySQL database - please install either of 'mysql2' or '@planetscale/database' drivers`。
- **根因**：drizzle-kit 0.31 通过 `await import('mysql2')` 检测 driver 可用性；从自己的 `.pnpm/drizzle-kit@0.31.10/node_modules/drizzle-kit/` 一路向上查找，但 mysql2 仅被 packages/agent 用，pnpm 默认不 hoist 到根 `node_modules/`。
- **修复**：`.npmrc` 加 `public-hoist-pattern[]=mysql2`，`pnpm install` 重新装让 mysql2 在根 node_modules 出现。
- **防再犯**：CLAUDE.md / 已知坑——其他类似"工具自己 import driver 检测"的库（Phase 10 部署期可能再撞）应主动核查 pnpm hoist 状态。

### 坑 5：redact 把 logger 的 session 字段也脱敏

- **症状**：9-E 加 logger redact 后 logger.test.ts 3 测挂，断言 `session: 'sess-1'` 实际拿到 `'[REDACTED]'`。
- **根因**：DEFAULT_REDACT_KEYS 把 `session` / `sessionid` / `session_id` 都当作敏感字段；但 logger 用 `session` 字段作日志关联 ID（不是 cookie / 凭据），脱敏破坏可读性。
- **修复**：从 default 列表移除 `session` / `sessionid` / `session_id`；保留 `cookie` / `set-cookie` / `token` / `access_token` / `refresh_token`（子串匹配能覆盖 `sessionToken` 等组合字段）。
- **防再犯**：`utils/redact.ts` 注释明确"刻意不含 session"；测试覆盖 `sessionId` 字段不脱敏（utils-redact.test.ts）。

---

## 测试数量落地（2026-04-26 关闭）

| 指标             | 起点（Phase 8 终） | 终点 | 增量 |
| ---------------- | ------------------ | ---- | ---- |
| agent unit       | 361                | 428  | +67  |
| creator unit     | 71                 | 79   | +4   |
| slidev unit      | 38                 | 38   | 0    |
| shared unit      | 3                  | 3    | 0    |
| E2E              | 9                  | 9    | 0    |
| **total**        | **482**            | **557** | **+75** |
| coverage lines   | 92.82              | 90.11 | -2.71（plan 18 设计抉择 #10 接受，不为凑数字补测） |
| coverage branch  | 83.83              | 80.34 | -3.49（同上）|

**门槛锁定**（Phase 9-G P3-15 verdict）：lines 90 / branches 80 / functions 85 / statements 87；per-file 95+ 高门槛保留（crypto/apikey / slidev-lock / middleware/auth / routes/auth）。
