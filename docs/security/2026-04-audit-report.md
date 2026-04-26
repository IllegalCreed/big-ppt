# Lumideck Phase 9 安全 Audit L3 报告

> **审计时点**：2026-04-26（Phase 8 关闭后立刻开始）
> **审计范围**：OWASP Top 10 2021 全量 + 仓库卫生 + License 合规
> **审计形式**：自审 + 静态扫描工具（gitleaks / pnpm audit / knip）
> **plan 依据**：[plan 18 Phase 9](../plans/18-phase9-security-audit.md)
> **基线产物**：
> - `docs/security/gitleaks-baseline.json`（首次 0 leak，加 .gitleaks.toml allowlist 后稳定）
> - `docs/security/pnpm-audit-baseline.json`（0 high / 15 moderate transitive）
> - `docs/security/knip-baseline.txt`（待 9-G 落档）

**总体结论**（待 Phase 9 全部 task 完成后回填）：

- [ ] OWASP Top 10：10/10 ✅
- [ ] gitleaks 全历史扫：0 finding（已达，2026-04-26）
- [ ] pnpm audit --audit-level=high：0 finding（已达，Phase 8 + 本次复核）
- [ ] License 合规：无 GPL/AGPL 直接依赖（已达，2026-04-26）
- [ ] 仓库卫生：所有 scripts 有"保留 / 归档"判定（待 9-G）
- [ ] **MCP per-user 隔离**：A01 修复完成（待 9-F）

---

## 0. 审计基建（Task 9-A 落档）

### 0.1 工具版本

| 工具 | 版本 | 用途 |
| ---- | ---- | ---- |
| gitleaks | 8.30.1 | 全 git 历史扫 secret |
| pnpm audit | pnpm 10.x 内置 | 依赖漏洞扫 |
| pnpm licenses list | pnpm 10.x 内置 | 依赖 license 扫 |
| knip | 6.7.0 | 死代码扫描（待 9-G） |

### 0.2 gitleaks 配置

[`.gitleaks.toml`](../../.gitleaks.toml) — extend 默认规则 + 加 `.env.*.example` 路径白名单 + `REPLACE_ME*` / `your-api-key` / `placeholder` 占位符正则白名单。

**首次扫描**：scanned 154 commits / ~2.78 MB / 483ms / **2 finding**（均为 `.env.production.example` 的 `SESSION_SECRET=REPLACE_ME_PROD_32_BYTES_HEX` / `APIKEY_MASTER_KEY=REPLACE_ME_PROD_32_BYTES_HEX` 占位符误报）。

**加 allowlist 后**：**0 finding**。

```bash
gitleaks detect --config .gitleaks.toml --redact -v --no-banner --report-format json --report-path docs/security/gitleaks-baseline.json
```

### 0.3 License 扫描

`pnpm licenses list --long` 全表输出 1280 个依赖。

**过滤 GPL/AGPL/LGPL/copyleft**：

| Package | License | 评估 |
| ------- | ------- | ---- |
| `jszip` | `MIT OR GPL-3.0-or-later` | ✅ Dual license，可选 MIT 用，无 GPL 传染风险 |

**结论**：无纯 GPL/AGPL/LGPL 直接依赖。`dompurify` 是 `MPL-2.0 OR Apache-2.0`（弱 copyleft，仅约束 dompurify 自身改动）+ `pako` 是 `MIT AND Zlib`（双 permissive）— 均无传染。

---

## 1. OWASP A01 Broken Access Control

**适用项**：state-changing API ownership 守卫 + session cookie 设置 + Slidev 反代鉴权 + **MCP per-user 隔离**。

### 1.1 路由鉴权全量盘点（Task 9-B 落档，2026-04-26）

**修复前漏洞清单**（Explore 期 + 9-B 复审发现的 11 个公开端点）：

| 路径 | 修复前 | 风险 | 修复 |
| ---- | ------ | ---- | ---- |
| `POST /api/log-event` | 无鉴权 | 任意人灌日志 / 探内部错误 | 加 `requireAuth`（routes/log.ts） |
| `GET /api/log/latest` | 无鉴权 | 任意人读日志（含 user prompt + LLM response） | 加 `requireAuth` |
| `GET /api/tools` | 无鉴权 | 工具命名空间枚举（暴露 mcp__\* 内部 server id） | 加 `requireAuth`（routes/tools.ts） |
| `POST /api/call-tool` | 无鉴权 | **严重**：未登录可调 write_slides/delete_slide/mcp__\* 等敏感工具 | 加 `requireAuth` |
| `POST /api/read-slides` × 2（GET/POST） | 无鉴权 | 任意人读 lock holder 的 slides.md（跨用户泄漏 deck 内容） | 加 `requireAuth` + 持锁守卫（routes/slides.ts） |
| `POST /api/restore-slides` × 2 | 无鉴权 | 任意人触发 lock holder 的 /undo | 同上 |
| `POST /api/redo-slides` × 2 | 无鉴权 | 任意人触发 lock holder 的 /redo | 同上 |
| `GET /api/lock-status` | 无鉴权 | holder.email 枚举（推测平台用户邮箱） | 加 `requireAuth`（routes/lock.ts） |

**已合规端点**（盘点期确认）：

- `/api/decks/*` 全量：`requireAuth` + `getOwnedDeck()` ownership 校验（routes/decks.ts:37-42）
- `/api/auth/llm-settings` GET/PUT：`requireAuth` 自证 + 仅返本人数据
- `/api/llm/chat/completions`：`requireAuth` 自证（routes/llm.ts:55-57）
- `/api/mcp/servers*`：`requireAuth` 完整（但跨用户共享数据，详见 1.2）
- `/api/activate-deck/:id` `/api/release-deck` `/api/heartbeat`：`requireAuth` + ownership

**公开端点合理性**（评估保留）：

- `/api/auth/register` `/api/auth/login`：登录前必须公开
- `/api/auth/logout`：幂等，未登录无副作用
- `/api/templates/*` `/api/system-prompt`：项目内置资源 / prompt 模板，无敏感信息
- `/healthz` `/`：服务标识，生产绑内网

**slides.ts 持锁守卫**：用户 A 持锁编辑时，slides.md 是 server-wide mirror。修复后 user B（即使登录）无法读 / undo / redo —— B 的视角应在 OccupiedWaitingPage。

**新增测试**（Task 9-B）：
- `routes-tools.test.ts`：6 测改造为带 cookie 集成测 + 新增 2 条未登录 401（GET /tools / POST /call-tool）
- `routes-log.test.ts`（新建）：3 测（POST/GET 未登录 401 / 登录 200）
- `routes-slides.test.ts`（新建）：6 测（未登录 401 × 2 / 登录未持锁 403 / 登录持别人锁 403 / 登录持锁 200 × 3）
- `routes-lock.test.ts`：+1 测 lock-status 未登录 401

### 1.2 MCP server per-user 隔离（待 Task 9-F）

**关键发现（Phase 9 Explore 期）**：MCP server 当前是全用户共享单文件 + singleton registry → 跨用户凭据共享 → 严重 A01 漏洞。修复方案见 [plan 18 Task 9-F](../plans/18-phase9-security-audit.md#task-9-fmcp-per-user-入库a01-broken-access-control-修复)。

---

## 2. OWASP A02 Cryptographic Failures

**适用项**：APIKEY_MASTER_KEY 加密强度 + session cookie secure 标志 + bcrypt 哈希 + AES-256-GCM。

**当前状态**：
- `packages/agent/src/crypto/apikey.ts` — AES-256-GCM，master key 32 字节 hex 从 env 读 → ✅ 业界标准
- 密码哈希：bcrypt rounds=10（auth.ts:13）→ ✅ Phase 5 落定
- session cookie：`httpOnly + secure(prod) + sameSite=lax` → ✅（auth.ts:23-31）
- DB connection：dev 走明文 mysql://；生产部署需 TLS，写入 Phase 10 runbook（待）

**结论**：✅ 无 A02 漏洞。

---

## 3. OWASP A03 Injection

### 3.1 SQL 注入 ✅

**核查路径**：`grep -rn 'sql\`' packages/agent/src` → 仅 `db/schema.ts:22-23` 两处：
```ts
const NOW = sql`CURRENT_TIMESTAMP`
const NOW_ON_UPDATE = sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
```
都是 DEFAULT 子句字面量常量，不接 user input。其余全走 Drizzle ORM 参数化查询。**无 SQL 注入风险**。

### 3.2 XSS（v-html / innerHTML）✅

**核查路径**：`grep -rn 'v-html\|innerHTML' packages/creator packages/slidev` → 0 命中。

**永久守卫**：在 [`packages/creator/eslint.config.ts`](../../packages/creator/eslint.config.ts) 加 `'vue/no-v-html': 'error'`，未来引入会 lint fail。

### 3.3 Slidev iframe sandbox ✅

**修复**：[`packages/creator/src/components/SlidePreview.vue`](../../packages/creator/src/components/SlidePreview.vue:113-126) iframe 加 `sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"`。

**token 选择 Why**：
- `allow-same-origin`：保留 contentWindow.location.hash 翻页（同源 iframe）
- `allow-scripts`：Slidev / Vite HMR / iframe 内 Vue 必需
- `allow-forms`：Slidev 内 form 元素（presenter 设置面板）
- `allow-popups + allow-popups-to-escape-sandbox`：presenter 全屏 window.open 需要
- **不加** `allow-top-navigation`：防 iframe 跳走 parent

**测试守卫**：[`packages/creator/test/SlidePreview.security.spec.ts`](../../packages/creator/test/SlidePreview.security.spec.ts) 4 测断言 sandbox 属性 + token 包含规则 + 不含 allow-top-navigation。

### 3.4 markdown-it ✅

项目自身无显式 markdown-it 调用；Slidev 内置使用，默认 `html: false`（不解析 HTML 片段）。`buildSystemPrompt.ts:174` 仅在注释里提到 markdown-it 行为，不接收 user input。

### 3.5 关键 bug 修复（9-B 联动）

**Hono sub-router wildcard middleware 泄漏**：9-B 一开始把 slides.ts 持锁守卫写成 `slides.use('*', mw)`，通过 `app.route('/api', slides)` 挂载后 `*` 拦截 /api/* 全部路径，e2e happy-path 直接挂在 picker modal（"需要先 activate-deck"）。

**修复**：改为显式 path 列举（`slides.use('/read-slides', mw)` / `slides.use('/restore-slides', mw)` / `slides.use('/redo-slides', mw)`）。

**防再犯**：新建 [`packages/agent/test/routes-mount-integration.test.ts`](../../packages/agent/test/routes-mount-integration.test.ts)（10 测）—— 用真 `app` 实例 fetch 验证公开端点维持公开 + 鉴权端点未登录 401 + 各 sub-router 互不干扰。这种 wildcard 泄漏无法在 sub-router 单测里复现，必须用真 app mount。

**已提炼到 CLAUDE.md "Hono 路由"已知坑**。

---

## 4. OWASP A04 Insecure Design

**适用项**：rate limit + 登录暴力破解防护 + 资源耗尽。

**当前状态**：全栈 0 rate limit → ⚠ 待 Task 9-E 实施（自撸 LRU + token bucket，per-IP/user）。

---

## 5. OWASP A05 Security Misconfiguration

**适用项**：CORS / CSP / 错误消息泄漏 / 默认凭据。

**当前状态**：详查待 Task 9-D / 9-E 落档。

**已知缺口**：
- 无显式 CSP 策略 → 9-D 加 Report-Only
- 无 CORS allowlist → 9-D 评估（同源 + Vite proxy 是否要 CORS middleware）
- 错误消息可能泄漏 stack trace → 9-E `errorResponse(err, isProd)` helper

---

## 6. OWASP A06 Vulnerable Components

**当前状态（pnpm audit 2026-04-26）**：

```
info: 0 / low: 0 / moderate: 15 / high: 0 / critical: 0
```

**moderate 漏洞画像**（11 unique advisory，metadata dedupe 算 15）：

| 包 | 漏洞数 | 引入路径 | 攻击面 | 处置 |
| -- | ------ | -------- | ------ | ---- |
| `dompurify` | 8 | Slidev cli > monaco-editor / mermaid > @antdv-next/x | mermaid 渲染用户 deck markdown；attacker 须先获得 deck 写权限 | 等上游 monaco-editor / mermaid 升 dompurify@3.4.0；Phase 11/14 复检 |
| `uuid` | 1 | mermaid > uuid（v3/v5/v6 buffer bounds check）| 同上 | 等 mermaid 升 |
| `esbuild` | 1 | drizzle-kit > @esbuild-kit | dev only（迁移期），不在生产路径 | 接受 |
| `postcss` | 1 | vite-plugin-vue-devtools > ... > postcss | dev only | 接受 |

**结论**：直接依赖 0 漏洞；transitive 全在受控攻击面（user deck content 已 per-user 隔离 + dev-only 工具链）。Phase 11 / 14 节点复检。

---

## 7. OWASP A07 Identification & Authentication Failures

**适用项**：session 过期 / 续期 + 密码强度 + 暴力破解防护。

**当前状态**：详查待 Task 9-B / 9-E。

**已知**：
- session TTL 30 天（auth.ts:13 SESSION_TTL_MS）→ 评估是否过长
- bcrypt rounds=10 → ✅
- 登录无 rate limit → 9-E 加（5 / 15min / IP）

---

## 8. OWASP A08 Software & Data Integrity Failures

**适用项**：依赖签名 / 包完整性 / 反序列化。

**当前状态**：
- pnpm `lockfile` 锁版本 + `verify-store-integrity=true`（pnpm 默认）→ ✅
- 无反序列化 user input 的代码路径（agent 接收 JSON 走标准 Hono parser，类型检查由路由 schema 把关）→ ✅

**结论**：✅ 无 A08 漏洞。

---

## 9. OWASP A09 Security Logging & Monitoring Failures

**当前状态**：详查待 Task 9-E。

**已知缺口**：
- Logger 透传整个 payload（`packages/agent/src/logger/index.ts:32-57` `handleLogEvent`），未过滤 password / apiKey / Authorization 字段 → ⚠ 待 9-E 加 redact
- 单条 payload 无大小限制 → 9-E 加 64KB 截断
- `/log-event` 无鉴权 → 9-B 加 requireAuth + 9-E rate limit

---

## 10. OWASP A10 Server-Side Request Forgery

**适用项**：用户可控 URL 是否可触发后端代发 HTTP。

**当前状态**：
- LLM 代理：API Key 后端化 + URL 由后端配置（不接受客户端覆盖）→ ✅
- MCP server：URL 由 user 配置但**仅自己用**（per-user 隔离后），且 MCP 调用走 ctx.user.id，无跨用户 SSRF；transport 经 SDK 库不直发任意 URL → ✅
- Slidev iframe `src` 由后端拼接，user 无法控 → ✅

**结论**：✅ 无 A10 漏洞。

---

## 11. 仓库卫生（roadmap 验收 #5）

**当前状态**：详查待 Task 9-G 落档。

**预判定**（详 Task 9-G 表）：4 个一次性脚本归档到 `docs/archive/scripts/`；2 个 init 脚本保留；`gen-icons.mjs` / `gen:thumbnails` / `validate-template-tokens.ts` 保留。

**knip 死代码**：待 9-G 跑 + 评估。

---

## 12. 修复 Verdict 汇总（Phase 9 关闭后回填）

| 章节 | 修复 commit | 测试覆盖 | verdict |
| ---- | ----------- | -------- | ------- |
| A01 ownership 核查 | TBD | TBD | TBD |
| A01 MCP per-user | TBD | TBD | TBD |
| A03 iframe sandbox | TBD | TBD | TBD |
| A03 v-html lint rule | TBD | TBD | TBD |
| A04 rate limit | TBD | TBD | TBD |
| A05 CSP report-only | TBD | TBD | TBD |
| A05 Origin 校验 | TBD | TBD | TBD |
| A05 error 脱敏 | TBD | TBD | TBD |
| A09 log redact | TBD | TBD | TBD |
| 仓库卫生脚本归档 | TBD | TBD | TBD |
| P3-15 coverage 拉回 | TBD | TBD | TBD |

---

**审计签字**：待 Phase 9 关闭时回填。
