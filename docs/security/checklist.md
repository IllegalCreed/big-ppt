# Phase 9 安全 Audit Checklist

> machine-readable 表格，机器可解析。详细证据见 [`2026-04-audit-report.md`](./2026-04-audit-report.md)。
> 状态：`✅` 已通过 / `⚠` 待修 / `❌` 未通过 / `–` 不适用 / `TBD` 待审

| 编号 | 项 | 状态 | Task | 证据 / commit |
| --- | --- | --- | --- | --- |
| 0.1 | 工具就绪（gitleaks / knip） | ✅ | 9-A | gitleaks 8.30.1 / knip 6.7.0 |
| 0.2 | gitleaks 全历史扫 0 leak | ✅ | 9-A | `docs/security/gitleaks-baseline.json`（154 commits / 0 finding） |
| 0.3 | License 无 GPL/AGPL 直接依赖 | ✅ | 9-A | jszip 是 dual MIT OR GPL，可选 MIT；无纯 GPL |
| A01.1 | state-changing API 全挂 requireAuth | ✅ | 9-B | log/tools/slides/lock-status 8 个公开端点已加（commit TBD） |
| A01.2 | deck/version/chat ownership 守卫完整 | ✅ | 9-B | `getOwnedDeck()` decks.ts:37-42；盘点全量已确认 |
| A01.3 | Slidev proxy 鉴权回归 | ✅ | 9-B | `slidev-proxy-auth.ts` 完整（HTTP + WS upgrade） |
| A01.4 | **MCP server per-user 隔离** | ✅ | 9-F | DrizzleRepo + per-user registry/tool 分区；3 条跨用户隔离测；headers 加密落 DB |
| A01.5 | slides 持锁守卫（read/restore/redo） | ✅ | 9-B | routes/slides.ts 加 `isHeldBy(session.id)` 守卫 |
| A02.1 | session cookie httpOnly + secure(prod) + sameSite=lax | ✅ | – | `auth.ts:23-31` |
| A02.2 | 密码 bcrypt rounds≥10 | ✅ | – | `auth.ts:13` |
| A02.3 | API Key AES-256-GCM | ✅ | – | `crypto/apikey.ts` |
| A03.1 | Drizzle 全量参数化（无原始 sql 拼接） | ✅ | 9-C | `schema.ts` 仅 DEFAULT 字面量 |
| A03.2 | 全仓 0 v-html | ✅ | 9-C | grep 已确认 0；加 `vue/no-v-html: error` 永久守卫 |
| A03.3 | Slidev iframe 加 sandbox | ✅ | 9-C | `SlidePreview.vue` sandbox + 4 条测试守卫 |
| A03.4 | markdown-it 默认 html: false | ✅ | 9-C | Slidev 内置默认 false；项目自身无显式调用 |
| A03.5 | Hono sub-router wildcard 守卫不泄漏 | ✅ | 9-C | `routes-mount-integration.test.ts` 10 测；CLAUDE.md 已知坑提炼 |
| A04.1 | login / register rate limit | ⚠ | 9-E | 5 / 15min / IP |
| A04.2 | llm-chat rate limit | ⚠ | 9-E | 30 / hour / user |
| A04.3 | log-event rate limit | ⚠ | 9-E | 10 / min / user |
| A05.1 | CSP Report-Only | ⚠ | 9-D | – |
| A05.2 | Origin/Referer 校验 | ⚠ | 9-D | – |
| A05.3 | error 消息生产脱敏 | ⚠ | 9-E | `errorResponse(err, isProd)` |
| A06.1 | pnpm audit --audit-level=high = 0 | ✅ | 9-A | Phase 8 + 复核 |
| A06.2 | moderate 全 transitive + verdict | ✅ | 9-A | 11 unique 漏洞，dompurify/uuid/postcss/esbuild 等上游 |
| A07.1 | session 过期策略评估 | TBD | 9-B | TTL 30 天 |
| A07.2 | 登录暴力破解防护 | ⚠ | 9-E | 同 A04.1 |
| A08.1 | pnpm lockfile 锁版本 + verify | ✅ | – | pnpm 默认 |
| A08.2 | 无反序列化 user input | ✅ | – | Hono JSON parser + schema |
| A09.1 | log payload redact 敏感字段 | ⚠ | 9-E | password/apiKey/authorization/cookie/token/secret |
| A09.2 | log payload ≤ 64KB 截断 | ⚠ | 9-E | – |
| A10.1 | 无用户可控 SSRF 路径 | ✅ | – | LLM/MCP URL 由后端配置 |
| 卫生.1 | scripts 全部有保留/归档判定 | ⚠ | 9-G | 4 归档 + 5 保留 |
| 卫生.2 | knip 死代码扫描 baseline | ⚠ | 9-G | – |
| 卫生.3 | .gitignore 加固 data/* | ✅ | 9-F2 | 根 .gitignore 加 `packages/agent/data/*` + `!.gitkeep`；防御层叠在 packages/agent/data/.gitignore 之上 |
| 债务.1 | P3-15 coverage 拉回 | ⚠ | 9-G | 拉回 90/85 或锁定门槛 |
| 回归 | pnpm test + pnpm e2e 全绿 | TBD | 9-H | – |
| 回归 | coverage 不退步 | TBD | 9-H | – |
