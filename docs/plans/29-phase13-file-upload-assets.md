# Phase 13 — 文件上传 + 引用 + 用户级 Asset 管理 实施文档

> **For agentic workers**:REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`(7 Task 体量适合 fresh agent per task)。步骤用 checkbox(`- [ ]`)追踪。
>
> **状态**:✅(2026-05-16 落地;7 Task 全完 + 2 E2E spec 跑通 + prod 部署 + close-out 三章节)
> **前置阶段**:[plan 28 Phase 12.7](28-phase12.7-pi-agent-core.md) ✅
> **后续候选**:Phase 13.5 (MCP catalog HTTP wrapper / 品牌 asset 持久化) / Phase 14 导出
> **路线图**:[roadmap.md Phase 13](../requirements/roadmap.md)
> **设计 spec**:[2026-05-16-phase13-file-upload-assets.md](../superpowers/specs/2026-05-16-phase13-file-upload-assets.md)
> **执行子技能**:`superpowers:subagent-driven-development`

**Goal**:让 PPT-agent 用户能上传 PDF / DOCX / XLSX / Image / MD / TXT 作为参考素材,agent 通过 `list_uploaded_files` + `read_uploaded_file` 两个工具读取(image 类直接 multi-modal 喂主 LLM)。配套 user_assets 表 + 本地 fs 存储 + per-user 100MB / per-file 10MB 硬 cap + 「我的素材」管理面板。

**Architecture**:新表 `user_assets` 存元数据,本地 fs `${LUMIDECK_ASSETS_DIR}/<userId>/<assetId>` 存字节。POST/GET/DELETE `/api/uploads` 路由 + 后台 extractor worker(类 image-gen-job)+ tool registry 加 2 个新工具 + createAgent systemPrompt 末尾拼 file inventory。前端 ChatPanel 加拖拽 + paperclip,顶栏加「我的素材」入口。

**Tech Stack**:Hono / Vue 3 / Drizzle / vitest / Playwright(沿用)+ 新依赖:`pdf-parse` / `mammoth` / `xlsx` / `multer`(或 `formidable`)/ `file-type`(magic bytes 检测)。

**预计工作量**:6.5 天(乐观)/ 8 天(含 dogfood)。

---

## 关键设计抉择(2026-05-16 与用户对齐)

1. **per-user 100MB / per-file 10MB 硬 cap**:超额硬 reject,用户清理后立即能传。100MB 够 PPT 场景。**Why**:服务器 disk 有限,简单可预测
2. **本地 fs 存字节,不走 longblob 不走 OSS**:`/var/lumideck/user-assets/<userId>/<assetId>` + DB 存路径。**Why**:longblob 让 RDS 备份膨胀 + OSS 引入云依赖,产品化时再迁
3. **新表 `user_assets`,不扩 `deck_assets`**:per-user pool ≠ per-deck image。两个语义独立,删 deck 不动 user_assets
4. **Vision 走主 LLM 多模态直传(策略 A)**:`read_uploaded_file(id, 'image')` 返 ImageBlock,主 LLM 是 multi-modal 就处理,不是就工具返友好错。**不引入第二个 vision LLM 配置**
5. **音视频本期不做**:hook 留好(worker queue 是 generic),future Phase 13.x 加 ASR worker
6. **后台 extractor 走 worker queue**:上传 API 立即返,worker 异步抽 text。pdf 大 / xlsx 多 sheet 不阻塞上传 response
7. **「我的素材」顶栏入口**:跟「版本历史」「设置」并列。零学习成本
8. **上传即进 pool,不强制 attachment chip**:agent 主动看 file inventory 决定调不调 read 工具

---

## ⚠️ Secrets 安全红线(HARD,沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则))

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- **本 Phase 引入新环境变量**:
  - `LUMIDECK_ASSETS_DIR`(默认 dev=`/tmp/lumideck-assets`,prod=`/var/lumideck/user-assets`)
  - `LUMIDECK_QUOTA_PER_USER_BYTES`(默认 `104857600` = 100MB)
  - `LUMIDECK_QUOTA_PER_FILE_BYTES`(默认 `10485760` = 10MB)
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**
- pre-commit hook(`scripts/check-secrets.sh`)继续起防御作用

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/agent/src/db/schema.ts` `userAssets` 表段 | per-user 上传 asset 元数据 |
| `packages/agent/src/uploads/storage.ts` | fs put / get / delete 抽象 + `LUMIDECK_ASSETS_DIR` env 解析 |
| `packages/agent/src/uploads/quota.ts` | per-user quota sum + 检查超 cap |
| `packages/agent/src/uploads/extractor.ts` | extractor worker(类 image-gen-job 套路)+ 5 type routing |
| `packages/agent/src/uploads/parsers/pdf.ts` | pdf-parse wrapper(maxPages=50) |
| `packages/agent/src/uploads/parsers/docx.ts` | mammoth wrapper |
| `packages/agent/src/uploads/parsers/xlsx.ts` | xlsx wrapper(限 N 行 N 列) |
| `packages/agent/src/uploads/parsers/text.ts` | MD/TXT 直读 + 编码检测 |
| `packages/agent/src/uploads/multi-modal.ts` | `SUPPORTED_MULTI_MODAL_MODELS` set + `isMultiModalLLM` 函数 |
| `packages/agent/src/routes/uploads.ts` | POST/GET/DELETE `/api/uploads` |
| `packages/agent/src/tools/local/list-uploaded-files.ts` | agent tool 实现 |
| `packages/agent/src/tools/local/read-uploaded-file.ts` | agent tool 实现 + multi-modal 检测 |
| `packages/agent/test/integration/uploads-route.test.ts` | uploads 路由集成测 |
| `packages/agent/test/integration/uploads-extractor.test.ts` | 5 parser 真文件 fixture 集成测 |
| `packages/agent/src/uploads/__tests__/multi-modal.test.ts` | isMultiModalLLM 单测 |
| `packages/agent/src/tools/local/__tests__/list-uploaded-files.test.ts` | tool 单测 |
| `packages/agent/src/tools/local/__tests__/read-uploaded-file.test.ts` | tool 单测 |
| `packages/creator/src/composables/useUploads.ts` | upload / list / delete API client |
| `packages/creator/src/components/UploadButton.vue` | ChatPanel sender 区 paperclip + 拖拽 zone |
| `packages/creator/src/components/UploadProgress.vue` | 上传进度 chip |
| `packages/creator/src/components/AssetManagerPanel.vue` | 「我的素材」抽屉/modal |
| `packages/creator/test/UploadButton.test.ts` | 组件测 |
| `packages/creator/test/AssetManagerPanel.test.ts` | 组件测 |
| `packages/creator/test/useUploads.test.ts` | composable 单测 |
| `packages/e2e/tests/file-upload-flow.spec.ts` | E2E 拖拽上传 → list → AI read → 回答引用 |
| `packages/e2e/tests/assets-quota.spec.ts` | E2E 超 quota / 超单文件 friendly error |
| `packages/agent/test/fixtures/sample.pdf` | parser 测试用 fixture |
| `packages/agent/test/fixtures/sample.docx` | 同上 |
| `packages/agent/test/fixtures/sample.xlsx` | 同上 |
| `packages/agent/test/fixtures/sample.png` | 同上 |
| `packages/agent/test/fixtures/sample.md` | 同上 |
| `docs/plans/29-phase13-file-upload-assets.md` | 本文件 |

### 修改

| 文件 | 改动 |
| ---- | ---- |
| `packages/agent/src/db/schema.ts` | 加 userAssets 表 |
| `packages/agent/src/app.ts` | mount `/api/uploads` |
| `packages/agent/src/tools/registry.ts` | 注册 list_uploaded_files + read_uploaded_file |
| `packages/agent/src/llm/agent/index.ts` | createAgent systemPrompt 注入 user assets inventory |
| `packages/agent/src/prompts/buildSystemPrompt.ts` | 加 `buildUserAssetsInventory(userId)` helper |
| `packages/agent/package.json` | 加 `pdf-parse` / `mammoth` / `xlsx` / `multer`(或 `formidable`)/ `file-type` 依赖 |
| `packages/agent/.env.example` + .env.development.local + .env.test.local + .env.production.local | 加 LUMIDECK_ASSETS_DIR / LUMIDECK_QUOTA_PER_USER_BYTES / LUMIDECK_QUOTA_PER_FILE_BYTES |
| `packages/creator/src/components/ChatPanel.vue` | sender 区嵌 UploadButton + 拖拽 zone |
| `packages/creator/src/components/DeckEditorHeader.vue`(或顶栏所在组件) | 加「我的素材」按钮 → 开 AssetManagerPanel |
| `scripts/deploy.sh` | 部署期 `mkdir -p /var/lumideck/user-assets && chown` |

### 删除

(无)

---

## 数据模型变更

### `user_assets` 表

```ts
// packages/agent/src/db/schema.ts
import { mysqlTable, varchar, int, text, timestamp, mysqlEnum, index } from 'drizzle-orm/mysql-core'

export const userAssets = mysqlTable('user_assets', {
  id: varchar('id', { length: 36 }).primaryKey(),  // uuid v4
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 100 }).notNull(),
  sizeBytes: int('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),  // dedup hint,不强制 unique
  storagePath: varchar('storage_path', { length: 500 }).notNull(),  // ${userId}/${id} 相对 LUMIDECK_ASSETS_DIR
  extractedText: text('extracted_text'),
  extractStatus: mysqlEnum('extract_status', ['pending', 'running', 'done', 'failed', 'skipped']).default('pending').notNull(),
  extractErrorMsg: text('extract_error_msg'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (t) => ({
  byUser: index('idx_user_assets_user_id').on(t.userId),
  byUserSha: index('idx_user_assets_user_sha').on(t.userId, t.sha256),
}))

export type UserAsset = typeof userAssets.$inferSelect
export type NewUserAsset = typeof userAssets.$inferInsert
```

drizzle push:
```bash
pnpm -F @big-ppt/agent db:push       # dev
pnpm -F @big-ppt/agent db:push:test  # test
pnpm -F @big-ppt/agent db:push:prod  # prod (deploy 时自动)
```

---

## Task 拆分

### Task A — DB schema + storage layer + quota helper

**目的**:落表 + fs 抽象 + quota 算法,后续 Task 才有基建可用。

**Files**:
- Modify: `packages/agent/src/db/schema.ts`(加 userAssets 表)
- Create: `packages/agent/src/uploads/storage.ts`
- Create: `packages/agent/src/uploads/quota.ts`
- Create: `packages/agent/src/uploads/__tests__/storage.test.ts`
- Create: `packages/agent/src/uploads/__tests__/quota.test.ts`

**操作**:

- [ ] **Step 1**:db schema 加 `userAssets` 表(见上),drizzle push dev + test 库
- [ ] **Step 2**:storage.ts 写 `put(userId, assetId, bytes)` / `get(userId, assetId): Buffer` / `delete(userId, assetId)`。LUMIDECK_ASSETS_DIR env 解析(默认 dev /tmp/lumideck-assets)。put 时确保 dir 存在(`fs.mkdir recursive`)
- [ ] **Step 3**:quota.ts 写 `getUsedBytes(userId): Promise<number>` (SELECT SUM)+ `canUpload(userId, newFileSize): Promise<{ok, reason?}>`(check 单文件 cap + 总 cap)。LUMIDECK_QUOTA_PER_USER_BYTES / LUMIDECK_QUOTA_PER_FILE_BYTES env 读取,默认 100MB / 10MB
- [ ] **Step 4**:写 storage / quota 单测(用 tmp dir + lumideck_test DB)
- [ ] **Step 5**:跑测 + commit

**验收**:
- storage 5 单测(put/get/delete/missing/path 安全)+ quota 4 单测(空 / 单文件超 / 总超 / 边界)全过
- type-check 干净
- dev + test 库 schema 推完

**风险**:
- fs.mkdir recursive 在 Linux + macOS 行为是否一致 — 用 `{ recursive: true }` 兼容
- LUMIDECK_ASSETS_DIR 不存在或权限 — put 时 throw clear error,deploy 脚本兜底 mkdir

---

### Task B — uploads API + mime 白名单 + 集成测

**目的**:POST/GET/DELETE `/api/uploads` 端到端跑通,带 quota check + magic-bytes mime 检测 + 集成测覆盖 boundary。

**Files**:
- Create: `packages/agent/src/routes/uploads.ts`
- Modify: `packages/agent/src/app.ts`(mount)
- Create: `packages/agent/test/integration/uploads-route.test.ts`
- Modify: `packages/agent/package.json`(加 multer / formidable + file-type 依赖)

**操作**:

- [ ] **Step 1**:依赖选型 + 安装:multer vs formidable — multer 跟 Express 紧绑,Hono 用 formidable 或原生 Web Streams 解 multipart。**用 formidable + Hono `c.req.parseBody`** 看哪个更轻
- [ ] **Step 2**:POST `/api/uploads` 路由:
  - 鉴权(requireAuth)
  - parse multipart 拿 file buffer + filename + mime
  - magic-bytes 用 `file-type` 包 verify mime(防 .exe 伪装成 .pdf)
  - mime 白名单 check:`application/pdf` / `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx) / `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx) / `text/csv` / `image/png` / `image/jpeg` / `image/gif` / `text/markdown` / `text/plain`
  - quota check(canUpload)→ 413 if 超
  - 生 assetId(uuid v4)+ sha256 算 hash
  - storage.put + DB insert(extractStatus='pending')
  - 触发 extractor.enqueue(assetId)(异步,不 await)
  - 返 `{asset, quota}`
- [ ] **Step 3**:GET `/api/uploads` 路由:返当前 user 所有 user_assets 行 + 当前 quota
- [ ] **Step 4**:GET `/api/uploads/:id` 路由:鉴权 + 跨用户 403 + 找不到 404 + stream 字节,Content-Type 跟 DB mime
- [ ] **Step 5**:DELETE `/api/uploads/:id` 路由:storage.delete + DB delete + 返新 quota
- [ ] **Step 6**:app.ts mount `app.route('/api/uploads', uploads)`
- [ ] **Step 7**:写 9~12 个集成测(真 lumideck_test DB + fixture 文件):
  - 未登录 401
  - 上传成功 200 + 返 asset shape
  - 单文件超 10MB 413 file-too-large
  - 总超 100MB 413 quota-exceeded
  - 非白名单 mime 415 unsupported-mime
  - magic-bytes 不匹配 415(.exe 假装 .pdf)
  - list 返当前 user 所有 + 不返其他 user 的
  - GET asset bytes 正确 + 跨 user 403
  - DELETE 删 fs + DB + 返新 quota
- [ ] **Step 8**:跑测 + commit

**验收**:
- 9~12 集成测全过
- type-check + lint 干净
- 真 fixture 文件能跑通完整链路

**风险**:
- multipart 解析在 Hono 上的边角 — 用 Hono `c.req.parseBody()` 看是否够用,不够换 formidable
- file-type 包对部分 mime 检测不准 — fallback 看 filename 后缀

---

### Task C — Extractor worker + 5 parser + 集成测

**目的**:后台 extractor worker queue + 5 type parser + 真文件 fixture 验证。

**Files**:
- Create: `packages/agent/src/uploads/extractor.ts`
- Create: `packages/agent/src/uploads/parsers/pdf.ts`
- Create: `packages/agent/src/uploads/parsers/docx.ts`
- Create: `packages/agent/src/uploads/parsers/xlsx.ts`
- Create: `packages/agent/src/uploads/parsers/text.ts`
- Create: `packages/agent/test/integration/uploads-extractor.test.ts`
- Modify: `packages/agent/package.json`(pdf-parse / mammoth / xlsx)

**操作**:

- [ ] **Step 1**:依赖装:`pdf-parse` / `mammoth` / `xlsx`
- [ ] **Step 2**:parsers/pdf.ts:`parsePdf(buffer): Promise<{text, pageCount}>`,maxPages=50,超 truncate 加「... 省略 N 页」尾标
- [ ] **Step 3**:parsers/docx.ts:`parseDocx(buffer): Promise<string>`,mammoth 抽 markdown / plain text
- [ ] **Step 4**:parsers/xlsx.ts:`parseXlsx(buffer): Promise<string>`,每个 sheet → JSON.stringify 友好格式,限 N 行 N 列(配置 200 行 / 50 列)
- [ ] **Step 5**:parsers/text.ts:`parseText(buffer): Promise<string>`,UTF-8 / GBK 编码检测
- [ ] **Step 6**:extractor.ts:
  - 进程内 queue + worker pool(concurrency 3,follow image-gen-job 套路)
  - `enqueue(assetId)`(non-blocking)
  - worker:read fs → mime routing → parser 调用 → update DB extractedText + extractStatus='done'
  - 失败:status='failed' + extractErrorMsg 写错文
  - Image 不入 queue,直接 status='skipped'
  - timeout 30s per job
- [ ] **Step 7**:测试 fixture(真 PDF / DOCX / XLSX / PNG / MD)放 `packages/agent/test/fixtures/`
- [ ] **Step 8**:集成测 8~12 个:
  - 5 type 都正确抽 text
  - PDF 超 50 页 truncate 正常
  - XLSX 多 sheet 处理
  - Image 类 status=skipped
  - parser 抛错 → status=failed + errorMsg 持久化
  - timeout 触发 status=failed
- [ ] **Step 9**:跑测 + commit

**验收**:
- 8~12 集成测全过
- 5 fixture 文件抽出来内容跟预期匹配
- worker timeout / 失败兜底正常

**风险**:
- pdf-parse 大文件吃 RAM — maxPages=50 缓解 + timeout 兜底
- xlsx 包大(几 MB)— 静态 import + tree-shaking 看是否 OK
- 编码检测:用 chardet 或 iconv-lite 简单 fallback

---

### Task D — Agent tools(list + read)+ multi-modal detect + 单测

**目的**:tool registry 加两个新工具,read_uploaded_file 检测主 LLM multi-modal 能力。

**Files**:
- Create: `packages/agent/src/tools/local/list-uploaded-files.ts`
- Create: `packages/agent/src/tools/local/read-uploaded-file.ts`
- Create: `packages/agent/src/uploads/multi-modal.ts`
- Modify: `packages/agent/src/tools/registry.ts`(注册)
- Create: `packages/agent/src/uploads/__tests__/multi-modal.test.ts`
- Create: `packages/agent/src/tools/local/__tests__/list-uploaded-files.test.ts`
- Create: `packages/agent/src/tools/local/__tests__/read-uploaded-file.test.ts`

**操作**:

- [ ] **Step 1**:multi-modal.ts:hardcode `SUPPORTED_MULTI_MODAL_MODELS` set(参 spec §9)+ `isMultiModalLLM(provider, model)` 函数 + 单测覆盖每个 known provider
- [ ] **Step 2**:list-uploaded-files.ts:
  - 入参:无
  - 走 request-context 拿 userId(ALS)
  - SELECT 该 user 所有 user_assets
  - 返 `{files: [{id, filename, mime, sizeBytes, extractStatus, summary:extractedText.slice(0,200)}]}`
- [ ] **Step 3**:read-uploaded-file.ts:
  - 入参:`{id: string, mode?: 'text'|'image'}`(默认 text)
  - 验所有权:asset.userId === currentUser.id 否则 not-found error
  - text mode:
    - extractStatus='pending' → `{success:false, error:'还在处理,稍后再试'}`
    - extractStatus='failed' → `{success:false, error: extractErrorMsg}`
    - extractStatus='skipped'(image 类)→ `{success:false, error:'image 类型只能 mode=image'}`
    - extractStatus='done' → `{success:true, content: extractedText}`
  - image mode:
    - asset 非 image mime → `{success:false, error:'非 image 类型,用 mode=text'}`
    - 主 LLM 非 multi-modal → `{success:false, error:'主 LLM 不支持图片,切换到 Claude/Gemini/GPT/GLM-5v 后重试'}`
    - 否则 read fs bytes + base64 → 返 canonical ImageBlock `{success:true, image:{mediaType, dataBase64}}`
- [ ] **Step 4**:registry.ts 注册两 tool(tool name + description + inputSchema + exec)
- [ ] **Step 5**:单测覆盖:list 1~3 case;read text 5 case(各 status)+ read image 3 case(类型不对 / 主 LLM 不支持 / 成功)+ 跨用户 not-found
- [ ] **Step 6**:跑测 + commit

**验收**:
- 12~16 单测全过
- multi-modal detect 对 12 个 provider 各自至少 1 known model 全验

**风险**:
- 主 LLM model id 命名不稳定(用户配 "gpt-5.5-experimental" 之类)— SUPPORTED set 加宽松前缀匹配兜底
- ALS userId 拿不到(测试场景)— 测试用 explicit context injection

---

### Task E — System prompt 拼 inventory + createAgent 集成

**目的**:createAgent factory 在 systemPrompt 末尾自动拼当前用户的 file inventory,让 agent 主动看到用户传了啥。

**Files**:
- Modify: `packages/agent/src/prompts/buildSystemPrompt.ts`(加 `buildUserAssetsInventory` helper)
- Modify: `packages/agent/src/llm/agent/index.ts`(createAgent 调 helper 拼 prompt)
- Modify: `packages/agent/src/llm/agent/__tests__/agent.test.ts`(单测扩)

**操作**:

- [ ] **Step 1**:buildSystemPrompt.ts 加 `buildUserAssetsInventory(userId, activeProvider, model): Promise<string>` helper:
  - 查 user_assets WHERE user_id = ?
  - 算 multi-modal 能力 boolean
  - 返字符串:
    ```
    用户当前上传的参考素材(共 N 个,总 X MB):
    - report.pdf (PDF, 1.2MB, 已抽 8200 字)
    - logo.png (image/png, 80KB)
    - data.xlsx (XLSX, 50KB, 已抽 3 sheet)

    工具:list_uploaded_files / read_uploaded_file(id, mode='text'|'image')
    当前主 LLM: zhipu/glm-5.1 — ✗ 不支持图片,只能读 text 类素材
    ```
- [ ] **Step 2**:createAgent index.ts 在 buildSystemPromptForDeck 之后 append `buildUserAssetsInventory` 结果到 systemPrompt
- [ ] **Step 3**:更新 createAgent 单测覆盖:
  - 无 assets → inventory 段不输出
  - 有 assets + multi-modal LLM → "✓ 支持图片" 注解
  - 有 assets + 非 multi-modal → "✗ 不支持图片" 注解
- [ ] **Step 4**:跑测 + commit

**验收**:
- agent.test.ts 新增 3~5 测全过
- systemPrompt snapshot 符合预期

**风险**:
- file inventory 太长占用 system prompt token — 设上限,只显示最近 N 个 + summary 截短
- 用户上传 100 个文件时 token 爆 — 列表压缩成「共 N 个,XX MB」让 agent 自己调 list 工具拿明细

---

### Task F — Frontend UploadButton + AssetManagerPanel + ChatPanel 集成

**目的**:ChatPanel 加 paperclip + 拖拽上传 + 上传进度;顶栏加「我的素材」入口;AssetManagerPanel 抽屉显示列表 + 容量条 + 删除。

**Files**:
- Create: `packages/creator/src/composables/useUploads.ts`
- Create: `packages/creator/src/components/UploadButton.vue`
- Create: `packages/creator/src/components/UploadProgress.vue`
- Create: `packages/creator/src/components/AssetManagerPanel.vue`
- Modify: `packages/creator/src/components/ChatPanel.vue`(嵌 UploadButton + 拖拽 zone)
- Modify: `packages/creator/src/components/DeckEditorHeader.vue` 或顶栏组件(加「我的素材」按钮)
- Create: `packages/creator/test/UploadButton.test.ts`
- Create: `packages/creator/test/AssetManagerPanel.test.ts`
- Create: `packages/creator/test/useUploads.test.ts`

**操作**:

- [x] **Step 1**:useUploads.ts:`uploadFile(file): Promise<UploadResult>` + `listAssets(): Promise<{assets, quota}>` + `deleteAsset(id): Promise<{quota}>` API client
- [x] **Step 2**:UploadButton.vue:paperclip 按钮(lucide `Paperclip`)+ file picker(multiple)+ 拖拽 zone(drop event handler);accept 9 type mime。多模态 LLM 检测 frontend mirror 不做(backend `read_uploaded_file` image tool 真鉴权,frontend 仅 paperclip 入口不限制)
- [x] **Step 3**:UploadProgress.vue:单文件 chip(filename + size + ↑/✓/✕ icon)。ChatPanel 内自管 chip 列表(最近 8 次,done 后 2.5s 自动消失)
- [x] **Step 4**:AssetManagerPanel.vue:
  - 容量条头:已用 / 限制 + 警告 if >90%
  - 列表:filename / mime / size / 上传时间 / extract status / 删除
  - 空状态:「还没上传任何素材」
  - 走 Teleport modal-overlay 沿用 SettingsModal 风格(没用 antdv Drawer,跟 Settings 一致更协调)
- [x] **Step 5**:ChatPanel.vue 集成:sender 左侧嵌 UploadButton,sender-area 整个接 dragover/drop event,上传进度 chip 显示在 sender 上方
- [x] **Step 6**:DeckEditorCanvas 顶栏(实际不是 DeckEditorHeader,而是 DeckEditorCanvas 内 inline header)加「我的素材」按钮(lucide `FolderOpen`)→ 打开 AssetManagerPanel
- [x] **Step 7**:组件 + composable 测试(实际 22 case,>11~16 目标):
  - UploadButton 5 case(渲染 / 点击 / change / drop / 错误)
  - UploadProgress 3 case(uploading / done / error)
  - AssetManagerPanel 7 case(空 / 3 资产 / quota <90% / quota >90% / 删除 / 取消删除 / 关闭)
  - useUploads 7 case(uploadFile happy / 413 错 / uploading ref / listAssets / listAssets 错 / deleteAsset / delete 错)
- [x] **Step 8**:跑测 + commit(我的 frontend 文件被 Task B 的 parallel commit `f723a54` 顺带带上落库,内容完整、测试 22/22 过;commit message 误挂 Task B 标签但 diff 全是 creator/ 下文件,后续在 Task G close-out 章节说明这次 parallel commit 撞车经历)

**验收**:
- 11~16 组件 + 单测全过
- type-check 干净
- 手测 dev 拖拽 + 「我的素材」面板 OK

**风险**:
- multi-modal frontend mirror 跟 backend 不同步 — backend 是 source of truth,frontend 仅 hint;真鉴权在 read_uploaded_file image tool 内
- 拖拽事件冒泡 — sender 内的子元素(input)拦截 drop,要明确 handler 范围
- 多文件并发上传 — 串行 fetch 简化,不做 batch 一上传几十个

---

### Task G — E2E + dogfood + close-out

**目的**:Playwright 端到端验拖拽上传 → 列表 → AI read → 回答含文件引用;plan close-out 三章节填完 + roadmap Phase 13 ✅ + CLAUDE.md 提炼。

**Files**:
- Create: `packages/e2e/tests/file-upload-flow.spec.ts`
- Create: `packages/e2e/tests/assets-quota.spec.ts`
- Modify: `packages/e2e/tests/helpers/db.ts`(加 user_assets 相关 helper)
- Modify: `docs/plans/29-phase13-file-upload-assets.md`(close-out 三章节)
- Modify: `docs/requirements/roadmap.md`(Phase 13 ✅)
- Modify: `CLAUDE.md`(提炼新坑)

**操作**:

- [x] **Step 1**:file-upload-flow.spec.ts(用 .md 不用 .pdf,extractor 路径同样跑通,GLM_TEST_KEY=... 真打 26s 过)
- [x] **Step 2**:assets-quota.spec.ts(3 case 全过,playwright.config 收紧 quota 到 50KB/10KB)
- [x] **Step 3**:helpers/db.ts truncateAllTables 加 `user_assets`(原 plan 假设要新加查询 helper,实际已存在的 helper 足够,只补 TRUNCATE 列表即可)
- [x] **Step 4**:dev dogfood:用户已 dogfood + plan 跑通,不重复罗列 5 场景(file-upload-flow 真打覆盖 .md 路径 + tool-chain)
- [x] **Step 5**:close-out 三章节填完(见下)
- [x] **Step 6**:roadmap.md Phase 13 ✅
- [x] **Step 7**:CLAUDE.md 加 2 条新坑(Aliyun TRUNCATE + parallel agent git)
- [x] **Step 8**:跑全套(agent 946 / creator 245 / shared 3 / e2e 24 spec)+ commit
- [x] **Step 9**:tool-count 测 10 → 12 + scripts/deploy.sh mkdir user-assets dir + prod 部署
- [x] **Step 10**:final push origin

**验收**:
- 2 E2E spec 全过(quota 场景必跑;file-upload-flow 真打需 GLM_TEST_KEY)
- 全套 agent + creator test 不退步
- roadmap + CLAUDE.md + plan 29 三章节填完
- prod healthz 200

**风险**:
- E2E real-key 真打慢 — 设 test.setTimeout(180_000)
- prod 部署引入 user_assets 新表 + LUMIDECK_ASSETS_DIR env,deploy 脚本需同步 mkdir
- 老用户(无任何 asset)inventory 段省略,prompt 干净

---

## 验收条件(roadmap.md Phase 13 清单映射)

- [ ] user_assets 表 drizzle push 到 dev / test / prod 库
- [ ] POST/GET/DELETE /api/uploads 跑通 +9~12 集成测全过
- [ ] 5 type parser(PDF/DOCX/XLSX/MD/TXT/Image-skip)+ extractor worker queue + 8~12 集成测
- [ ] list_uploaded_files / read_uploaded_file 两 tool + 12~16 单测;multi-modal LLM 检测覆盖 12 provider
- [ ] createAgent systemPrompt 自动拼 user assets inventory + 单测扩 3~5 case
- [ ] ChatPanel paperclip + 拖拽 + UploadProgress 上传 + AssetManagerPanel 顶栏入口 + 容量条 + 11~16 组件测
- [ ] 2 E2E spec(file-upload-flow + assets-quota)
- [ ] type-check / lint / build / 全测试套 全绿
- [ ] 浏览器手验 5 场景全过
- [ ] prod healthz 200 + LUMIDECK_ASSETS_DIR 路径权限 OK
- [ ] plan 29 close-out 三章节 + CLAUDE.md 已知坑(如有)+ roadmap Phase 13 ✅

---

## 不做什么(范围围栏)

- ❌ 音频文件(ASR / 转录)— Phase 13.x 候选
- ❌ 视频文件 — Phase 16+ 候选
- ❌ PPTX 导入 — Phase 15 单独
- ❌ 品牌 asset 持久化(跨 deck 复用 logo / 配色)— Phase 13.5 候选
- ❌ Vision LLM 独立配置(Settings 第 4 tab)— 走主 LLM 多模态直传
- ❌ OSS / S3 远程存储 — 产品化时再迁
- ❌ MCP catalog 扩展(原 Phase 13 主题)— 降级 Phase 13.5 候选
- ❌ 图片精确分析 mode(逐像素 / OCR / 物体检测)— multi-modal LLM 自身能力够
- ❌ 文件版本管理 / 重命名后再上传 — 上传即唯一

---

## 执行期偏离(关闭后追加)

> 实际跑下来与 plan 不一致的点,写清"原 plan 怎么说 / 实际怎么做 / 为什么改"。

- **测试文件位置:plan 说 `__tests__/`,实际落 `test/` 顶层** ——
  - plan Task A/D 写「`packages/agent/src/uploads/__tests__/storage.test.ts`」、「`packages/agent/src/tools/local/__tests__/list-uploaded-files.test.ts`」放 sibling `__tests__/` 目录
  - 实际 Task D 的两个 tool 单测落 `packages/agent/test/tools-list-uploaded-files.test.ts` 跟 `tools-read-uploaded-file.test.ts`,跟整仓 vitest config 的 `test/**` 主测试目录对齐(uploads-quota.test.ts / uploads-route.test.ts 都在那)
  - 改的原因:Task D agent 在 fresh session 跑时按已有 agent 测试惯例落盘,跟 plan 抽象的 sibling 写法不一致,但更符合主流仓库布局;无功能影响
- **pdf-parse 2.x API 跟 plan 假设的不一致** ——
  - plan Task C Step 2 写「`parsePdf(buffer): Promise<{text, pageCount}>`」,基于 pdf-parse 1.x 的函数式 API 假设
  - pdf-parse 2.x 实际是 `new PDFParse({data: Uint8Array}).getText({first: N})` 类实例 API,返 `{text, pages, total}`,且必须 `await parser.destroy()` 释放 pdfjs worker handle
  - parsers/pdf.ts 实际签名改成 `parsePdf(buffer): Promise<string>`(直接返 truncated text,callers 不再需要 pageCount)
- **三任务并行 fresh agent commit 错位** ——
  - 走 `superpowers:subagent-driven-development` 同 worktree 起 3 fresh agent 并行做 Task A/B/F 时,Task F 的所有 creator 文件在 commit `f723a54` 被 Task B 的 `git add packages/` 一并带走;commit message tag `feat(phase13-B)` 实际 diff 含 Task F 全部 frontend 文件(UploadButton / AssetManagerPanel / useUploads / 22 case 单测)
  - 代码本身完整且测试全过,只是 commit message 跟内容错位 → 已在 0c4bb8a `docs(phase13-F)` 加 plan Step 8 说明
  - 防再犯:**3+ agent 并行写不同 task 必走 `git worktree`**,见 CLAUDE.md 已知坑新增条目
- **TRUNCATE → DELETE 迁移** ——
  - plan 没要求改 `test/_setup/test-db.ts`,但 Task C 集成测真跑后偶发 "asset not found / FK 违反 / 401" flake(600 跑 ~2-4 failed)
  - 根因:Aliyun RDS prepared-statement stale plan(详见踩坑章节)
  - 修复落 commit `e5e1a0b`:8 张表的 TRUNCATE 全改 DELETE FROM + 加详细注释
- **upload 路由 enqueueExtraction wiring 漏掉,Task G 补上** ——
  - plan Task B Step 5 没明说要在路由内 enqueue,只说「写 DB row」;Task C 的 extractor 只 export `enqueueExtraction` 但 routes/uploads.ts 留了 `// TODO Task C: 异步触发 enqueue` 没补
  - 后果:dev 起 webserver 上传任何非 image 文件后,extractStatus 永远停在 'pending',`read_uploaded_file` 工具一律返「还在处理,稍后再试」,file-upload-flow E2E 没法过
  - Task G 补上 `routes/uploads.ts:115` 加 `if (!isImage) enqueueExtraction({assetId, userId, mime})`;同步 `uploads-route.test.ts` 的 DB-row assert 改成 `expect(['pending','running','failed','done']).toContain(row?.extractStatus)` 容忍异步 race

---

## 踩坑与解决(实施期 / 关闭后追加)

> 按「症状 / 根因 / 修复 / 防再犯」四段记完整故事。

### 1. Aliyun RDS `TRUNCATE` + mysql2 prepared-statement → 静默返空,集成测 flake

- **症状**:Phase 13 三 fresh agent 并行跑完后,合并跑 `pnpm -F @big-ppt/agent test` 偶发 2-9 个 fail,全集中在 routes-auth / mcp-server-repo / llm-models / uploads-extractor 文件,断言形如「INSERT user → 立即 SELECT 空」或「createSessionFor FK violation」;同一个测试单独跑必过,跟其他测一起跑必坏。重跑 600 次有 ~2-4 次复现
- **根因**:agent 测共享 lumideck_test 库,`test-db.ts` 用 `TRUNCATE TABLE` 8 张表清数据。drizzle 走 mysql2 `pool.execute()` 是 prepared-statement(server-side prepare + bind 参数)。InnoDB 下 TRUNCATE 相当于 drop+recreate 表,**服务器把之前 prepared 的 plan 标记失效**。标准 MySQL 此时会让客户端拿到 re-prepare 提示并 retry,但 **Aliyun RDS 代理层把这个失效信号吞掉**,prepared-statement 不报错也不重 prepare,直接拿 stale plan 跑 → INSERT 看似成功但**实际行没落表**,后续 immediate SELECT 返 empty
- **修复**:commit `e5e1a0b` 把 `test/_setup/test-db.ts` 的 `TRUNCATE TABLE x` 全部改成 `DELETE FROM x`。DELETE 不改表结构 → prepared plan 仍有效。副作用:不 reset AUTO_INCREMENT(测试全用动态 user.id,不依赖固定 id)。reproducer 600 跑 0 失败
- **防再犯**:新写 test setup **不要用 `TRUNCATE TABLE`**,统一 `DELETE FROM`;或切到 `pool.query()` 非 prepared-statement 模式(性能差,不推荐)。已加进 CLAUDE.md 「测试基建」节

### 2. subagent-driven-development 多 agent 共享 worktree → git staging 错位

- **症状**:Phase 13 走 subagent-driven plan 时,起 3 fresh agent 同一个 worktree 并行做 Task A/B/F。Task B agent 完成后跑 `git add packages/` commit `f723a54` 标记「feat(phase13-B): POST/GET/DELETE /api/uploads + 14 集成测」,但实际 diff 含 Task F 的 UploadButton.vue / AssetManagerPanel.vue / useUploads.ts + 22 case 单测(明显是 frontend);Task F agent 跑完发现自己要 commit 的文件已经被前一 agent 顺走
- **根因**:3 agent 同 cwd 共享同一份 git index(staging 区是单一 state),并发 `git add packages/` 把别的 agent 还在编辑的文件一并暂存。git 没有任何 staging-area-per-shell 的隔离
- **修复**:本次容忍 commit message tag 跟内容错位(代码本身完整、测试全过,只是不方便事后看 git log 找哪个 commit 对应 Task F)。在 0c4bb8a `docs(phase13-F)` 把这次撞车经历写进 plan Task F Step 8
- **防再犯**:**3+ agent 并行不同 task 必走 `git worktree`**,每个 agent 单独 worktree 单独 git index;或退一步分**串行** commit window,前一 agent commit + push 完后一 agent 才开始。见 `superpowers:using-git-worktrees` skill,已加进 CLAUDE.md

### 3. uploads 路由忘了 wire extractor,Phase 13 上线即「pending 永远不变 done」

- **症状**:Task B 落 `routes/uploads.ts` 时只写 DB row,留 `// TODO Task C:enqueueExtraction` 字样未补;Task C 写完 extractor module 也没回头 wire 路由;Task G 编 file-upload-flow E2E 真跑时发现轮询 `GET /api/uploads` 永远拿 `extractStatus:'pending'`,直接导致 read_uploaded_file 工具一律返「还在处理」
- **根因**:plan Task B Step 5 没写「enqueueExtraction」,Task C Step 6 写了 enqueue 函数但没明说要在哪 wire;两个 fresh agent 各自做自己 task 边界以内的事,没 cross-task 改对方文件的反射
- **修复**:Task G 补 `routes/uploads.ts` 加一行 `if (!isImage) enqueueExtraction({assetId, userId: user.id, mime: finalMime})`;`uploads-route.test.ts` DB-row assert 改成宽容 enum 容忍异步 race;e2e file-upload-flow 加 30s `expect.poll` 等 `extractStatus === 'done'`
- **防再犯**:跨 fresh agent task 共享接口(像 `enqueueExtraction` export)的,**plan 写 caller side 时必须明示「import + 调用点」**。或在 Task G close-out 做 cross-task 集成测试时务必端到端跑一次完整 upload → extract → tool-read 链路(本次跑通了所以 catch 到)

---

## 测试数量落地(关闭后追加)

| 指标 | 起点(Phase 12.7 + dogfood + testing-sprint 后) | 终点(Phase 13 完) | 增量 |
| ---- | ---- | ---- | ---- |
| agent unit (含集成) | 878(76 files,6 skip) | 946(81 files,6 skip) | +68 / +5 file |
| creator unit | 223(25 files) | 245(29 files) | +22 / +4 file |
| shared unit | 3(1 file) | 3(1 file) | 维持 |
| smoke test | 6(3 files, 默认 skip) | 6(3 files,默认 skip) | 维持 |
| E2E specs | 22 files | 24 files | +2(file-upload-flow + assets-quota) |
| coverage lines | agent 90 / creator 75 | 同 | 维持 |
| coverage branch | agent 80 / creator 65 | 同 | 维持 |
| 新 uploads / parser per-file coverage | — | ≥ 90/85 | — |

**E2E 新加 2 specs 跑通**:
- `assets-quota.spec.ts` 3/3 case 全过(per-file 413 + per-user 413 + AssetManagerPanel 删除)— 不需要真 LLM
- `file-upload-flow.spec.ts` 1/1 case 全过(GLM_TEST_KEY 注入后真打)— 完整链路:注册 → 建 deck → 配 GLM key → 上传 .md → 等 extractor done(30s 内) → chat 引用 → 断言 assistant 回复含文件内 `PhaseThirteenSecretToken2026` deterministic token
