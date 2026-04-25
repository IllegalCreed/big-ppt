# Phase 5 — 用户系统 + Deck + 版本 + 单实例占用锁 实施文档

> **状态**：✅ 已关闭（2026-04-23）
> **规划文件**：`~/.claude/plans/docs-deck-deck-slidev-lucky-locket.md`（用户 local，含完整推理与讨论记录）
> **前置阶段**：Phase 4（2026-04-22 已关闭，见 [09](09-phase4-edit-iterate.md)）
> **后续阶段**：Phase 5 补测轨道（见 [11](11-phase5-tests-and-env-split.md)）、Phase 5.5（待开始）
> **路线图**：[roadmap.md Phase 5](../requirements/roadmap.md)
>
> **执行期偏离 plan 的重要决定**（见下方 "执行期偏离纪录"）：
> - 单实例占用锁从 `slidev_lock` 表迁到 **agent 内存对象**（见 src/slidev-lock.ts）
> - 新增 **Slidev 反代鉴权**（agent 代理 `/api/slidev-preview/*`，未登录 401 / 非锁持有者 403），Slidev 原生端口不再直接暴露
> - Deck 编辑页标题 **双击原地改名**（UX 便利）
> - `deck_versions` 表追加 `turn_id` 字段（本 plan schema 部分已有描述，代码最终落地）

**Goal**：把"文件系统的 slides.md"升级成"数据库里的 deck 对象"，每次保存自动入版本历史，对话历史独立于版本 append-only 持久化。同时引入**单 Slidev 实例占用锁 + 等待页机制**，让 Phase 5.5 可以直接单实例部署上线。API Key 从 localStorage 搬到后端加密存储。

---

## 关键设计抉择（2026-04-23 与用户对齐）

1. **技术栈**：Hono（扩展现有 [packages/agent](../../packages/agent/)）+ Drizzle ORM（`drizzle-kit push` 模式）+ **MySQL**（复用 quiz-monorepo 那台 MySQL 实例，新建 `lumideck` 数据库）。**非 SQLite**——为 Phase 5.5 部署和 Phase 6 多实例共享存储铺路
2. **后端位置**：直接扩展 `packages/agent`，不新建 package。它已经是 Hono 服务器，加 `db/` + 新 routes 最省心
3. **密码哈希**：bcrypt rounds=10（与 [quiz-backend](../../../illegal/quiz-monorepo/apps/quiz-backend/) 一致，复用经验），**非 argon2**
4. **Session 方案**：HttpOnly Cookie + 服务端 `sessions` 表（stateful，便于撤销、未来支持"退出全部设备"）
5. **API Key 加密**：AES-256-GCM，master key 存 `APIKEY_MASTER_KEY` 环境变量（MVP 够用，后续可升级为密码派生方案）
6. **slides-store 签名不变**：7 个函数（`readSlides` / `writeSlides` / `editSlides` / `createSlide` / `updateSlide` / `deleteSlide` / `reorderSlides`）保留签名，内部换成"读写 deck_versions + mirror 到 slides.md"
7. **"active deck" 绑 session**：`sessions.active_deck_id` 存当前激活 deck id；切 deck 只是改这个字段 + 把新 deck 当前版本内容写回 slides.md
8. **单实例占用锁**：单行表 `slidev_lock(id=1)` + `UPDATE ... WHERE holder IS NULL OR holder = me OR heartbeat 超时` 原子抢占；30s 心跳；5 分钟超时释放
9. **deck_chats 独立于 deck_versions**（Phase 4 Q&A 确认）：切版本时对话保留，AI 感知"用户改主意了"

---

## ⚠️ Secrets 安全红线（HARD）

用户 2026-04-23 明确警告过一次：**绝对不能把数据库连接密码或 `.env.*.local` 之类的本地配置文件提交到 git。** 所有实施步骤必须遵守：

- `.gitignore` 已有 `.env` / `.env.*` / `!.env.example` 规则，**不要动这条规则**
- 新建的 `packages/agent/.env.example` 只写字段名 + 占位符
- 真实连接串只写到 `.env.local`（已被忽略），永不 commit
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**，全部按文件名显式添加
- 如发现本地已有敏感文件被 tracked，先改 `.gitignore` + `git rm --cached <file>` 再继续

---

## 数据模型（MySQL schema）

```ts
// packages/agent/src/db/schema.ts  (Drizzle)
users {
  id              INT PK AI
  email           VARCHAR(255) UNIQUE
  password_hash   VARCHAR(60)                    // bcrypt
  llm_settings    TEXT NULL                       // AES-GCM ciphertext
  created_at / updated_at
}

sessions {
  id                CHAR(32) PK                  // crypto.randomBytes(16).hex
  user_id           INT FK users CASCADE
  active_deck_id    INT NULL FK decks SET NULL
  last_heartbeat_at DATETIME NULL
  expires_at        DATETIME
  created_at
}

// 单实例全局锁（单行，id=1）
slidev_lock {
  id                INT PK (id = 1)
  holder_session_id CHAR(32) NULL
  holder_user_id    INT NULL
  holder_deck_id    INT NULL
  locked_at         DATETIME NULL
  last_heartbeat_at DATETIME NULL
}

decks {
  id                 INT PK AI
  user_id            INT FK users CASCADE
  title              VARCHAR(255)
  theme_id           VARCHAR(64) DEFAULT 'default'
  current_version_id INT NULL FK deck_versions SET NULL
  status             ENUM('active','archived','deleted') DEFAULT 'active'
  created_at / updated_at
}

deck_versions {         // append-only
  id          INT PK AI
  deck_id     INT FK decks CASCADE
  content     MEDIUMTEXT        // 完整 slides.md
  message     VARCHAR(255) NULL
  author_id   INT FK users SET NULL
  created_at
}

deck_chats {            // append-only，独立于 deck_versions
  id           BIGINT PK AI
  deck_id      INT FK decks CASCADE
  role         ENUM('system','user','assistant','tool')
  content      MEDIUMTEXT
  tool_call_id VARCHAR(128) NULL
  created_at
}
```

---

## API 契约（新增）

```
# Auth
POST   /api/auth/register          { email, password } → { user }
POST   /api/auth/login             → sets session cookie, { user }
POST   /api/auth/logout            → clears cookie
GET    /api/auth/me                → { user, hasLlmSettings } | 401
PUT    /api/auth/llm-settings      { provider, apiKey, baseUrl, model } → { ok }

# Decks
GET    /api/decks                  → [{ id, title, updated_at, status }]
POST   /api/decks                  { title, initialContent? } → { deck }
GET    /api/decks/:id              → { deck, currentVersion, versions[] }
PUT    /api/decks/:id              { title?, status? }
DELETE /api/decks/:id              → 软删

# Versions
POST   /api/decks/:id/versions     { content, message? } → 自动成为 current
GET    /api/decks/:id/versions
POST   /api/decks/:id/restore/:vid → 移动 current_version_id

# Chats
POST   /api/decks/:id/chats
GET    /api/decks/:id/chats

# Active deck + 单实例占用锁
POST   /api/activate-deck/:id      → 原子抢占 slidev_lock；冲突 409 + holder info
POST   /api/release-deck           → 释放自己的锁（幂等）
POST   /api/heartbeat              → 刷新 session + lock 心跳
GET    /api/lock-status            → { locked, holder?, isMe }

# 现有端点语义变更
GET    /api/read-slides            → 读 active deck current version（不读 fs）
```

---

## 实施步骤（四段推进，每段独立可 commit）

### Pre-5A — Docs 同步（半小时，已完成 2026-04-23）

- [x] `docs/requirements/roadmap.md`：Phase 5 重写、新增 P5.5、Phase 6 重构、原 P7 拆为 P7/P8、变更记录追加
- [x] `docs/requirements/vision.md`：技术栈表 MySQL 化、新增 Phase 5 过渡态架构段、核心场景补 10 条
- [x] `docs/requirements/requirements.md`：FR-04 按阶段演进、FR-05 拆出导出项、新增 FR-06~11、NFR-02 补 secrets 守则
- [x] `docs/plans/10-phase5-user-deck-versions.md`：本文件

### 5A — DB + Auth 底座（半天~一天）

- [x] `packages/agent/.env.example` 占位符（`DATABASE_URL` / `SESSION_SECRET` / `APIKEY_MASTER_KEY`）
- [x] `packages/agent/.env.local` 本地真实值（**不 commit**）；生成 32 字节随机 `SESSION_SECRET` / `APIKEY_MASTER_KEY`
- [x] 安装依赖：`pnpm --filter agent add drizzle-orm mysql2 bcrypt cookie` + `drizzle-kit @types/bcrypt` 作 devDep
- [x] `packages/agent/src/db/schema.ts`（先只 `users` + `sessions`）+ `drizzle.config.ts`
- [x] `pnpm --filter agent drizzle-kit push` 初始化 DB
- [x] `packages/agent/src/crypto/apikey.ts`（AES-GCM 加解密）
- [x] `packages/agent/src/middleware/auth.ts`（解 session cookie，注入 `ctx.var.user`）
- [x] `packages/agent/src/routes/auth.ts`（register / login / logout / me / llm-settings）
- [x] [packages/agent/src/index.ts](../../packages/agent/src/index.ts) 挂载新 routes + auth middleware
- [x] LLM 代理改：API Key 从 `ctx.var.user.llm_settings` 解密后使用，不信任客户端 header
- [x] 前端安装 vue-router；改 [packages/creator/src/main.ts](../../packages/creator/src/main.ts) 和 App.vue → RouterView
- [x] 新增 `packages/creator/src/pages/LoginPage.vue` / `RegisterPage.vue`
- [x] `packages/creator/src/api/client.ts` 封装（统一 `credentials:'include'`，401 跳 /login）
- [x] `packages/creator/src/composables/useAIChat.ts` 去掉 localStorage 读 key，改后端代理
- [x] **验证**：注册 → 登录 → 刷新 `/auth/me` 仍返回用户 → 配 LLM 设置 → 对话能通
- [x] **commit**：`feat(phase-5a): 引入 MySQL + Drizzle + auth + session；API Key 后端加密`

### 5B — Deck 模型 + CRUD + 单实例占用锁（一天）

- [x] schema 追加 `decks` / `deck_versions` / `deck_chats` / `slidev_lock`，`sessions` 加 `active_deck_id` + `last_heartbeat_at`
- [x] `drizzle-kit push`；seed `INSERT INTO slidev_lock (id) VALUES (1)`
- [x] `packages/agent/src/routes/decks.ts`：CRUD + versions + restore + chats
- [x] `packages/agent/src/routes/lock.ts`（或合进 decks.ts）：activate-deck / release-deck / heartbeat / lock-status
- [x] 锁原子抢占：`UPDATE slidev_lock SET holder_... WHERE id=1 AND (holder_session_id IS NULL OR holder_session_id = :me OR last_heartbeat_at < NOW() - INTERVAL 5 MINUTE)`，用 affectedRows 判成败
- [x] [packages/agent/src/slides-store/index.ts](../../packages/agent/src/slides-store/index.ts) 重写：7 个函数先验证 ctx.session 是锁持有者 → 读 current version → 操作 → 写新 version → 更新 `current_version_id` → mirror 到 fs
- [x] [packages/agent/src/routes/slides.ts](../../packages/agent/src/routes/slides.ts) `/api/read-slides` 走 DB
- [x] **验证**：
  - curl 创建 deck → activate → 编辑 → `SELECT * FROM deck_versions` 看版本链 → restore → `packages/slidev/slides.md` 与 current version 一致
  - 另起一个 curl 会话（不同 cookie）activate 同一 deck → 应 409 带 holder 信息
  - 主会话 release-deck → 第二个会话 activate 立即成功
- [x] **commit**：`feat(phase-5b): Deck CRUD + 版本历史 + 单实例占用锁（slidev_lock + heartbeat）`

### 5C — 前端 Deck UX + 占用状态体验（一天）

- [x] 路由加 `/decks` / `/decks/:id`
- [x] `packages/creator/src/pages/DeckListPage.vue`：列表 + 新建 + 重命名 + 软删
- [x] `packages/creator/src/pages/DeckEditorPage.vue`：进入时 POST `/api/activate-deck/:id`
  - 成功 → 装载现有编辑界面（从 App.vue 主体移植）+ 启动心跳定时器（30s 调 `/api/heartbeat`，离开/窗口关闭时 `/api/release-deck`）
  - 409 → 渲染 `<OccupiedWaitingPage>`：显示占用者信息 + 锁定时长 + 最后活跃时间 + 手动重试 + 5s 轮询 `/api/lock-status` 自动跳转
- [x] `packages/creator/src/components/VersionTimeline.vue`：侧栏/抽屉，列 versions，点击 restore，高亮 current
- [x] [packages/creator/src/composables/useAIChat.ts](../../packages/creator/src/composables/useAIChat.ts) 改：打开 deck 时 GET chats 加载历史；每次发言、每次工具回包都 POST 到 `/api/decks/:id/chats`
- [x] 顶栏状态条：占用中 → "使用中"+释放按钮；被他人占用 → 禁用编辑
- [x] **验证**：
  - 多 deck 切换 → 刷新浏览器所有状态保留
  - 版本时间线回滚后聊天历史连续（deck_chats 独立于 version）
  - 两浏览器两账号：A 占用 → B 看到等待页 → A 关标签页 → 5 分钟后心跳超时 B 自动进入；A 主动释放 → B 立刻进入
- [x] **commit**：`feat(phase-5c): Deck UX + 版本时间线 + 占用等待页 + 聊天持久化`

---

## 文件清单

### 新建
- [packages/agent/.env.example](../../packages/agent/.env.example)
- [packages/agent/drizzle.config.ts](../../packages/agent/drizzle.config.ts)
- [packages/agent/src/db/schema.ts](../../packages/agent/src/db/schema.ts) — 6 张表 Drizzle 定义
- [packages/agent/src/db/client.ts](../../packages/agent/src/db/client.ts) — mysql2 pool + drizzle
- [packages/agent/src/middleware/auth.ts](../../packages/agent/src/middleware/auth.ts)
- [packages/agent/src/crypto/apikey.ts](../../packages/agent/src/crypto/apikey.ts)
- [packages/agent/src/routes/auth.ts](../../packages/agent/src/routes/auth.ts)
- [packages/agent/src/routes/decks.ts](../../packages/agent/src/routes/decks.ts)
- [packages/creator/src/router/index.ts](../../packages/creator/src/router/index.ts)
- [packages/creator/src/api/client.ts](../../packages/creator/src/api/client.ts)
- [packages/creator/src/pages/LoginPage.vue](../../packages/creator/src/pages/LoginPage.vue)
- [packages/creator/src/pages/RegisterPage.vue](../../packages/creator/src/pages/RegisterPage.vue)
- [packages/creator/src/pages/DeckListPage.vue](../../packages/creator/src/pages/DeckListPage.vue)
- [packages/creator/src/pages/DeckEditorPage.vue](../../packages/creator/src/pages/DeckEditorPage.vue)
- [packages/creator/src/components/VersionTimeline.vue](../../packages/creator/src/components/VersionTimeline.vue)
- [packages/creator/src/components/OccupiedWaitingPage.vue](../../packages/creator/src/components/OccupiedWaitingPage.vue)

### 改造
- [packages/agent/src/index.ts](../../packages/agent/src/index.ts)
- [packages/agent/src/slides-store/index.ts](../../packages/agent/src/slides-store/index.ts)
- [packages/agent/src/routes/slides.ts](../../packages/agent/src/routes/slides.ts)
- [packages/agent/src/routes/llm.ts](../../packages/agent/src/routes/llm.ts)（API Key 改后端源）
- [packages/creator/src/main.ts](../../packages/creator/src/main.ts)
- [packages/creator/src/App.vue](../../packages/creator/src/App.vue)
- [packages/creator/src/composables/useAIChat.ts](../../packages/creator/src/composables/useAIChat.ts)
- [packages/creator/src/composables/useSlideStore.ts](../../packages/creator/src/composables/useSlideStore.ts)
- [packages/shared/src/api.ts](../../packages/shared/src/api.ts) — 补 auth + deck 类型

---

## 端到端验证（5C 完成后）

```bash
cd /Users/zhangxu/workspace/big-ppt
pnpm install
# 编辑 packages/agent/.env.local 填真实 DATABASE_URL
pnpm --filter agent drizzle-kit push
pnpm dev   # 同时起 agent :4000 / creator :3030 / slidev :3031

# 后端
curl -X POST localhost:4000/api/auth/register -H 'content-type: application/json' -d '{"email":"a@a.com","password":"pw"}'
curl -X POST localhost:4000/api/auth/login -c cookie.txt -H 'content-type: application/json' -d '{"email":"a@a.com","password":"pw"}'
curl -b cookie.txt localhost:4000/api/auth/me
curl -b cookie.txt -X POST localhost:4000/api/decks -H 'content-type: application/json' -d '{"title":"First Deck"}'
curl -b cookie.txt -X POST localhost:4000/api/activate-deck/1
curl -b cookie.txt localhost:4000/api/read-slides

mysql -D lumideck -e "SELECT id,deck_id,created_at,LEFT(content,40) FROM deck_versions;"

# 浏览器
# /register → /login → /decks → 新建 → /decks/1 → 编辑 → 刷新 → 内容/聊天都在
# → 侧栏点历史版本 restore → 幻灯片切回 → 聊天历史仍连续
# → 另一浏览器登录另一账号 → 访问 /decks/1 → 看到等待页
```

---

## 已确认决策（2026-04-23）

| 决策 | 选择 |
|---|---|
| MySQL 实例 | 复用 quiz-monorepo 那台，新建 `lumideck` 数据库 |
| 执行粒度 | 分 Pre-5A / 5A / 5B / 5C 四次推进 |
| API Key 加密 | Master key 存环境变量，AES-256-GCM（MVP 够用） |
| 密码哈希 | bcrypt（与 quiz-backend 一致） |
| Drizzle 迁移 | 开发期 `push`，上线前再切 `generate` |
| Session | HttpOnly Cookie + 服务端表（stateful） |

---

## 执行期偏离纪录（2026-04-23）

五点偏离 plan 的决定，都是实施中即时讨论拍板：

### 1. 单实例锁从 DB 表改成 agent 内存对象
- **原计划**：`slidev_lock` 表 + 原子 `UPDATE ... WHERE holder IS NULL OR ...`
- **实际**：[src/slidev-lock.ts](../../packages/agent/src/slidev-lock.ts)，模块级 `currentLock: LockHolder | null`
- **原因**：Node 单线程天然原子；不引入循环外键 + DATETIME 时区坑；agent 重启时锁自然清零（用户 ctrl+R 重连即可）；Phase 6 多实例架构也不会沿用这张表
- 代价：重启不保留。可接受
- 影响：`drizzle-kit push` 执行过程中删掉了已建好的 `slidev_lock` 表；schema.ts 里只留 5 张表

### 2. 新增 Slidev 反代鉴权（原 plan 未覆盖的安全漏洞）
- **背景**：用户发现 Slidev 原生跑在 `:3031`，iframe 直连，**完全没有访问控制**。dev 模式在 localhost 没事，但 Phase 5.5 一上公网就泄露所有 deck 预览
- **解决**：agent 新增 [src/slidev-proxy-auth.ts](../../packages/agent/src/slidev-proxy-auth.ts) 反代 `/api/slidev-preview/*`，未登录 401，非锁持有者 403；生产 Slidev 绑 `127.0.0.1:3031`，仅 agent 可访问
- 顺带踩坑：Slidev HTML 里是绝对路径 `/@vite/client` / `/node_modules/...` / `#slidev/slides`，需要 `base` 配置把所有内部路径前缀化到 `/api/slidev-preview/`

### 3. Deck 编辑页标题双击原地改名（新 UX）
- 用户提出：要编辑标题只能返回列表不合理
- 实现：[components/DeckEditorCanvas.vue](../../packages/creator/src/components/DeckEditorCanvas.vue) 双击 → input；Enter 保存 / Esc 取消 / blur 自动保存；错误文案放副标题行

### 4. deck_versions 加 turn_id 字段
- **原计划**：只有 `message` 字段
- **实际**：加 `turn_id VARCHAR(64)`，同一用户 turn 里多次 tool_call 写的版本共享 turnId，前端 VersionTimeline 折叠显示为 "同轮 N 次修改"
- 兼顾 Phase 4 的轮次聚合语义

### 5. 历史按钮位置调整
- 用户审美反馈：历史按钮挪到用户邮箱右边（工具区分组），双击 input 样式简化（只留错误行，去掉 "Enter 保存 · Esc 取消" 辅助文字）

---

## 交付 commit 列表

| Phase | Commit |
|---|---|
| Pre-5A | `docs(phase-5): 同步 P5 调整到路线图、愿景、需求；新增 10-phase5 计划` |
| 5A | `feat(phase-5a): 引入 MySQL + Drizzle + 用户系统 + 后端加密 API Key` |
| 5B | `feat(phase-5b): Deck CRUD + 版本历史 + 单实例占用锁（slidev_lock + heartbeat）` |
| 5B-refactor | `refactor(phase-5b): 锁搬进内存 + Slidev 反代鉴权，收紧预览访问` |
| 5C | `feat(phase-5c): Deck UX 全链路 — 列表/编辑/版本时间线/占用等待页` |
| 5C-fix | `fix(phase-5c): Slidev 反代路径前缀化，让 iframe 真的能渲染` |
| 5C-UX | `feat(phase-5c): 编辑页标题双击改名 + 历史按钮移到邮箱右边` |
| 5C-polish | `style(phase-5c): 副标题与 input 间距回到 2px，贴合整体节奏` |

---

## 踩坑与解决

### 坑 1：Slidev 原生端口对外暴露 = 预览泄露漏洞

- **症状**：dev 模式 Slidev 跑 `:3031`，iframe 直连，**完全没有访问控制**；任何人扫到端口都能看所有 deck 预览
- **根因**：原 plan 假设 iframe 与 agent 同源，没考虑 Slidev 端口独立的访问控制
- **修复**：commit `f0a29b7` — agent 新增 [src/slidev-proxy-auth.ts](../../packages/agent/src/slidev-proxy-auth.ts) 反代 `/api/slidev-preview/*`，未登录 401 / 非锁持有者 403；生产 Slidev 绑 `127.0.0.1:3031`
- **防再犯**：CLAUDE.md 架构图明确"slidev 仅 agent 反代"；`packages/slidev/package.json` dev 脚本固定 `--base /api/slidev-preview/`
- **已提炼到 CLAUDE.md**：是

### 坑 2：Slidev HTML 绝对路径破坏反代

- **症状**：反代上线后 iframe 加载白屏，devtools 看 `/@vite/client` / `/node_modules/...` 全 404
- **根因**：Slidev 默认输出 HTML 用绝对路径，没适配 `base` 前缀
- **修复**：commit `b8cc9ea` Step 5C-fix — Slidev dev 启动加 `--base /api/slidev-preview/`
- **防再犯**：CLAUDE.md "Slidev 包的特殊点" 章节已记录
- **已提炼到 CLAUDE.md**：是

### 坑 3：单实例锁 DB 表实施踩到外键 / 时区坑

- **症状**：原 plan 的 `slidev_lock` 表 `UPDATE ... WHERE` 在循环外键引用 + DATETIME 时区上撞墙
- **根因**：MySQL `sessions.id` ↔ `slidev_lock.holder_session_id` 互引；DATETIME 与 UTC unix timestamp 混用产生比较误差
- **修复**：commit `f0a29b7` — 锁搬到 agent 进程内存对象（[src/slidev-lock.ts](../../packages/agent/src/slidev-lock.ts)），删 `slidev_lock` 表
- **防再犯**：单进程内 atomic 状态优先用内存对象不用 DB
- **已提炼到 CLAUDE.md**：是（已记录在"关键模块"节）

### 坑 4：dev agent 重启后内存锁未清理

- **症状**：dev 时 ctrl+C agent → 重启后内存锁残留，用户看到自己持锁状态错乱
- **根因**：内存锁在 module-level state，但持锁会话已断开
- **修复**：commit `8dc94b5` — agent 启动时如检测到旧 lock 持有者 session 已不存在，自动复位
- **防再犯**：CLAUDE.md "已知坑" 已收录；进程级状态都要考虑重启时的复位策略
- **已提炼到 CLAUDE.md**：是

### 坑 5：Slidev iframe 翻页触发整页 reload

- **症状**：每次 PageDown / PageUp，iframe 都整页 reload 一次，闪烁明显
- **根因**：Slidev 默认用 `history` 模式，URL 变化时 iframe `src` 改变触发刷新
- **修复**：commit `648e2e8` — Slidev 切 `hash` 路由模式，iframe 翻页用锚点跳转零 reload
- **防再犯**：未来 Slidev 升级时复检 `historyMode` 默认值
- **已提炼到 CLAUDE.md**：否（属于 Slidev 配置细节，未来会变）

---

## 测试数量落地

> 本 Phase 主轨（5A/5B/5C）只关注功能落地，测试基建在补测轨道（[plan 11](11-phase5-tests-and-env-split.md)）集中补完。
>
> 主轨结束时：agent 75 → 124（Phase 4 留底）；补测轨道关闭时：agent **208** + creator **49** + E2E **5** = **262**。详见 plan 11。

