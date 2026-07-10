# Phase 16 — PresentationViewer 与 Slidev runtime 退役

> **状态**：已完成（2026-07-10）
> **前置阶段**：[plan 31](31-phase15-archive-export-import.md)、[plan 32](32-phase11.8-anchor-image-styling.md)
> **后续阶段**：Phase 17+
> **路线图**：[roadmap.md Phase 16](../requirements/roadmap.md#phase-16自研-presentationviewer--slidev-runtime-彻底替代)

**Goal**：让编辑器放映、演讲者视图和公开分享全部复用 creator 内的
`DeckRenderer`，完成翻页、overview、备注、计时、黑白屏、画笔和分享生命周期；随后删除
Slidev dev server、反向代理、单实例锁及相关部署配置。`packages/slidev` 继续作为模板、layout
与公共组件的 workspace 包存在，不再承担 runtime 进程。

---

## 关键设计抉择（2026-07-10）

1. **先并行上线新放映链路，验收后再删旧 runtime**：新路由全量 E2E 通过前保留旧代码，避免无法回退；同一 Phase 内完成删除，不把双轨状态留到下一阶段。
2. **渲染唯一口径是 `DeckRenderer`**：编辑器、观众窗口、演讲者预览、overview 和公开分享都传同一份 markdown/templateId，不复制 layout 解析器。
3. **演讲会话用 `BroadcastChannel`，channel id 放 query**：消息只在同浏览器同 origin 内传播，按 deckId + 随机 channel 隔离；不落 DB，不引入进程级共享状态。
4. **画笔用轻量 SVG pointer-event 实现**：只做笔、高亮、颜色、粗细、撤销和清空；坐标归一化到 0–1，跨不同窗口尺寸仍能同步。不引入完整白板 SDK。
5. **分享链接返回明确生命周期错误**：不存在为 404，过期/撤销为 410，并带稳定 code；公开页面据此显示准确文案。
6. **公开图片走 share-scoped asset API**：公开 presentation payload 把 `/api/assets/:id` 改写为 `/api/share/:slug/assets/:id`；asset 查询同时约束 share、deck 与 asset，撤销后立即失效且禁止缓存。
7. **每个 deck 只有一个当前分享链接**：`share_links.deck_id` 唯一；重新创建会旋转 slug 并覆盖过期/撤销状态，避免历史链接重新复活。
8. **owner presentation API 仍显式存在**：虽然 `GET /api/decks/:id` 已含内容，仍提供 `/presentation` 稳定契约，让演示页面不依赖编辑器的版本列表响应。
9. **`/undo`、`/redo` 改为 header-scoped DB 操作**：删除锁后由 `X-Deck-Id` 注入 ALS；`/read-slides` 随 Slidev mirror 一起删除。
10. **CI 先落地再扩功能**：Phase 16 的每一批提交都必须经过 MySQL 单测、类型、lint、bundle budget 与 Playwright 无密钥流程。
11. **双屏入口只申请一个弹窗**：编辑器点击「双屏放映」后，新开具名观众窗口，当前标签页进入演讲者视图；两端共享随机 channel。具名窗口可被演讲者重新聚焦或在关闭后重开，避免不断生成重复观众窗口，也规避一次点击申请两个弹窗被浏览器拦截。

---

## Secrets 安全红线

- 不新增生产 secret。
- CI 使用临时 MySQL service 和固定测试密钥，只写被 gitignore 的 `.env.test.local`。
- 分享 slug 用 `crypto.randomBytes` 生成，不记录到业务日志。
- 禁用 `git add -A` / `git add .`，提交前运行 `scripts/check-secrets.sh`。

---

## 数据模型变更

### `share_links`

| 字段                        | 约束                | 用途                      |
| --------------------------- | ------------------- | ------------------------- |
| `id`                        | PK                  | 内部标识                  |
| `slug`                      | UNIQUE, varchar(64) | 公开 URL 随机凭据         |
| `deck_id`                   | UNIQUE, FK cascade  | 每个 deck 一个当前链接    |
| `user_id`                   | index, FK cascade   | owner 管理查询复合约束    |
| `expires_at`                | nullable datetime   | null 表示永不过期         |
| `revoked_at`                | nullable datetime   | 非空表示已撤销            |
| `access_count`              | int default 0       | presentation 成功访问次数 |
| `last_accessed_at`          | nullable datetime   | 最近访问时间              |
| `created_at` / `updated_at` | timestamp           | 生命周期审计              |

迁移策略：dev/test/production 均走现有 `drizzle-kit push`；push 后用 `SHOW COLUMNS` 核对
`access_count` 默认值，规避 drizzle-kit 0.31 的 NOT NULL default 遗漏。

---

## 阶段拆分

### Task 16-0：工程守门

- 新增 GitHub Actions：MySQL 8、lint/type-check、四包单测、creator build budget、Playwright E2E。
- 清理 lint warning；关闭已完成的视觉回归技术债，回写 Phase 14/15 验收项。

### Task 16-A：放映核心

- 新增 owner presentation API 与 `/decks/:id/present` 页面。
- `PresentationViewer.vue` 支持键盘、鼠标、触屏、全屏、进度、页码、黑/白屏。
- `OverviewGrid.vue` 支持 Esc 打开、点击跳页。
- 替换编辑器「放映」按钮，不再抢锁。

### Task 16-B：演讲者模式

- `PresenterMode.vue` 显示当前页、下一页、备注、计时器与控制栏。
- `BroadcastChannel` 同步 page、blackout 和 drawing；实现 hello/state 握手覆盖窗口启动时序。
- 编辑器「双屏放映」新开观众窗口并在当前标签页进入演讲者视图；翻页、黑/白屏和绘画均从演讲者端驱动并在观众端验收。

### Task 16-C：公开分享

- share CRUD + public presentation/asset API。
- `ShareModal.vue` 支持创建、复制、过期设置、旋转和撤销。
- `/share/:slug` 无登录访问，准确呈现 not-found/expired/revoked。

### Task 16-D：画笔与旧 runtime 退役

- `DrawingLayer.vue` 支持 pen/highlighter、颜色、粗细、撤销、清空。
- 删除 slidev lock/proxy/restart/mirror 路径和测试。
- PM2 从两进程减为 agent 单进程；nginx 删除 Vite/Slidev locations；healthz 只检查 DB。
- `packages/slidev` 删除 runtime scripts 与 CLI/theme/icon workaround，只保留设计系统构建和测试。

---

## API 契约

- `GET /api/decks/:id/presentation`：owner-only，返回 `{ presentation }`。
- `GET /api/decks/:id/share`：owner-only，返回当前链接或 null。
- `POST /api/decks/:id/share`：owner-only，创建/旋转链接，body `{ expiresInDays: number | null }`。
- `DELETE /api/decks/:id/share`：owner-only，撤销当前链接。
- `GET /api/share/:slug/presentation`：公开，成功时 access_count +1。
- `GET /api/share/:slug/assets/:assetId`：公开，复合约束且 no-store。

`PresentationPayload` 统一字段：`deckId`、`title`、`templateId`、`markdown`、`updatedAt`。

---

## 跨用户/跨 deck 隔离 risk audit

1. `BroadcastChannel` 名称含 deckId + 128-bit 随机 channel，不存在后端共享 Map。
2. owner API 的 SQL 必须同时约束 `decks.id + decks.user_id`，不做先读 BLOB 再判断。
3. share 管理 SQL 同时约束 `share_links.deck_id + share_links.user_id`。
4. public asset SQL 同时约束 slug 有效、`deck_assets.deck_id` 和 assetId；撤销/过期时不读 BLOB。
5. 每个 owner endpoint 都加跨用户 IDOR 测试；public endpoint覆盖随机 slug、过期、撤销和跨 deck asset。
6. Drawing/BroadcastChannel 仅浏览器内 session state，不进入 agent ALS 或 async worker。

---

## 验收条件映射

- [x] 翻页、progress、演讲者视图、备注、计时器、黑白屏、overview 全部可用。
- [x] 画笔与高亮支持 pointer 输入、撤销和清空，并同步到观众窗口。
- [x] 分享链接公开访问；不存在、过期、撤销状态准确。
- [x] 两个用户同时放映不同 deck，均成功且无锁 API/冲突 UI。
- [x] production PM2 只有 `lumideck-agent`；nginx 无 Slidev/Vite 反代 location。
- [x] agent 源码无 `slidev-lock`、`slidev-proxy-auth`、`slidev-restart` 和 mirror runtime 引用。
- [x] 全量单测、coverage、build budget、E2E、视觉截图与 production healthz 通过。

## 验证记录（2026-07-10）

- agent：1092 tests passed；coverage lines 91.03% / branches 80.42% / functions 89.61%。
- creator：386 tests passed；coverage lines 84.29% / branches 72.50% / functions 75.18%。
- shared / slidev design system：3 / 55 tests passed。
- Playwright：61 passed、10 skipped；覆盖原生放映、公开分享、双用户并发、移动端与 12 组视觉基线。
- `pnpm lint`、`pnpm type-check`、`pnpm build`、creator bundle budget 与模板缩略图生成均通过。
- 生产部署后以 healthz commit SHA、PM2 单进程和 nginx 无旧 location 三项交叉确认。

---

## 不做什么

- 不做录屏、Monaco、物理模拟和多人协作画板。
- 不持久化演讲中的笔迹与计时器。
- 不新增自定义 slide transition 编辑器；本 Phase 只提供统一 fade。
- 不重命名 `packages/slidev`，避免模板/组件 workspace import 产生无价值迁移。
