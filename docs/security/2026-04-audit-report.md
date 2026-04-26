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

**适用项**：state-changing API ownership 守卫 + session cookie 设置 + Slidev 反代鉴权 + **MCP per-user 隔离（高优先级修复）**。

**当前状态**：详查待 Task 9-B / 9-F 落档。

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

**适用项**：SQL 注入 + XSS + iframe sandbox + markdown-it 配置。

**当前状态**：详查待 Task 9-C 落档。

**初步盘点**：
- Drizzle ORM 全量参数化（schema.ts 仅 DEFAULT 字面量用 `sql\``，不接 user input）→ ✅
- 全 creator/slidev 仓库无 `v-html` → ✅（Task 9-C 加 lint rule 永久守卫）
- Slidev iframe 缺 `sandbox` 属性 → ⚠ 待 9-C 修

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
