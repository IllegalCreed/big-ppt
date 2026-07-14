# Phase 13 Spec — 文件上传 + 引用 + 用户级 Asset 管理

> 状态：Design 已对齐（2026-05-16），待用户审阅 → 进入 writing-plans
> 关联 roadmap：[`docs/requirements/roadmap.md`](../../requirements/roadmap.md) Phase 13
> 前置：Phase 12.7 ✅(pi-agent-core backend agent runtime)
> 后续：Phase 13.5 候选(MCP catalog 自 host search wrapper,推迟到 dogfood 出痛点再启) / Phase 14 导出
> 编号：roadmap 原 Phase 13「MCP catalog 扩展」改写成本主题(用户 2026-05-16 拍板:不要本地 stdio MCP,HTTP 生态太瘦,先做文件上传更高 ROI;MCP catalog 仍可后续接 Brave Search 类直连 HTTP wrapper)
> **后续决策（2026-07-11）**：Markdown / PPTX 外部格式导入永久不做，本决策覆盖设计期的原阶段关系。

## 1. 目标

让 PPT-agent 用户能上传 **PDF / DOCX / XLSX / Image / MD / TXT** 文件作为参考素材,agent 通过新工具 `list_uploaded_files` + `read_uploaded_file` 读取文件内容(image 类直接以 multi-modal block 喂主 LLM)。配套做用户级 asset 管理面板(列表 / 删除 / 容量条) + per-user 100MB 存储 cap + 10MB 单文件 cap。

**为什么做**:用户使用 PPT-agent 的最高频起点是「我有一份 PDF/报告/数据表,做成 PPT」。当前 agent 完全没有「读用户给的素材」能力——只能凭文本描述生成。这是产品的 P0 能力差距。

**为什么不走 MCP**:MCP 适合外部 SaaS(状态在外),用户上传的文件状态在我们这边,做成原生 tool 更直接。MCP 生态目前 99% 是 stdio,用户明确不要本地跑 MCP,HTTP MCP 候选太少不值得本 phase 投入。

## 2. 不做什么(范围围栏)

- ❌ **音频文件**:不接 ASR(Whisper / 通义听悟),不做语音转文字。低频场景,留 Phase 13.x 候选
- ❌ **视频文件**:不抽帧 / 不做 video understanding。罕见场景,留 Phase 16+ 候选
- ❌ **PPTX 外部格式导入**：2026-07-11 产品决策，永久不做
- ❌ **品牌 asset 持久化**(用户级 logo / 配色 / 字体跨 deck 复用):Phase 13.5 候选,先看 user_assets 单一池的 dogfood 反馈
- ❌ **Vision LLM 独立配置**:不加 Settings 第 4 tab。主 LLM 是 multi-modal 就走主 LLM,不是就提示用户切;不引入新 vision provider 概念
- ❌ **OSS / S3 远程存储**:本地 fs 路径起步,产品化时再迁。本 phase 不引入新云服务依赖
- ❌ **MCP catalog 扩展**:从 roadmap 原 Phase 13 主题剥离,延后到 Phase 13.5 候选
- ❌ **图片精确分析 mode**(逐像素 / 文字 OCR / 物体检测):不做。multi-modal LLM 自身能力够用
- ❌ **文件版本管理 / 重命名后再上传**:上传即唯一,只删不改

## 3. 验收条件

- [ ] 用户可在 ChatPanel 拖拽 / paperclip 按钮上传文件(PDF/DOCX/XLSX/Image/MD/TXT)
- [ ] 上传超 10MB 单文件 → 友好错(413)+ UI 拒绝
- [ ] 用户总存储超 100MB → 友好错(413)+ UI 链到「我的素材」让用户清理
- [ ] 后台 extractor 自动抽 PDF/DOCX/XLSX/MD/TXT 文本内容,Image 不抽
- [ ] Agent 工具 `list_uploaded_files()` 返回当前用户全部 assets(id / filename / mime / size / 摘要)
- [ ] Agent 工具 `read_uploaded_file(id, mode='text'|'image')` 返回内容:text mode 返 extractedText;image mode 返 multi-modal ImageBlock(base64)
- [ ] 主 LLM 非 multi-modal(GLM-5.1 等)+ image read → 工具返友好错 + agent 给用户 actionable 提示
- [ ] 「我的素材」顶栏按钮 → 抽屉 / modal 列表所有 assets + 已用容量条 + 单条删除
- [ ] 删除 asset:从 fs 删字节 + DB 删 row + 容量条同步降
- [ ] User 删账号 / deck cascade 不动 user_assets(它是 per-user 不是 per-deck)
- [ ] 5 type extractor 单测 + upload/list/delete API 集成测 + ChatPanel 拖拽 E2E + 「我的素材」面板组件测齐套
- [ ] dev / prod fs 路径区分(用 env LUMIDECK_ASSETS_DIR,默认 dev=`/tmp/lumideck-assets`,prod=`/var/lumideck/user-assets`)
- [ ] Phase 13 close-out + plan 29 三章节(偏离 / 踩坑 / 测试数量)+ roadmap Phase 13 ✅ + CLAUDE.md 提炼(如有新坑)

## 4. Architecture

```
[ChatPanel drag-drop + paperclip 📎]      [顶栏「我的素材」按钮 → drawer/modal]
              │                                            │
              ▼                                            ▼
   POST /api/uploads (multipart)              GET /api/uploads (list)
              │                              DELETE /api/uploads/:id
   [size + quota + mime whitelist check]
              │
              ▼
   存 fs: ${LUMIDECK_ASSETS_DIR}/<userId>/<assetId>
   存 DB: user_assets {id, userId, filename, mime, sizeBytes, sha256,
                       storagePath, extractedText, uploadedAt}
              │
              ▼
   后台 extractor worker(queue,跟 image-gen-job 同套路)
   ├ PDF → pdf-parse → extractedText
   ├ DOCX → mammoth → extractedText
   ├ XLSX → xlsx → JSON.stringify(structured) → extractedText
   ├ MD/TXT → 直接读 → extractedText
   └ Image → 跳过(等 agent read 时 base64 喂主 LLM)

[Agent tool registry 新加 2 工具]
   ├ list_uploaded_files() → {id, filename, mime, sizeBytes, summary?}[]
   └ read_uploaded_file(id, mode) →
       ├ mode='text' → 返 extractedText(truncate 防爆 token)
       └ mode='image' → 返 ImageBlock(mediaType + dataBase64)
                       (前置检查:主 LLM multi-modal 能力,不支持就返 error)

[System prompt 拼 file inventory]
   createAgent factory 在 systemPrompt 末尾拼:
   「用户当前上传的参考素材:
     - report.pdf (PDF, 1.2MB, 已抽 8000 字)
     - logo.png (image/png, 80KB)
   你可以用 list_uploaded_files / read_uploaded_file 工具读取。」
```

## 5. 关键设计抉择(2026-05-16 与用户对齐)

1. **per-user 100MB / per-file 10MB 硬 cap,超额硬 reject**
   - **Why**:服务器 disk 空间有限(单 ECS,无 OSS);硬 cap 简单且可预测;用户清理后立即能传。100MB 够大部分 PDF 场景(20~30 个中等 PDF),10MB 单文件防滥用

2. **本地 fs 存字节 + MySQL 存元数据,不走 longblob 不走 OSS**
   - **Why**:longblob 让 RDS 备份膨胀 + 出流量贵;OSS 引入新云依赖 + 数据出境;本地 fs 最简单,deploy 脚本同步即可,prod 产品化时再迁 OSS。env `LUMIDECK_ASSETS_DIR` 留迁移钩子

3. **新表 `user_assets`,不扩 `deck_assets`**
   - **Why**:`deck_assets` 是 per-deck(image-gen worker 生成,跟 deck 生死),`user_assets` 是 per-user(用户自上传,跨 deck 复用)。两个语义独立。删 deck 不动 user_assets;删 user 才 cascade

4. **Vision 走主 LLM 多模态直传(策略 A),不缓存 caption**
   - **Why**:用户 2026-05-16 拍板。简单一致——agent read_uploaded_file image mode 直接吐 ImageBlock 给主 LLM,主 LLM 是 multi-modal 自然处理。非 multi-modal LLM(GLM-5.1 等)前端 + 工具双重提示「需切到 Claude/Gemini/GPT/GLM-5v-turbo」。**不引入第二个 vision LLM 配置**

5. **音频 / 视频本期不做**
   - **Why**:用户拍板。ASR + 视频抽帧成本/复杂度高,实际 PPT 场景频次低。hook 留好(worker queue 是 generic 的,future ASR worker 可挂同套架构),但本期不投资

6. **后台 extractor 走 worker queue(类 image-gen-job),上传 API 立即返**
   - **Why**:PDF 大可能 2~5s 抽完,XLSX 几百 KB 也可能慢。同步阻塞上传 response 体验差。worker 跑完写 `extractedText` 回 DB,UI 不需要主动刷(用户提到该 asset 时 list 工具会拿到新数据)

7. **「我的素材」入口在顶栏(跟「版本历史」「设置」并列),不嵌 ChatPanel**
   - **Why**:per-user 资产是 lifetime concept,跟 deck 编辑器分开管。顶栏按钮 + 抽屉 UI 跟现有「版本历史」一致,零学习成本

8. **不强制用户「选 attachment」,上传即进 pool,agent 自动看 inventory**
   - **Why**:简化第一版 UX。用户传完文件直接问问题,agent 主动决定要不要调 read 工具。第二版可加显式 attachment chip(用户在 send 时声明「带这俩文件」)

## 6. 数据模型 & 文件结构变更

### 新表 `user_assets`

```ts
// packages/agent/src/db/schema.ts
export const userAssets = mysqlTable('user_assets', {
  id: varchar('id', { length: 36 }).primaryKey(), // uuid v4
  userId: int('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  mime: varchar('mime', { length: 100 }).notNull(),
  sizeBytes: int('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(), // dedup hint (不强制 unique,用户可上传同一文件多次)
  storagePath: varchar('storage_path', { length: 500 }).notNull(), // ${userId}/${id} 相对 LUMIDECK_ASSETS_DIR
  extractedText: text('extracted_text'), // nullable,worker 跑完写入
  extractStatus: mysqlEnum('extract_status', [
    'pending',
    'running',
    'done',
    'failed',
    'skipped',
  ]).default('pending'),
  extractErrorMsg: text('extract_error_msg'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
})
// 索引: (userId) for list, (userId, sha256) for dedup hint
```

### 新增文件

| 文件                                                    | 职责                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/agent/src/routes/uploads.ts`                  | POST/GET/DELETE /api/uploads,multipart 解析 + quota check                          |
| `packages/agent/src/uploads/storage.ts`                 | 本地 fs 抽象:put / get / delete + LUMIDECK_ASSETS_DIR env 解析                     |
| `packages/agent/src/uploads/quota.ts`                   | per-user quota 算总和 + 检查超 cap                                                 |
| `packages/agent/src/uploads/extractor.ts`               | extractor worker:5 type parser routing                                             |
| `packages/agent/src/uploads/parsers/pdf.ts`             | pdf-parse wrapper                                                                  |
| `packages/agent/src/uploads/parsers/docx.ts`            | mammoth wrapper                                                                    |
| `packages/agent/src/uploads/parsers/xlsx.ts`            | xlsx wrapper(到 JSON.stringify 友好格式)                                           |
| `packages/agent/src/uploads/parsers/text.ts`            | MD/TXT 直读 + 编码检测                                                             |
| `packages/agent/src/uploads/multi-modal.ts`             | hardcoded SUPPORTED_MULTI_MODAL_MODELS set + isMultiModalLLM(provider, model) 函数 |
| `packages/agent/src/tools/local/list-uploaded-files.ts` | agent tool: list_uploaded_files                                                    |
| `packages/agent/src/tools/local/read-uploaded-file.ts`  | agent tool: read_uploaded_file(id, mode)                                           |
| `packages/creator/src/composables/useUploads.ts`        | upload / list / delete API client                                                  |
| `packages/creator/src/components/AssetManagerPanel.vue` | 「我的素材」抽屉/modal                                                             |
| `packages/creator/src/components/UploadButton.vue`      | ChatPanel sender 区的 paperclip + 拖拽 zone                                        |
| `packages/creator/src/components/UploadProgress.vue`    | 上传中的 chip 显示                                                                 |
| `docs/plans/29-phase13-file-upload-assets.md`           | 本 phase 的 plan                                                                   |

### 修改

| 文件                                                              | 改动                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/agent/src/db/schema.ts`                                 | 加 userAssets 表                                                           |
| `packages/agent/src/app.ts`                                       | mount `/api/uploads` 路由                                                  |
| `packages/agent/src/tools/registry.ts`                            | 注册 list_uploaded_files + read_uploaded_file                              |
| `packages/agent/src/llm/agent/index.ts`                           | createAgent systemPrompt 末尾拼 user assets inventory                      |
| `packages/agent/src/prompts/buildSystemPrompt.ts`                 | 加 buildUserAssetsInventory(userId) helper                                 |
| `packages/creator/src/components/ChatPanel.vue`                   | sender 区嵌 UploadButton + 拖拽 zone                                       |
| `packages/creator/src/components/DeckEditorHeader.vue` 或类似顶栏 | 加「我的素材」按钮                                                         |
| `packages/agent/package.json`                                     | 加 pdf-parse / mammoth / xlsx 依赖;加 multer 或 formidable 处理 multipart  |
| `packages/agent/.env.example` + .env.development.local 等         | 加 LUMIDECK_ASSETS_DIR                                                     |
| `scripts/deploy.sh`                                               | 部署期 mkdir -p /var/lumideck/user-assets;确保 lumideck-agent 进程有写权限 |
| `CLAUDE.md`                                                       | 加 Phase 13 提炼(文件上传 + 多媒体边界 + storage 路径)                     |

## 7. API 设计

### POST /api/uploads

multipart/form-data:

- `file`: 单文件
- (前端可一次拖多个 → 串行调用 / 后端不做 batch)

response 200:

```json
{
  "asset": {
    "id": "uuid",
    "filename": "report.pdf",
    "mime": "application/pdf",
    "sizeBytes": 1234567,
    "extractStatus": "pending",
    "uploadedAt": "2026-05-16T..."
  },
  "quota": {
    "usedBytes": 12345678,
    "limitBytes": 104857600
  }
}
```

错误:

- 401 unauthorized
- 413 `{error:{code:'file-too-large', message:'单文件最大 10MB'}}`
- 413 `{error:{code:'quota-exceeded', message:'已用 95MB / 100MB,请先在「我的素材」清理'}}`
- 415 `{error:{code:'unsupported-mime', message:'不支持的文件类型:application/octet-stream'}}`

### GET /api/uploads

response 200:

```json
{
  "assets": [{ ... 同上 ... }],
  "quota": { "usedBytes": ..., "limitBytes": 104857600 }
}
```

### GET /api/uploads/:id

stream 原字节,Content-Type 跟 DB 的 mime 一致。401 / 403(跨用户) / 404。

### DELETE /api/uploads/:id

200 删 fs + DB row + 返新 quota。

## 8. 后台 Extractor Worker

跟 `packages/agent/src/image-gen-job.ts` 同套路:

- 进程内 in-memory queue + worker pool(concurrency 默认 3 per process)
- 每个 job: `{ assetId, userId, mime }`
- worker 解锁后:read fs → call parser → update DB `extractedText` + `extractStatus`
- 失败:status=failed + extractErrorMsg 写错文,不重试(用户重传)
- Image type:不入 queue,直接 status=skipped
- 文件超 5MB 或 PDF 超 50 页时 truncate extracted text 到 N 字防爆 DB row

## 9. Agent Tools 设计

### list_uploaded_files

```ts
inputSchema: {
} // 无参
output: {
  files: [
    {
      id: 'uuid',
      filename: 'report.pdf',
      mime: 'application/pdf',
      sizeBytes: 1234567,
      extractStatus: 'done',
      summary: '<extractedText 前 200 字>', // 防 list 时返大 text
    },
  ]
}
```

### read_uploaded_file

```ts
inputSchema: {
  id: { type: 'string' },
  mode: { type: 'string', enum: ['text', 'image'] }  // 默认 'text'
}

text mode output: { success: true, content: '<full extractedText>' }
image mode output: 返 canonical ImageBlock(让 agent 把它当 user message 的一部分)
                   { success: true, image: { mediaType: 'image/png', dataBase64: '...' } }

错误情况:
- file not found / 跨用户访问: { success: false, error: 'asset not found' }
- text mode + image type: { success: false, error: 'image 类型只能用 mode=image,主 LLM 必须 multi-modal' }
- image mode + 主 LLM 非 multi-modal: { success: false, error: '当前主 LLM (zhipu/glm-5.1) 不支持图片,请切到 Claude/Gemini/OpenAI/GLM-5v-turbo' }
- text mode + extract 还在 pending: { success: false, error: 'extracted text 还在处理,稍后再试' }
```

### Multi-modal LLM 检测

```ts
// packages/agent/src/uploads/multi-modal.ts
const SUPPORTED_MULTI_MODAL_MODELS = new Set([
  // openai
  'gpt-5.5',
  'gpt-5.2',
  'gpt-5v-turbo',
  'gpt-4o',
  // anthropic
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet',
  // google
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  // zhipu
  'glm-5v-turbo',
  // ...扩展时按需加
])

export function isMultiModalLLM(provider: string, modelId: string | undefined): boolean {
  if (!modelId) return false
  return SUPPORTED_MULTI_MODAL_MODELS.has(modelId)
}
```

System prompt 中加注:

```
当前主 LLM: {provider}/{model}
{multi-modal ? '✓ 支持图片,可调 read_uploaded_file(id, mode=\"image\") 读 image 类素材'
             : '✗ 不支持图片,只能读 text 类素材;image 类需要用户切到 Claude/Gemini/GPT/GLM-5v'}
```

## 10. 前端 UI

### ChatPanel 上传区

- sender 左侧加 paperclip 📎 按钮:点击 → file picker(多选)
- sender 整个区接 `dragover` / `drop` event:拖文件进来 → 上传
- 上传中:sender 上方出现 UploadProgress chip 列表(每个文件:filename + progress bar + 取消)
- 上传完成的 asset 不主动 chip 化(进 pool,agent 自动看 inventory)
- 容量超时:toast 红条「空间不足,去清理」+ 链「我的素材」打开抽屉

### 「我的素材」面板

- 顶栏新加按钮(跟「版本历史」「设置」并列,icon = folder 或 📁)
- 点击 → 右侧 drawer 或 modal
- 头部:容量条 `已用 23.4 MB / 100 MB` + 红色 警告 if > 90%
- 列表(按 uploadedAt desc):
  - filename · mime · size · 上传时间 · extract status (pending/done/failed)
  - 右侧:删除按钮
- 空状态:「还没上传任何素材」+ 「上传素材」按钮

### 主 LLM 不支持图片时的 UX

- 上传时检测主 LLM:不是 multi-modal → toast「主 LLM 不支持图片,如需 AI 看图请切到 Claude/Gemini/GPT 或 GLM-5v」+ 仍允许上传(用户可后续切)
- 「我的素材」列表中 image 类 asset 行加灰色 hint「需 multi-modal LLM」

## 11. Quota Enforcement

- 后端单一 source of truth:`SELECT SUM(size_bytes) FROM user_assets WHERE user_id = ?` 算当前用量
- 上传前:check `usedBytes + newFileSize <= LIMIT` 不超就接收
- 删除时:不需重算,UPDATE 单行 SUM 自动减少
- 前端容量条:打开「我的素材」时拉一次 GET /api/uploads(含 quota),不维护实时缓存
- ENV `LUMIDECK_QUOTA_PER_USER_BYTES`(默认 104857600 = 100MB)+ `LUMIDECK_QUOTA_PER_FILE_BYTES`(默认 10485760 = 10MB)让 prod 调

## 12. 风险 & 缓解

| 风险                             | 后果                                                | 缓解                                                           |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| PDF parsing 内存爆 / 慢          | worker 卡死,影响其他 user upload                    | pdf-parse 设 maxPages=50,超大 PDF truncate;worker timeout 30s  |
| XLSX 多 sheet 巨表               | extractedText 巨大,DB row 膨胀                      | parser 限 N 行 / N 列 cap;超出加「... 省略 X 行」尾标          |
| 用户上传恶意文件(.exe 伪装)      | 安全风险                                            | mime 白名单 + magic-bytes 检测(file-type 包),不在 whitelist 拒 |
| fs 路径 traversal 攻击           | 越权访问其他 user 文件                              | id 用 uuid + 强制 `${userId}/${id}` 路径模板,不接受用户传 path |
| disk 满                          | 整个 lumideck-agent 服务挂                          | quota cap + healthz 加 disk-free 探针(>90% warn)               |
| 主 LLM 切换破坏 multi-modal 判定 | 切到非 multi-modal 后,历史 image-mode tool 调用失败 | 主 LLM 切换时 chat 历史不动;新 turn read 工具运行时检测        |
| 上传中网络断                     | 半个文件残留                                        | multer / formidable 自带 cleanup;fs 写完整后才写 DB row        |

## 13. 工作量估

- A. DB schema + storage layer + quota helper: 0.5d
- B. POST/GET/DELETE /api/uploads + mime 白名单 + 集成测: 1d
- C. Extractor worker + 5 parser + 单测: 1.5d
- D. Agent tools list + read + multi-modal detect + 单测: 0.5d
- E. createAgent systemPrompt inventory + buildSystemPrompt 改造: 0.5d
- F. Frontend ChatPanel UploadButton + 拖拽 + UploadProgress + AssetManagerPanel + 容量条: 1.5d
- G. E2E + 组件测 + dogfood + plan close-out: 1d

**合计 6.5 天**(乐观)/ 8 天(含 dogfood 修边角)

## 14. Phase 关系

- **依赖**:Phase 12.7 ✅(pi-agent-core agent runtime 已落,新工具走 tool registry 即可)
- **不依赖**:Phase 13.5 候选(MCP catalog 扩展)/ Phase 14 导出
- **后续解锁**:
  - Phase 13.5 candidate:用户级品牌 asset 持久化(复用 user_assets pool 加 isBranded flag)
  - Phase 13.x candidate:音频 ASR(挂 extractor worker 同套路)
  - Phase 14 导出:可附带「素材清单」到导出包

## 15. 实施步骤大纲(详见 plan 29)

1. **DB schema + storage 抽象**:user_assets 表 drizzle push;fs storage put/get/delete;LUMIDECK_ASSETS_DIR env;quota helper
2. **upload API**:POST/GET/DELETE /api/uploads + multipart + mime 白名单 + per-user/per-file cap + 集成测
3. **extractor worker**:queue + 5 parser(pdf-parse / mammoth / xlsx / text)+ truncate 策略 + 单测
4. **agent tools**:list_uploaded_files / read_uploaded_file + multi-modal detect + 单测
5. **system prompt 集成**:buildUserAssetsInventory + createAgent 注入 + 改造单测
6. **frontend**:UploadButton(paperclip + drag-drop)+ UploadProgress + AssetManagerPanel(顶栏入口 + drawer + 容量条)+ 组件测
7. **E2E + dogfood + close-out**:Playwright 拖拽上传 → 列表 → AI read → 验回答含文件内容引用;plan 三章节填完;roadmap Phase 13 ✅

---

## 不变约束

- secrets / .env.\*.local 不入 git(沿 CLAUDE.md)
- commit 中文 + 禁用 `git add -A`
- 测试覆盖率门槛:agent ≥ 90/85;creator ≥ 75/65(沿现行)
- 沿 subagent-driven-development 套路(implementer + spec reviewer + code quality reviewer per task)
- 部署:`scripts/deploy.sh` 加 `mkdir -p /var/lumideck/user-assets && chown lumideck:lumideck` 步骤

---

## 编号说明

roadmap 原 Phase 13「MCP catalog 扩展」改写成「文件上传 + asset 管理」。原 MCP 主题降级到 Phase 13.5 候选(待 dogfood 看用户对 HTTP MCP 的实际需求)。Phase 12.6 OAuth providers 已永久取消(memory `no-oauth-providers`)。
