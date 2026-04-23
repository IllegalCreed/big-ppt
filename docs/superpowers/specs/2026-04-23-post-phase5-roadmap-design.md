# Post-Phase 5 路线图重规划 Design

> **日期**：2026-04-23
> **状态**：Design approved，待写 implementation plan
> **前置**：Phase 5 闭环（2026-04-23，见 [10-phase5-user-deck-versions.md](../../plans/10-phase5-user-deck-versions.md) / [11-phase5-tests-and-env-split.md](../../plans/11-phase5-tests-and-env-split.md)）；P2-4 MCP 凭证加密同日提前清（见 [99-tech-debt.md](../../plans/99-tech-debt.md)）
> **替代**：原计划 Phase 5.5 首次部署 → 推迟到新 Phase 9，前插 Phase 6A/6B/7/8 四个产出周期

## 动机

Phase 5 产线闭环后，按原路线图下一站是**首次部署（Phase 5.5）**。部署前用户新增两条硬约束：

1. **全量安全 review**：在 prod 暴露前保证 0 泄露（password / API key / session secret）、0 高危漏洞
2. **第二套模板 + 模板切换**：单模板产品形态缺"选择感"，且模板架构要一次性做对（manifest / 动态 prompt / 迁移流水）；临部署阶段才加代价更高

后续讨论中追加第三条：

3. **依赖全量升级**：安全 review 与依赖升级顺序耦合（pnpm audit / 破坏性变更修复都需基于最终版本），升级必须在 Audit 前

三条工作量 > 5.x 小版本范围，故重编号为 Phase 6/7/8，原部署改名 Phase 9。

## 最终顺序

```
Phase 5（closed 2026-04-23）
  │
  ▼
Phase 6A ── 模板系统架构（manifest + deck.template_id + prompt 动态化 + 切换 API + 迁移流水）
  │
  ▼
Phase 6B ── 第二套模板内容 + UI（B 模板设计 + 实现 + 新建弹窗 + 编辑页切换 + confirm dialog + E2E）
  │
  ▼
Phase 7  ── 依赖全量升级（pnpm + major bump + 回归 + P3-7 / P3-1 复检）
  │
  ▼
Phase 8  ── 安全 Audit L3（OWASP Top 10 + git history secrets + pnpm audit + CSP + 修漏洞 + report）
  │
  ▼
Phase 9  ── 首次部署（原 Phase 5.5；阿里云 ECS/RDS/OSS + 域名 + 监控）
```

### Gate 规则（不可并行）

| Gate | 规则 | 理由 |
|---|---|---|
| 6A → 6B | 6A 结束前不开 6B | 架构不稳填内容会返工 |
| 6B → 7 | 6B 结束前不开 7 | 升级依赖可能引入模板渲染回归，模板先敲定为参考系 |
| 7 → 8 | 7 结束前不开 8 | Audit 要审的是最终依赖版本 |
| 8 → 9 | 8 结束前不部署 | Audit verdict = 可部署条件 |

### 允许的有限并行

- Phase 6A 中 Prompt 动态拼装 landing 后，可并行起草 Phase 6B 的模板设计稿（非阻塞架构收尾）

## Phase 6A — 模板系统架构

### 关键设计抉择（2026-04-23 与用户对齐）

1. **模板契约**：完全自由。两套模板独立设计，layout 集合 / frontmatter 字段可完全不同。切换由 AI 全量重生内容。理由：视觉差异化必要，AI 已能胜任语义迁移，架构一次性做对
2. **切换触发路径**：三合一 —— 新建 deck 时选 + 编辑页随时切 + AI 通过工具切
3. **切换副作用**：必须走 **confirm dialog + 自动版本快照 + /undo 可回**，用户不可无感知丢内容

### 产物

1. **Template Manifest 规范** `templates/<id>/manifest.json`：
   - `id` / `name` / `description` / `thumbnail` / `logos` / `prompt_persona`
   - `layouts[]`：`name` / `description` / `frontmatter_schema`（JSON Schema）/ `body_guidance`
2. **company-standard 补 manifest.json**（回填现有模板，不改现有行为）
3. **DB 迁移**：`decks` 表加 `template_id` 字段，老 deck 默认 `company-standard`
4. **后端 API**（新增 / 升级）：
   - `GET /api/templates` — 返回所有 manifest（升级原 `/api/list-templates`）
   - `POST /api/decks/:id/switch-template` — body `{ targetTemplateId, confirmed: true }`；返回 migration job id
5. **Tool-registry 更新**：
   - `list_templates`（升级返回 manifest，替代原纯 id 列表）
   - `switch_template`（前端受控为主，AI 对话也可触发）
6. **Prompt 动态拼装**（最脏但最关键）：
   - 目前 [packages/agent/src/prompts/](../../../packages/agent/src/prompts/) 硬编码 7 个 layout + 字段说明
   - 重构为从当前 deck 的 `template_id` → 读 manifest → 运行时拼装 prompt 段
7. **迁移流水**：
   - **前**：自动快照（复用 Phase 5A 的 `deck_versions`）
   - **中**：AI 读旧 md → 提取语义摘要 → 按新模板 manifest 的 layouts + frontmatter_schema + body_guidance 重写每页
   - **成功**：写新 md + 更新 `deck.template_id` + 入新 version + 前端 toast
   - **失败**：保留旧版本 + 错误提示 + 明示可 /undo

### 验收

- [ ] `company-standard` 挂 manifest 后 `pnpm test` 全绿（零回归）
- [ ] `decks.template_id` 迁移脚本跑完，老 deck 均默认 company-standard
- [ ] **Prompt A/B contract test**：锁 ≥10 条典型用户指令（create/update/delete/reorder 各 2 条 + edit_slides 2 条），切换前后同一 deck 同指令 AI 行为等价（不回归既有编辑能力）
- [ ] `switch_template` API 单测：未 confirm 拒绝 / 跨用户 403 / job 状态机完整 / 失败回滚
- [ ] 新增测试数 ≥ 20

## Phase 6B — 第二套模板内容 + UI

### 待决策

- **B 模板视觉风格**：留到 Phase 6B 启动时独立 brainstorm（限时 1-2 天决策收口）。建议与 company-standard 强对比（极简学术风 / 深色活力风 / 杂志编辑风任选）

### 产物

1. **B 模板设计**：DESIGN.md / tokens 规范 / logo / 视觉素材 / 缩略图
2. **B 模板实现**：
   - `templates/<b-id>/tokens.css`
   - layouts（**数量自由**，允许 5-9 个；与 A 模板不强求一致）
   - L* 内部组件（按需）
   - `manifest.json` 填完整
3. **前端 UI**：
   - 新建 deck 弹窗：命名 input + 模板选择器（缩略图卡片 + 描述 + hover preview）
   - 编辑页模板切换入口（顶栏按钮 / 菜单项）
   - Confirm dialog：强调"内容将被 AI 重写、当前版本自动快照、失败可 /undo"
   - 重写进度指示（loading + 预计耗时）
   - 结果页：成功 toast / 失败错误展示 / /undo 入口直达
4. **E2E 场景**（3 条新 spec）：
   - 新建 → 选 B 模板 → deck 初始化 → 编辑器渲染
   - 旧 deck 切 B → confirm → AI 重写 → 内容合规
   - 切模板 → /undo → 回到旧模板 + 旧内容

### 验收

- [ ] `pnpm e2e` 全绿
- [ ] 两套模板双向切换可逆（/undo 回得去 + 无数据丢失）
- [ ] 新建弹窗缩略图加载正常（首次 < 1s，懒加载）
- [ ] 总测试数 268 → ~290

## Phase 7 — 依赖全量升级

### 关键设计抉择

- **失败回退原则**：单包升级失败就**退回**，不深修。必要时发独立 PR 单独修（记入 tech-debt）。**不在 Phase 7 内修复破坏性变更**

### 产物

1. **依赖盘点清单**（对齐：当前版本 → 目标版本 → 破坏性变更 summary）：
   - Vue / Vite / Slidev / Hono / @hono/node-server
   - drizzle / drizzle-kit
   - Vitest / @vitest/coverage-v8 / Playwright / MSW
   - UnoCSS（重点：P3-7 bug 新版本是否修复）
   - @antdv-next/x（重点：P3-1 Slot warning 0.4+ 是否修复）
   - TypeScript / ESLint / Prettier / tsx
   - Node 版本（package.json engines + .nvmrc）
2. **升级策略**：
   - 分批 commit（patch → minor → major），每批独立 commit
   - 每批后跑 `pnpm test + pnpm e2e + pnpm -F @big-ppt/agent build`
   - major bump 前查 CHANGELOG / migration guide
3. **触发事件复检**：
   - **P3-7 UnoCSS 图标 bug**：升级后重跑 `presetIcons({ collectionsNodeResolvePath })` 验证。若修复：**删除** `scripts/gen-icons.mjs` + `styles/icons.css` + `.npmrc` 的 `public-hoist-pattern` + slidev 的 `@iconify-json/*` direct deps；更新 tech-debt
   - **P3-1 @antdv-next/x Bubble slot**：升级到 0.4+ 后回归 ChatPanel warning 是否消失；若消失 → 回 PR 绕过方案清理
4. **锁定**：
   - `pnpm-lock.yaml` 一次性稳定（最后一次 commit 独立包含）
   - `.nvmrc` 定版（保证部署环境一致性）
5. **前哨 audit**：升级结束跑一次 `pnpm audit --audit-level=high`，作为 Phase 8 的心理底（不是 Phase 8 的替代）

### 验收

- [ ] `pnpm outdated` 无 major 滞后（除非有明确拒绝理由，记入 tech-debt）
- [ ] `pnpm audit --audit-level=high` ≤ Phase 8 启动可接受水平（高危/严重 0 条；moderate 评估）
- [ ] 全量回归测试 100% 通过
- [ ] P3-7 / P3-1 给出 verdict（清除或保留）

## Phase 8 — 安全 Audit L3（OWASP Top 10）

### 关键设计抉择

- **范围**：L3（L2 + OWASP Top 10 + 依赖扫描），最严格档
- **产物要求**：正式 report 落档至 `docs/security/2026-XX-audit-report.md`，可追溯

### 产物（按 OWASP Top 10 对应）

1. **Secrets 扫描**：
   - `gitleaks` 或 `trufflehog` 全 git 历史扫
   - 代码硬编码搜（API key / password / master key pattern）
   - logger / console 输出审查（不落 Authorization / 明文 key）
   - 确认 `.env.*.local` 不在任何 commit 里
2. **A01 / A07 认证授权**：
   - 所有 state-changing API 端点清单：端点 / method / auth 守卫 / ownership 守卫
   - session cookie：`httpOnly + secure + sameSite=lax|strict`
   - 过期策略 + 续期
   - Slidev proxy 授权回归（Phase 5C 已做，此处复核）
   - MCP `/api/mcp/servers`：requireAuth（P2-4 已做，此处验签）
3. **A03 注入 / XSS**：
   - Drizzle 全量核查：所有 `sql\`\`` 原始模板都参数化
   - Slidev md 写入：frontmatter 转义
   - Vue `v-html` 全仓搜索 + 白名单审查
   - Slidev iframe：`sandbox` 属性 + 同源策略
   - markdown-it sanitization
4. **A01 CSRF**：
   - state-changing fetch 凭证 + CSRF token（或 sameSite=strict 的豁免论证）
5. **CORS / CSP**：
   - 生产 CORS allowlist（不要 `*`）
   - CSP 策略评估（Slidev 需 unsafe-inline 的部分要明确豁免范围）
6. **A06 依赖审计**：
   - `pnpm audit --audit-level=high` 必须 0
   - 可选：Socket.dev / Snyk 扫一遍
   - License 合规（生产用 GPL 依赖要评估）
7. **A04 错误信息泄漏 + Rate limiting**：
   - 生产环境不回 stack trace
   - 登录 / LLM proxy / 注册 限流评估
8. **A09 日志脱敏**：
   - log 结构化输出不含 PII（邮箱 mask / Authorization 去除）
9. **修漏洞 → 回归**：
   - 高危问题全修 + 单测补齐
   - 再跑 audit 达成 0 高危

### 验收

- [ ] `pnpm audit --audit-level=high` = 0
- [ ] gitleaks 全历史扫 = 0 leaked secret
- [ ] OWASP Top 10 checklist 10/10 打勾 + 每项附证据（代码行号 / test case / config 位置）
- [ ] 产出 `docs/security/2026-XX-audit-report.md` 留存

## Phase 9 — 首次部署（原 Phase 5.5）

> **本次规划不展开。** Phase 9 启动时独立 brainstorm 并落独立 spec。此处仅列必须预先锁定的前置条件。

### 前置条件（Phase 8 结束时确认）

1. **部署目标**：阿里云 ECS（agent 进程）/ RDS（`lumideck` 库）/ OSS（creator dist 静态）/ 域名 + TLS
2. **Env 分层已就绪**（Phase 5 已做）：`.env.production.local` 通过**服务器环境变量**注入 prod creds，**不走文件提交**
3. **构建 pipeline**：agent（Hono node 进程，systemd/pm2）+ creator（Vite SPA dist → OSS）+ slidev（静态导出 vs SSR —— Phase 9 决定）
4. **监控/日志**：至少 stdout → systemd/pm2 → logrotate；后续迭代加 Sentry/OpenTelemetry
5. **数据库初始化**：`pnpm -F @big-ppt/agent db:push` 落 schema + 创建管理员账户策略
6. **secrets 红线复核**：`APIKEY_MASTER_KEY` / DB 密码 / session secret 通过服务器环境变量注入

## 风险清单

| 风险 | 影响 Phase | 缓解 |
|---|---|---|
| Prompt 动态拼装回归，A/B 行为不一致 | 6A | 6A 做 AI 行为 contract test，锁 ≥10 条典型用户指令，回归兜底 |
| B 模板设计卡风格选型 | 6B | 6B 启动时独立 brainstorm，限时 1-2 天决策收口 |
| 依赖某个 major bump 破坏性强导致 Phase 7 卡住 | 7 | 退回，记入 tech-debt，不深修（用户规则） |
| Audit 发现高危漏洞导致返工 | 8 | 7 结束时已跑 pnpm audit 做前哨，8 时心里有底 |
| Phase 6 战线比预期长挤占部署窗 | 6A / 6B | 6A/6B 每 Step 独立 merge；允许先部署 A 模板，B 模板作 post-launch |

## Tech-Debt 引用与更新

本次路线图可能触动的 tech-debt 项（见 [99-tech-debt.md](../../plans/99-tech-debt.md)）：

| Tech-Debt | Phase | 预期动作 |
|---|---|---|
| P3-1 @antdv-next/x Bubble slot | 7 | 升级 0.4+ 验证是否修复；修则清 workaround |
| P3-4 content_guard.js 扩展错误过滤 | 8 | Audit 顺带改白名单（filename origin 校验） |
| P3-7 UnoCSS 图标离线生成 | 7 | 升级后若 UnoCSS 修 regression，删 gen-icons 流水 |
| P3-8 字体未自托管 | 9 | Phase 9 部署前评估 `@fontsource/*` 或 CDN 自托管 |
| P3-9 前端视觉回归自动化 | — | 不在本路线图，留作独立轨道 |

## 下一步

此 spec 经用户 review 确认后，调用 `superpowers:writing-plans` skill 写 Phase 6A 的 implementation plan（docs/plans/12-phase6a-template-system-architecture.md）。Phase 6B/7/8/9 在各自 Phase 启动时再分别落 plan，不一次性全写。
