# Phase 15 — 归档数据包 export + import(`.lumideck`)实施文档

> **状态**:已完成（2026-05-18）
> **前置阶段**:[plan 30 Phase 14 导出 (PDF/PNG/PPTX)](30-phase14-export.md) / [plan 29 Phase 13 文件上传](29-phase13-file-upload-assets.md)
> **后续阶段**:Phase 16 自研 PresentationViewer；Markdown / PPTX 外部格式导入已于 2026-07-11 永久取消
> **路线图**:[roadmap.md Phase 15](../requirements/roadmap.md#phase-15归档数据包-export--importlumideck)
> **执行子技能**:`superpowers:subagent-driven-development`(Task B / C 可并行起 2 agent,**必走 git worktree**;Task A / D / E 串行)

**Goal**:让用户把整个 deck 打包成单个 `.lumideck` 文件(本质 zip)→ 跨账号 / 跨实例 / 本地备份分发;接收方在 deck 列表页一键 import 还原完整 deck(markdown + 所有 AI 出图 / 嵌图 + 模板 + 元数据)。Phase 14 截图分发(PDF / PNG / PPTX)给非 Lumideck 用户看,Phase 15 数据包给 **Lumideck 用户跨设备复用**,语义互补。**Backend 参与**(export stream zip / import 解包 + DB transaction),不开异步 job、不做历史记录、不做冲突解决 —— 一律 new deck。

---

## 关键设计抉择(2026-05-18 与用户对齐)

> 设计期与用户拍板的非显然决策,每条带"Why"。任务执行期发现 plan 的 bug 时直接修这里 + 加 prevent-regression 测试。

1. **包格式 = `.lumideck`(本质 zip + 后缀重命名)**;内部 `manifest.json` + `content.md` + `assets/<asset_id>.<ext>` 三件套
   - Why:zip 是跨平台原生格式,任何 unzip 工具(macOS Finder / 7zip / Windows Explorer)都能 inspect;改后缀 `.lumideck` 防用户误把 zip 拖回 Lumideck 当通用 zip 处理 + 让 OS 双击关联未来可做(本期不做关联,只让 import 按钮 accept `.lumideck`);用户 hex inspect 仍能看到 `PK\x03\x04` zip magic
   - 不选自研二进制格式:无收益 + 黑盒难调试
   - 不选 tar.gz:无浏览器原生支持(浏览器`<input type="file">` 不区分 mime,但 server-side 解 tar 要装 `tar-stream` 等额外 dep;zip 走 jszip 一次搞定;agent / creator 已有 jszip)

2. **Export + Import 都走 backend,不做 client-side 解析**:
   - Why:server 端直接从 DB 拉 `deck_assets.data` BLOB → zip stream(避免 `<img>` 一张张请求 ostream 浪费 RTT;且 client 不需要拥有从 markdown 反解 asset id 的逻辑);import 端解 zip 后做 DB transaction(decks + deck_versions + deck_assets 三表 atomic insert + rewrite asset url),server 才能保证 transaction 边界
   - 不选 client-side export(像 Phase 14 一样浏览器内拼 zip):client 拿不到 `deck_assets` BLOB,只能逐个 GET `/api/assets/:id` 拉,N 张图 N 个 RTT;且 manifest 元数据(`templateId`)需要 deck DB row 才完整
   - 不选 client-side import:解 zip 后还得 N 张图分别 POST `/api/assets/:id` 写库 + rewrite markdown,client 无 transaction 边界,中途失败留 orphan asset 行
   - **Backend 路由**:`GET /api/decks/:id/export-archive` + `POST /api/decks/import`

3. **schemaVersion 兼容表 = 硬编 `SUPPORTED_SCHEMA_VERSIONS = [1] as const`,不做自动 migration**
   - Why:schema migration 是隐式协议变更,极易引入 silent corruption(老 row 没 `templateId` → 默认 fallback `beitou-standard` 可能跟用户预期不符);明确报错让用户**用新版 Lumideck 重新导出**比 silent migrate 安全
   - 升级方式:schema 新增字段时 append `SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const`,同时在 manifest reader 里按版本号分支读;每次升级在 plan 31 close-out 章节 + CLAUDE.md 已知坑追加版本差异表
   - **`CURRENT_SCHEMA_VERSION = 1`** 用于 export 端口写入 manifest

4. **Import 一律创建新 deck 不覆盖**:不做 same-id / same-title 冲突解决
   - Why:用户预期清晰("我导入了一个包就出一个新 deck");支持 same-title 不冲突(deck 表不 unique on title);跨账号 import 时原 deck_id 已经无意义(肯定属于另一个 user)
   - 新 deck 的 title 在源 title 后加 `(导入)` 后缀,避免列表里跟原 deck 视觉混淆(若同账号 import)
   - 不做覆盖:也避免误操作丢失编辑中的 deck;用户想"还原一个旧 deck"= 新 deck 覆盖体感不强,他们更倾向"开一个全新的 instance"

5. **不包 user_assets**(ChatPanel 上传的 PDF/DOCX 等 reference 文件)
   - Why:user_assets 是 user 级别的素材池,跟 deck 渲染**完全无关**(deck markdown 不引用 user_assets URL);打包进去会(a)膨胀包大小;(b)有跨账号 import 时复用语义模糊(用户 A 的素材直接挪到用户 B 的池子合不合理?);(c)增加 schema 复杂度
   - 用户 import 后在新账号重传 reference 文件即可,不影响 deck 视觉完整性

6. **只包 `deck_assets` 表 BLOB**(AI 生图 + 用户嵌图)
   - Why:这些是 deck markdown 直接引用的资源(`<img src="/api/assets/<uuid>">`),不包就缺图,deck 视觉不完整
   - 反射:Phase 14 验收"AI 出图页截图必须等 img onload" → Phase 15 import 后视觉必须像素级一致 → AI 图必须随包走

7. **包内 asset 文件名 = `<asset_id>.<ext>`**(uuid 形式不带原 filename)
   - Why:`deck_assets.id` 是 `varchar(36)` uuid(`crypto.randomUUID()` 生成),全局唯一;`deck_assets` 表无 `filename` 字段(AI 生图本来就没有 filename);加 ext 让 OS 解压后双击可预览(`.png` / `.jpg` / `.webp`)
   - **ext 推导**:`deck_assets.mime_type` 已有,代码内 `mime → ext` 映射表(`image/png` → `png`, `image/jpeg` → `jpg`, `image/webp` → `webp`, `image/gif` → `gif`);未知 mime 兜底用 `bin`(import 端读 manifest 的 mime 字段而非看文件 ext,所以 ext 仅用于 OS 友好,不参与解析)

8. **Markdown 内 asset URL 当前格式 = `/api/assets/<uuid>`**;import 端 rewrite 用正则 `/\/api\/assets\/([0-9a-f-]{36})/g`(沿用 `regenerate-image-pages.ts` 同款正则)
   - Why:已有 `imageSrc: /api/assets/<uuid>` 在 frontmatter 内,这条正则在生产已经稳定运行;import 后建好新 asset map(old-uuid → new-uuid)即可全文 replace

9. **Manifest schema 字段**:

   ```json
   {
     "schemaVersion": 1,
     "lumideckVersion": "0.1.0",
     "exportedAt": "2026-05-18T12:34:56.789Z",
     "deck": {
       "originalDeckId": 42,
       "title": "Q1 业务汇报",
       "templateId": "beitou-standard",
       "createdAt": "2026-05-15T10:00:00.000Z",
       "updatedAt": "2026-05-17T16:30:00.000Z"
     },
     "assets": [
       {
         "id": "<uuid>",
         "mimeType": "image/png",
         "bytesSize": 1234567,
         "prompt": "..." or null,
         "model": "gpt-image-1" or null
       }
     ]
   }
   ```

   - Why 不包 `versions[]` 历史:dogfood 期 import 只关心"还原当前可看的 deck",历史版本属 audit,不在备份语义;且历史版本可能有 broken intermediate state(模板切换中途的 markdown)
   - Why 包 `prompt` / `model`:让 Phase 12「按新模板色板重新生成 AI 图」工具在 import 后仍能跑(无 prompt = skip)
   - Why 包 `assets[]` index 而不是直接扫包目录:让 import 端先校验 manifest 与包目录文件名一一对应(detect 部分丢包损坏)
   - Why **不包 `currentVersionId`**:import 后新 version_id 由 DB autoincrement 决定,不需要源记录

10. **Import 失败 → 整体 rollback + 友好中文错误**:
    - schemaVersion 不在 SUPPORTED → 400 `"数据包版本 N 不被当前 Lumideck 支持,请用新版重新导出"`
    - manifest 字段缺失 / JSON parse 失败 → 400 `"manifest.json 字段不完整: <field>"`
    - 包内 asset 文件缺失 → 400 `"数据包损坏: asset <id> 在包内未找到"`
    - mimeType / bytesSize 跟实际文件不一致 → 400 `"asset <id> 实际 size 与 manifest 声明不匹配"`
    - 上传文件不是合法 zip → 400 `"数据包损坏: 不是合法 zip 文件"`
    - 超过 import size cap → 413 `"数据包超过 100MB 上限"`
    - 校验通过但 DB transaction 失败 → 500 `"还原失败,请重试"`

11. **Import file size cap = `LUMIDECK_IMPORT_MAX_BYTES` env 默认 100MB**(对齐 user-assets quota 单文件 100MB)
    - 单 deck 实测 N=20 AI 图 × 1.5MB ≈ 30MB,100MB 留 3 倍余量
    - Why 不依赖 user quota:user_assets 跟 deck_assets 独立 quota,deck_assets 跟 user 无 quota 限制(只受 MEDIUMBLOB 16MB 单元限制),import 限的是**单次包 upload 大小**,不是用户累计 deck_assets 大小

12. **`.lumideck` 后缀 + MIME = `application/zip`**:浏览器 download 时 Content-Disposition 指定 filename 自动 `.lumideck`,Content-Type 仍 `application/zip` 让浏览器知道是 zip 二进制(不预览);import 时 `<input type="file" accept=".lumideck">` 只过滤 OS 文件选择器,server 端 magic-bytes(`PK\x03\x04`)校验是否合法 zip

13. **Backend zip 库选 `jszip`(已在 lockfile)而不是 `archiver`**
    - Why:jszip 已被 creator 包(Phase 14)+ pptxgenjs 间接依赖,lockfile 已有,agent 端 reuse 零成本;archiver 是另一个生态(同样优秀,但 streaming API 更复杂、再装一个 dep);jszip 同时支持 node 与 browser bundle,API 一致;**Phase 15 包大小预算 < 100MB**,jszip 把整包 build 到 Buffer 后一次性 stream 给客户端不会 OOM(对比 puppeteer 截图的 chromium 200MB,这里 N=20 张图 30MB 完全可控)
    - Trade-off:jszip 不是真 streaming(整包先 build 到 Buffer 再 stream;archiver 才是 chunk-by-chunk pipe),对 < 100MB 包无影响,本期不需要 archiver
    - **compression: 'STORE'** 跳二次 deflate(PNG 已压缩),产物 size ≈ 各文件之和 + 几 KB header,export 更快

---

## ⚠️ Secrets 安全红线(HARD,沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则))

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- 本 Phase **引入 1 个新环境变量**:`LUMIDECK_IMPORT_MAX_BYTES`(默认 100MB,无安全敏感性,但需在 `.env.example` 跟 `.env.production.local` 同步)
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**
- **Import 路由 secrets 注意**:解 zip + 写 DB 不涉及任何密钥;但**禁止把 import 内容 echo 回响应体**(防数据泄漏:用户 A 的包 import 失败时不要把内容回显给攻击者)

---

## 文件结构变更对照表

### 新增

| 文件                                                                             | 职责                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/archive.ts`                                                 | `ArchiveManifest` interface + `SUPPORTED_SCHEMA_VERSIONS = [1] as const` + `CURRENT_SCHEMA_VERSION = 1` + `ArchiveAssetEntry` / `ArchiveDeckMeta` 子类型;前后端共享 source of truth                                          |
| `packages/agent/src/archive/build-archive.ts`                                    | `buildArchive(deckId, userId): Promise<Buffer>` — DB 拉 deck + currentVersion + deck_assets → jszip 生成包 → return Buffer                                                                                                   |
| `packages/agent/src/archive/parse-archive.ts`                                    | `parseArchive(zipBuffer: Buffer): Promise<{ manifest, content, assets: Map<id, Buffer> }>` — jszip 解 + manifest schemaVersion / 字段 / 文件存在性 / mime 一致性 各步 validate,失败抛 typed error                            |
| `packages/agent/src/archive/mime-ext.ts`                                         | `mimeToExt(mime: string): string` + `extFromMime` 映射(image/png → png 等);default `bin`                                                                                                                                     |
| `packages/agent/src/archive/rewrite-asset-urls.ts`                               | `rewriteAssetUrls(markdown: string, idMap: Map<oldId, newId>): string` — 全文正则 replace `/api/assets/<oldId>` → `/api/assets/<newId>`                                                                                      |
| `packages/agent/src/archive/errors.ts`                                           | `ArchiveError` typed error class(`code: 'schema-mismatch' / 'manifest-invalid' / 'asset-missing' / 'asset-corrupt' / 'not-a-zip' / 'oversized'` + `userMessage` 中文)                                                        |
| `packages/agent/src/routes/decks-archive.ts`                                     | Hono sub-router:`GET /decks/:id/export-archive` + `POST /decks/import`;auth 鉴权 + ownership(export)+ multipart(import)                                                                                                      |
| `packages/agent/test/archive-build.test.ts`                                      | 单测:fake deck + 2 assets → buildArchive → 解压 zip 校 manifest 字段 + content.md 全等 + assets/ 文件名 + 内容 byte-equal                                                                                                    |
| `packages/agent/test/archive-parse.test.ts`                                      | 单测:happy + schemaVersion 不支持 / manifest 缺字段 / asset 缺失 / mime 不匹配 / not-zip 各分支                                                                                                                              |
| `packages/agent/test/archive-rewrite.test.ts`                                    | 单测:rewrite asset urls 单图 / 多图 / 无图 / id 不在 map / 重复出现各 case                                                                                                                                                   |
| `packages/agent/test/archive-mime-ext.test.ts`                                   | 单测:5 个 mime 映射 + unknown fallback bin                                                                                                                                                                                   |
| `packages/agent/test/routes-decks-archive.test.ts`                               | 集成测:走 `app.fetch()` — export happy / 越权 403 / 不存在 deck 404 / import happy / schema 400 / corrupt 400 / size 413 / **round-trip(create + assets → export → 删原 deck → import → assert content + asset count 一致)** |
| `packages/creator/src/composables/useImport.ts`                                  | `useImport().importArchive(file: File)` — multipart POST `/api/decks/import` → 返 `{ deckId, title }`;reactive `importing / error` state                                                                                     |
| `packages/creator/src/composables/__tests__/useImport.test.ts`                   | 单测:happy / 网络错误 / size 413 / schema 400 各 case                                                                                                                                                                        |
| `packages/creator/src/pages/__tests__/DeckListPage.test.ts`(若已有则扩,否则新建) | 单测:import 按钮可见 / file input 触发 / loading 状态 / 错误显示                                                                                                                                                             |
| `packages/e2e/tests/archive-export.spec.ts`                                      | E2E:编辑器内点导出 → 选 .lumideck → 等下载 → 断 size > 100 bytes + ext `.lumideck` + zip magic                                                                                                                               |
| `packages/e2e/tests/archive-roundtrip.spec.ts`                                   | E2E:创建 deck → export .lumideck → 删原 deck → deck 列表点导入 → 等跳转新 deck → 断标题含「(导入)」+ 内容渲染                                                                                                                |

### 修改

| 文件                                                                                                          | 改动摘要                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/index.ts`                                                                                | 加 `export * from './archive.js'` 一行                                                                                                                                                    |
| `packages/agent/src/app.ts`                                                                                   | mount `decks-archive` 路由(`app.route('/api', decksArchiveRoute)`);注意**不要**塞进 decksRoute 因为 wildcard 中间件触发面不同                                                             |
| `packages/agent/.env.example`                                                                                 | 加 `LUMIDECK_IMPORT_MAX_BYTES=104857600`(100MB)注释说明                                                                                                                                   |
| `packages/agent/.env.development.local.example` / `.env.test.local.example` / `.env.production.local.example` | 同步加 env 默认值占位                                                                                                                                                                     |
| `packages/creator/src/composables/useExport.ts`                                                               | `ExportFormat` union 加 `'lumideck'`;`exportDeck` 内 `format === 'lumideck'` 走新分支:`fetch('/api/decks/:id/export-archive')` 拿 blob → `triggerDownload`(不走 capturePages 链路)        |
| `packages/creator/src/components/ExportModal.vue`                                                             | 加第 4 个 radio `format-lumideck`:`label "归档包 (.lumideck)" + hint "≈ 3 秒 · 给其他 Lumideck 用户导入用"`;time estimate 文本同步;进度条 lumideck 时显示 "正在打包..." 而非「第 X/N 页」 |
| `packages/creator/src/pages/DeckListPage.vue`                                                                 | 顶栏「新建 Deck」按钮旁加「导入」按钮 + 隐藏 `<input type="file" accept=".lumideck">`;点击触发文件选择 → `useImport().importArchive(file)` → 成功跳转新 deck;loading 状态 + 错误显示      |
| `docs/requirements/roadmap.md` Phase 15 段落                                                                  | close-out 时回写"已落地" + 链接                                                                                                                                                           |
| `CLAUDE.md` 已知坑                                                                                            | 实施期发现的可复用坑提炼到此                                                                                                                                                              |

### 删除

| 文件 | 原因                   |
| ---- | ---------------------- |
| —    | 本 Phase 纯增量,无删除 |

### **不**改动(关键澄清)

- ❌ **DB schema 零改动**:`deck_assets` 表当前字段(id / deckId / userId / mimeType / bytesSize / data / prompt / model / createdAt)已满足包内复刻所需;**不引入** `archive_jobs` 表(无异步任务);**不引入** `imports` 表(无历史)
- ❌ **不动 Phase 14 export 链路**:Phase 14 是 client-side 截图导出 PDF/PNG/PPTX 三种格式,Phase 15 是 backend 流 zip,**两条链路独立共存**,Phase 14 代码完全不动
- ❌ **不动 user_assets**:不打包、不还原、不删
- ❌ **不引入** `archiver` / `tar-stream` / `node-7z` 等新 zip 库(jszip 已够用)
- ❌ **不动 ExportRenderer.vue / capture-pages.ts**:.lumideck 不走截图链路

---

## 数据模型变更

**无**。本 Phase 不引入新表 / 不改字段。`deck_assets.mime_type` / `deck_assets.bytes_size` / `deck_assets.id` (uuid varchar(36)) / `deck_assets.prompt` / `deck_assets.model` 当前字段已能完整复刻包内 asset 元数据。`decks.template_id` + `deck_versions.content` + `deck_versions.template_id` 三者支持 import 时正确还原模板上下文。

---

## 阶段拆分

每个 Task 一个 commit;每步绿测试 + 当步独立可回退。建议 **5 个 Task**,总工时 **7d**。Task B / C 可并行起 2 agent(必走 git worktree,共享 worktree 撞 git index 已踩过坑,见 CLAUDE.md「subagent-driven 并行 3+ agent 共享 worktree 撞 git staging 错位」),其余串行。

### Task 31-A:Shared types + agent archive 基础设施 + 错误体系(1d)

**目的**:把 manifest schema / SUPPORTED_SCHEMA_VERSIONS / typed error 立住,后续 Task B/C 直接 import 用。零业务路由,纯基建。

**操作**:

1. 新建 `packages/shared/src/archive.ts`:

   ```ts
   /** Phase 15 归档数据包 manifest schema 单一来源。
    * 升级 schemaVersion 时:append SUPPORTED_SCHEMA_VERSIONS + bump CURRENT_SCHEMA_VERSION
    * + 加版本差异表(见 plan 31 close-out 章节)。
    * 不支持自动 migration —— 不在表里的版本号 import 直接 400。
    */
   export const SUPPORTED_SCHEMA_VERSIONS = [1] as const
   export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number]
   export const CURRENT_SCHEMA_VERSION: SupportedSchemaVersion = 1

   export interface ArchiveAssetEntry {
     id: string // uuid (= deck_assets.id)
     mimeType: string // e.g. "image/png"
     bytesSize: number // 跟 assets/<id>.<ext> 实际字节一致(parse 端会校)
     prompt: string | null // 出图 prompt,null 表示用户嵌图
     model: string | null // 出图模型,如 "gpt-image-1"
   }

   export interface ArchiveDeckMeta {
     originalDeckId: number // 源 deck id(import 不复用,纯审计)
     title: string
     templateId: string // 'beitou-standard' 等
     createdAt: string // ISO 8601
     updatedAt: string // ISO 8601
   }

   export interface ArchiveManifest {
     schemaVersion: SupportedSchemaVersion
     lumideckVersion: string // 当前实例 version,如 "0.1.0";仅审计用
     exportedAt: string // ISO 8601
     deck: ArchiveDeckMeta
     assets: ArchiveAssetEntry[]
   }
   ```

2. 改 `packages/shared/src/index.ts`:加 `export * from './archive.js'`
3. 新建 `packages/agent/src/archive/mime-ext.ts`:
   ```ts
   const MAP: Record<string, string> = {
     'image/png': 'png',
     'image/jpeg': 'jpg',
     'image/webp': 'webp',
     'image/gif': 'gif',
   }
   export function mimeToExt(mime: string): string {
     return MAP[mime.toLowerCase()] ?? 'bin'
   }
   ```
4. 新建 `packages/agent/src/archive/errors.ts`:

   ```ts
   export type ArchiveErrorCode =
     | 'not-a-zip'
     | 'manifest-missing'
     | 'manifest-invalid'
     | 'schema-unsupported'
     | 'asset-missing'
     | 'asset-corrupt'
     | 'content-missing'
     | 'oversized'
     | 'db-failure'

   export class ArchiveError extends Error {
     constructor(
       public code: ArchiveErrorCode,
       public userMessage: string,
       cause?: unknown,
     ) {
       super(userMessage)
       this.name = 'ArchiveError'
       if (cause !== undefined) (this as { cause?: unknown }).cause = cause
     }
   }
   ```

5. 新建 `packages/agent/src/archive/rewrite-asset-urls.ts`:
   ```ts
   const ASSET_ID_RE = /\/api\/assets\/([0-9a-f-]{36})/g
   export function rewriteAssetUrls(markdown: string, idMap: Map<string, string>): string {
     return markdown.replace(ASSET_ID_RE, (whole, oldId: string) => {
       const newId = idMap.get(oldId)
       return newId ? `/api/assets/${newId}` : whole // map 中无对应 id 时保持原样(graceful degrade)
     })
   }
   ```
6. 单测:
   - `packages/agent/test/archive-mime-ext.test.ts`:5 个 mime 映射 + unknown
   - `packages/agent/test/archive-rewrite.test.ts`:单图 / 多图 / 重复出现同 id / map 中无对应 id 各 case;断 case sensitive(`API/Assets` 不被替换)
   - **shared 包必须 build**:`pnpm -F @big-ppt/shared build`(否则 agent 在生产 import 链路找不到 `.js`,CLAUDE.md 已知坑「shared 包 NodeNext 必 build」)
7. 跑 `pnpm -F @big-ppt/agent type-check` + `pnpm -F @big-ppt/agent vitest run test/archive-rewrite.test.ts test/archive-mime-ext.test.ts`

**验证方法**:

- shared build emit `.js`:`ls packages/shared/src/archive.js`(在 .gitignore 内)
- agent type-check + 单测全绿
- import 路径 `@big-ppt/shared` 在 agent / creator 两边都能解 ArchiveManifest type

**风险**:

- **shared 包 NodeNext 必 build**(CLAUDE.md 已知坑):本 Phase agent 部署前必须 `pnpm -F @big-ppt/shared build`,否则 ERR_MODULE_NOT_FOUND;`scripts/deploy.sh build_agent` 已在 plan 19 加 shared build 步,本 Phase 不需改部署脚本,但要在 CI / 本地手动 build 一次跑测
- 跨 workspace TS types 用 `import type { X } from '@big-ppt/shared'` 单向 re-export(已知坑 plan 26);agent / creator 都按这套路写,不反向

**工时**:1d

---

### Task 31-B:Backend Export 路由 + buildArchive(1.5d)

**目的**:`GET /api/decks/:id/export-archive` 端到端可用,返合法 `.lumideck` 流。

**操作**:

1. 新建 `packages/agent/src/archive/build-archive.ts`:

   ```ts
   import JSZip from 'jszip'
   import { getDb, decks, deckVersions, deckAssets } from '../db/index.js'
   import { eq } from 'drizzle-orm'
   import { CURRENT_SCHEMA_VERSION, type ArchiveManifest } from '@big-ppt/shared'
   import { mimeToExt } from './mime-ext.js'

   const LUMIDECK_VERSION = '0.1.0' // 后续可从 package.json 读

   export async function buildArchive(args: { deckId: number; userId: number }): Promise<Buffer> {
     const db = getDb()
     const [deck] = await db.select().from(decks).where(eq(decks.id, args.deckId)).limit(1)
     if (!deck || deck.userId !== args.userId) throw new Error('deck-not-found-or-forbidden')

     const versionId = deck.currentVersionId
     const [version] = versionId
       ? await db.select().from(deckVersions).where(eq(deckVersions.id, versionId)).limit(1)
       : []
     const content = version?.content ?? ''

     const assets = await db.select().from(deckAssets).where(eq(deckAssets.deckId, args.deckId))

     const manifest: ArchiveManifest = {
       schemaVersion: CURRENT_SCHEMA_VERSION,
       lumideckVersion: LUMIDECK_VERSION,
       exportedAt: new Date().toISOString(),
       deck: {
         originalDeckId: deck.id,
         title: deck.title,
         templateId: deck.templateId,
         createdAt: deck.createdAt.toISOString(),
         updatedAt: deck.updatedAt.toISOString(),
       },
       assets: assets.map((a) => ({
         id: a.id,
         mimeType: a.mimeType,
         bytesSize: a.bytesSize,
         prompt: a.prompt,
         model: a.model,
       })),
     }

     const zip = new JSZip()
     zip.file('manifest.json', JSON.stringify(manifest, null, 2))
     zip.file('content.md', content)
     const assetsDir = zip.folder('assets')!
     for (const a of assets) {
       const filename = `${a.id}.${mimeToExt(a.mimeType)}`
       assetsDir.file(filename, a.data)
     }
     return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
   }
   ```

2. 新建 `packages/agent/src/routes/decks-archive.ts`:

   ```ts
   import { Hono } from 'hono'
   import { eq } from 'drizzle-orm'
   import { getDb, decks } from '../db/index.js'
   import { buildArchive } from '../archive/build-archive.js'
   import { logServerEvent } from '../logger/server-log.js'
   import type { AuthVars } from '../middleware/auth.js'

   export const decksArchiveRoute = new Hono<{ Variables: AuthVars }>()

   decksArchiveRoute.get('/decks/:id{[0-9]+}/export-archive', async (c) => {
     const user = c.get('user')
     if (!user) return c.json({ error: 'unauthorized' }, 401)
     const deckId = Number(c.req.param('id'))

     const db = getDb()
     const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
     if (!deck) return c.json({ error: 'deck 不存在' }, 404)
     if (deck.userId !== user.id) return c.json({ error: '无权访问该 deck' }, 403)

     try {
       const buf = await buildArchive({ deckId, userId: user.id })
       logServerEvent({
         category: 'archive-export',
         event: 'success',
         deckId,
         userId: user.id,
         bytesSize: buf.length,
       })

       const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_')
       const filename = `${safeName}-${Date.now()}.lumideck`
       const u8 = new Uint8Array(buf)
       return new Response(u8, {
         status: 200,
         headers: {
           'Content-Type': 'application/zip',
           'Content-Length': String(buf.length),
           'Content-Disposition': `attachment; filename="${filename}"`,
           'X-Content-Type-Options': 'nosniff',
         },
       })
     } catch (err) {
       logServerEvent({
         category: 'archive-export',
         event: 'failed',
         deckId,
         userId: user.id,
         errorMsg: (err as Error).message,
       })
       return c.json({ error: '导出失败,请稍后重试' }, 500)
     }
   })
   ```

3. 改 `packages/agent/src/app.ts`:`import { decksArchiveRoute } from './routes/decks-archive.js'` + `app.route('/api', decksArchiveRoute)`
   - **不**塞进 decksRoute 内部:避免 wildcard middleware 泄漏(CLAUDE.md 已知坑「Hono sub-router wildcard 泄漏」);保持单独子路由更安全 + 集成测可独立 mount 测
4. 单测 `packages/agent/test/archive-build.test.ts`:
   - fake deck + 2 PNG asset(各 1KB)→ buildArchive → 用 jszip 解 result → 校:
     - `manifest.json` 含 schemaVersion: 1 / 正确 deck 字段 / assets.length === 2
     - `content.md` 跟原 markdown byte-equal
     - `assets/<id1>.png` / `assets/<id2>.png` 存在 + 字节跟原 BLOB 一致
5. 集成测 `packages/agent/test/routes-decks-archive.test.ts`(export 部分):
   - happy:create user + deck + 2 asset → cookie 携带 → `app.fetch('/api/decks/1/export-archive')` → 断 Content-Type / Content-Disposition / Content-Length / 解出包内 manifest 正确
   - 越权:user A 创 deck,user B 携 cookie 拉 → 断 403
   - 不存在 deck:user A 拉 `/api/decks/99999/export-archive` → 断 404
   - 未登录:无 cookie → 断 401
6. **日志规范**:export success / failed 都走 `logServerEvent` 落 `logs/server-*.jsonl`(CLAUDE.md「后端日志规范」要求)

**验证方法**:

- `pnpm -F @big-ppt/agent vitest run test/archive-build.test.ts test/routes-decks-archive.test.ts -t export`
- 手测:`pnpm dev` → 浏览器登录 → 在 ChatPanel 创个含 AI 图的 deck → 直接 `curl --cookie 'session=...' http://localhost:4000/api/decks/<id>/export-archive -o test.lumideck && unzip -l test.lumideck` 看包结构

**风险**:

- **MEDIUMBLOB N 张图一次性 load 到内存可能爆**:MEDIUMBLOB 上限 16MB / 张 × N=20 张 = 320MB Buffer 累计;但 dogfood 期单 deck 实测 N < 10、单图 < 2MB,30MB 内可控;**Phase 17+ 改造点**:若用户量大改 archiver 真 streaming(jszip Buffer 替成 archiver pipe to ReadableStream)
- **`u8 = new Uint8Array(buf)` 复制开销**:30MB 复制约 5ms,忽略;但若 N 张图后 Buffer 已经 100MB+,该复制是浪费;可优化为 `Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)` 共享底层;**先按 plan 写,close-out 测大 deck 后定**
- **Hono sub-router wildcard 泄漏**(CLAUDE.md 已知坑):本路由不写 `decksArchiveRoute.use('*', ...)`,只用显式 path,无 risk

**工时**:1.5d

---

### Task 31-C:Backend Import 路由 + parseArchive + transaction(2d)

**目的**:`POST /api/decks/import` 端到端可用,接 `.lumideck` 文件 → 解 → 校 → DB transaction 还原 → 返新 deckId。

**操作**:

1. 新建 `packages/agent/src/archive/parse-archive.ts`:

   ```ts
   import JSZip from 'jszip'
   import { SUPPORTED_SCHEMA_VERSIONS, type ArchiveManifest } from '@big-ppt/shared'
   import { ArchiveError } from './errors.js'
   import { mimeToExt } from './mime-ext.js'

   export interface ParsedArchive {
     manifest: ArchiveManifest
     content: string
     assets: Map<string, Buffer> // id → bytes
   }

   export async function parseArchive(zipBuffer: Buffer): Promise<ParsedArchive> {
     // 1. 不是 zip → not-a-zip
     if (zipBuffer.length < 4 || zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4b) {
       throw new ArchiveError('not-a-zip', '数据包损坏: 不是合法 zip 文件')
     }
     let zip: JSZip
     try {
       zip = await JSZip.loadAsync(zipBuffer)
     } catch (e) {
       throw new ArchiveError('not-a-zip', '数据包损坏: 无法解析 zip', e)
     }

     // 2. manifest.json 存在 + JSON parse 成功
     const manifestFile = zip.file('manifest.json')
     if (!manifestFile) throw new ArchiveError('manifest-missing', '数据包缺少 manifest.json')
     let manifest: ArchiveManifest
     try {
       manifest = JSON.parse(await manifestFile.async('string'))
     } catch (e) {
       throw new ArchiveError('manifest-invalid', '数据包 manifest.json 不是合法 JSON', e)
     }

     // 3. schemaVersion 在 SUPPORTED 列表内
     if (
       typeof manifest.schemaVersion !== 'number' ||
       !(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(manifest.schemaVersion)
     ) {
       throw new ArchiveError(
         'schema-unsupported',
         `数据包版本 ${manifest.schemaVersion} 不被当前 Lumideck 支持,请用新版重新导出`,
       )
     }

     // 4. manifest 必填字段齐(deck.title / deck.templateId / assets array)
     if (
       !manifest.deck ||
       typeof manifest.deck.title !== 'string' ||
       typeof manifest.deck.templateId !== 'string'
     ) {
       throw new ArchiveError('manifest-invalid', 'manifest.json deck 字段不完整')
     }
     if (!Array.isArray(manifest.assets)) {
       throw new ArchiveError('manifest-invalid', 'manifest.json assets 字段非数组')
     }

     // 5. content.md 存在
     const contentFile = zip.file('content.md')
     if (!contentFile) throw new ArchiveError('content-missing', '数据包缺少 content.md')
     const content = await contentFile.async('string')

     // 6. assets/ 文件名跟 manifest 一一对应 + size 匹配
     const assetsMap = new Map<string, Buffer>()
     for (const entry of manifest.assets) {
       if (typeof entry.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.id)) {
         throw new ArchiveError('manifest-invalid', `asset id 不是合法 uuid: ${entry.id}`)
       }
       const filename = `assets/${entry.id}.${mimeToExt(entry.mimeType)}`
       const file = zip.file(filename)
       if (!file)
         throw new ArchiveError('asset-missing', `数据包损坏: asset ${entry.id} 在包内未找到`)
       const buf = Buffer.from(await file.async('arraybuffer'))
       if (buf.length !== entry.bytesSize) {
         throw new ArchiveError(
           'asset-corrupt',
           `asset ${entry.id} 实际 size 与 manifest 声明不匹配(${buf.length} vs ${entry.bytesSize})`,
         )
       }
       assetsMap.set(entry.id, buf)
     }

     return { manifest, content, assets: assetsMap }
   }
   ```

2. 扩 `packages/agent/src/routes/decks-archive.ts`:加 `POST /decks/import`:

   ```ts
   import { randomUUID } from 'node:crypto'
   import { desc } from 'drizzle-orm'
   import { deckAssets, deckVersions } from '../db/index.js'
   import { parseArchive } from '../archive/parse-archive.js'
   import { rewriteAssetUrls } from '../archive/rewrite-asset-urls.js'
   import { ArchiveError } from '../archive/errors.js'

   const DEFAULT_MAX_BYTES = 100 * 1024 * 1024 // 100MB
   function getMaxBytes(): number {
     const raw = process.env.LUMIDECK_IMPORT_MAX_BYTES
     const n = raw ? Number(raw) : NaN
     return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES
   }

   decksArchiveRoute.post('/decks/import', async (c) => {
     const user = c.get('user')
     if (!user) return c.json({ error: 'unauthorized' }, 401)

     // 1. 接 multipart 文件
     const body = await c.req.parseBody()
     const file = body.file
     if (!(file instanceof File)) {
       return c.json({ error: '请上传 .lumideck 文件(form 字段名 file)' }, 400)
     }
     const max = getMaxBytes()
     if (file.size > max) {
       return c.json({ error: `数据包超过 ${Math.round(max / 1024 / 1024)}MB 上限` }, 413)
     }

     const buf = Buffer.from(await file.arrayBuffer())

     // 2. parse + validate
     let parsed: Awaited<ReturnType<typeof parseArchive>>
     try {
       parsed = await parseArchive(buf)
     } catch (err) {
       if (err instanceof ArchiveError) {
         logServerEvent({
           category: 'archive-import',
           event: 'parse-failed',
           userId: user.id,
           errorCode: err.code,
           errorMsg: err.userMessage,
         })
         return c.json({ error: err.userMessage, code: err.code }, 400)
       }
       logServerEvent({
         category: 'archive-import',
         event: 'parse-failed',
         userId: user.id,
         errorMsg: (err as Error).message,
       })
       return c.json({ error: '数据包损坏' }, 400)
     }

     // 3. DB transaction:create deck + version + 还原 assets(rewrite URL)
     const db = getDb()
     let result: { deckId: number; title: string }
     try {
       result = await db.transaction(async (tx) => {
         const newTitle = `${parsed.manifest.deck.title}(导入)`
         await tx.insert(decks).values({
           userId: user.id,
           title: newTitle,
           templateId: parsed.manifest.deck.templateId,
         })
         const [created] = await tx
           .select({ id: decks.id })
           .from(decks)
           .where(eq(decks.userId, user.id))
           .orderBy(desc(decks.id))
           .limit(1)
         if (!created) throw new Error('deck 回查失败')

         // 建 idMap:每张原 asset 用新 uuid 重插
         const idMap = new Map<string, string>()
         for (const [oldId, bytes] of parsed.assets.entries()) {
           const newId = randomUUID()
           const meta = parsed.manifest.assets.find((a) => a.id === oldId)!
           await tx.insert(deckAssets).values({
             id: newId,
             deckId: created.id,
             userId: user.id,
             mimeType: meta.mimeType,
             bytesSize: meta.bytesSize,
             data: bytes,
             prompt: meta.prompt,
             model: meta.model,
           })
           idMap.set(oldId, newId)
         }

         // rewrite markdown 内 /api/assets/<oldId> → newId
         const newContent = rewriteAssetUrls(parsed.content, idMap)
         await tx.insert(deckVersions).values({
           deckId: created.id,
           content: newContent,
           message: `从 .lumideck 导入(原 deck #${parsed.manifest.deck.originalDeckId})`,
           templateId: parsed.manifest.deck.templateId,
           authorId: user.id,
         })
         const [firstVer] = await tx
           .select({ id: deckVersions.id })
           .from(deckVersions)
           .where(eq(deckVersions.deckId, created.id))
           .orderBy(desc(deckVersions.id))
           .limit(1)
         if (!firstVer) throw new Error('version 回查失败')

         await tx
           .update(decks)
           .set({ currentVersionId: firstVer.id })
           .where(eq(decks.id, created.id))

         return { deckId: created.id, title: newTitle }
       })
     } catch (err) {
       logServerEvent({
         category: 'archive-import',
         event: 'db-failed',
         userId: user.id,
         errorMsg: (err as Error).message,
       })
       return c.json({ error: '还原失败,请重试' }, 500)
     }

     logServerEvent({
       category: 'archive-import',
       event: 'success',
       userId: user.id,
       deckId: result.deckId,
       assetCount: parsed.assets.size,
     })
     return c.json(result, 201)
   })
   ```

3. 单测 `packages/agent/test/archive-parse.test.ts`:
   - happy:用 buildArchive 出一个真包 → parseArchive → 断 manifest / content / assets 都对
   - schemaVersion = 99 → 抛 ArchiveError code: schema-unsupported / userMessage 含「99」+「不被当前 Lumideck 支持」
   - manifest 字段缺 (deck.title 删) → manifest-invalid
   - asset 文件被删 → asset-missing
   - asset bytesSize 改大 → asset-corrupt
   - 非 zip Buffer(全 0xFF)→ not-a-zip
4. 集成测 `packages/agent/test/routes-decks-archive.test.ts`(import 部分):
   - import happy:user A export → user B 用 multipart POST → 断 201 + 返 `{ deckId, title }`;新 deck title 含「(导入)」+ 用 GET /decks/:id 校 currentVersion.content 含 rewrite 后的 asset url + deck_assets 表内有 N 个新 uuid 的 asset(查 deck_assets WHERE deck_id=newId)
   - schemaVersion 不支持 → 400 + code: schema-unsupported
   - manifest 字段缺 → 400 + code: manifest-invalid
   - 损坏 zip → 400 + code: not-a-zip
   - oversized → 413(用 vi.stubEnv `LUMIDECK_IMPORT_MAX_BYTES=100` 让小文件也超)
   - 未登录 → 401
   - **Round-trip 测试**(关键!):createTestUser + createDeckDirect(含 2 个 deck_asset)→ export-archive 拿 buffer → 删原 deck → 用同一 user import → 校新 deck 跟原 deck 的 markdown(asset url 部分需要 rewrite 但其余 byte-equal)+ asset count 一致 + asset bytes 一致(读 deck_assets 表 BLOB)

**验证方法**:

- `pnpm -F @big-ppt/agent vitest run test/archive-parse.test.ts test/routes-decks-archive.test.ts`
- 手测:export 一个含图 deck → 在 deck 列表点导入 → 新 deck 跳转 → 检查 AI 图仍可见(URL 应该是新 uuid)

**风险**:

- **Aliyun RDS prepared-statement stale plan**(CLAUDE.md 已知坑):测试 setup 已经从 `TRUNCATE` 改 `DELETE FROM`,本 Phase test setup 沿用 `useTestDb()` 不动 → 无 risk
- **db.transaction MySQL implicit commit**:DDL 语句(`CREATE TABLE` 等)会触发 implicit commit;本 Phase 全是 DML(INSERT / UPDATE),drizzle transaction 套 mysql2 的 connection-scoped transaction 应可回滚;**但**先验:transaction 中途抛 throw 后,新 deck 行不应该残留(测一个 case:mock idMap 抛错 → 校 deck 表 count 仍是 0)
- **multipart parseBody 内存峰值**:Hono `c.req.parseBody()` 把整文件 load 到内存;100MB 限 + Buffer.from 复制一次 → 峰值 ~200MB;Node v22 默认 heap 1.5GB,可接受;但**大量并发 import 时风险**,本期不解,记 Phase 17+
- **新 deck 回查走 `desc(id).limit(1)`**:跟 routes/decks.ts 同套路;有 race condition 隐患(同 user 并发 import 两个包),但 dogfood 期单用户不会并发;现实可接受
- **transaction 内 randomUUID() 生成 36 char string**:跟现有 deck_assets.id 类型一致(varchar(36)),无 issue
- **rewrite-asset-urls 正则只匹配 `/api/assets/<uuid>`**:若导入 markdown 含 `/api/assets/<旧-uuid>` 但 oldId 不在 idMap(用户手贴了一个野 url),保持原样;import 后那个 url 在新账号会 404 但 deck 渲染不崩 — 可接受 graceful degrade

**工时**:2d

---

### Task 31-D:Frontend Export 入口扩 useExport + ExportModal 第 4 个 radio(0.5d)

**目的**:编辑器顶栏「导出」modal 加 `.lumideck` 选项;选中后不走截图链路,走 `GET /api/decks/:id/export-archive` 直接 download。

**操作**:

1. 改 `packages/creator/src/composables/useExport.ts`:
   ```ts
   export type ExportFormat = 'pdf' | 'png-zip' | 'pptx' | 'lumideck'
   // exportDeck 内部加分支:
   if (format === 'lumideck') {
     progress.value = { done: 0, total: 1 } // 后端无逐页进度,显示 indeterminate
     const resp = await fetch(`/api/decks/${deck.id}/export-archive`, {
       credentials: 'include',
     })
     if (!resp.ok) {
       const errText = await resp.text().catch(() => '')
       throw new Error(`导出失败: ${resp.status} ${errText || resp.statusText}`)
     }
     const blob = await resp.blob()
     const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_')
     const filename = `${safeName}-${Date.now()}.lumideck`
     triggerDownload(blob, filename)
     return
   }
   // 其余三 format 沿用原 capturePages 链路 ...
   ```
2. 改 `packages/creator/src/components/ExportModal.vue`:
   - 加第 4 个 radio `format-lumideck`:
     ```vue
     <label class="format-option" :class="{ active: format === 'lumideck' }">
       <input v-model="format" type="radio" name="export-format" value="lumideck"
              :disabled="exporting" data-test="format-lumideck" />
       <div class="format-meta">
         <span class="format-name">归档包 (.lumideck)</span>
         <span class="format-hint">≈ 3 秒 · 给其他 Lumideck 用户导入用</span>
       </div>
     </label>
     ```
   - 进度条文本兼容:lumideck format 进度是 indeterminate,显示 "正在打包..." 而非 "第 X/N 页"
3. 单测改 `packages/creator/src/composables/__tests__/useExport.test.ts`:
   - 加 case:format = 'lumideck' → fetch mock 返 fake blob → 断 triggerDownload 被调 with `.lumideck` ext + 文件名 + 不调 capturePages
   - 加 case:fetch 返 401 → 抛错 + error.value 设
   - 加 case:fetch 返 500 → 抛错
4. 单测改 `packages/creator/src/components/__tests__/ExportModal.test.ts`:加 radio `data-test="format-lumideck"` 切换 + 进度条文本断言

**验证方法**:

- `pnpm -F @big-ppt/creator vitest run src/composables/__tests__/useExport.test.ts src/components/__tests__/ExportModal.test.ts`
- 手测:dev mode → 编辑器顶栏导出 → 选 .lumideck → 下载条出现 + 文件 ext `.lumideck`

**风险**:

- **fetch 跟项目惯例**:CLAUDE.md「前端约定」要求 API 调用走 `packages/creator/src/api/` 不直接 fetch;但 useExport 已有先例(直接 fetch /api/...),follow 同套路;后续 Phase 可重构提到 api/archive.ts
- **CSP / 跨域**:同源,无 risk
- **`<input type="file">` 触发的 download blob URL revoke**:triggerDownload 已经 `setTimeout(() => URL.revokeObjectURL(url), 0)`,无 leak

**工时**:0.5d

---

### Task 31-E:Frontend Import 入口 + useImport composable + DeckListPage 按钮 + E2E(2d)

**目的**:deck 列表页用户视角的 import 闭环 + 端到端 round-trip 验真。

**操作**:

1. 新建 `packages/creator/src/composables/useImport.ts`:

   ```ts
   import { ref } from 'vue'

   export interface ImportResult {
     deckId: number
     title: string
   }

   export function useImport() {
     const importing = ref(false)
     const error = ref<string | null>(null)
     async function importArchive(file: File): Promise<ImportResult> {
       importing.value = true
       error.value = null
       try {
         const form = new FormData()
         form.append('file', file)
         const resp = await fetch('/api/decks/import', {
           method: 'POST',
           body: form,
           credentials: 'include',
         })
         if (!resp.ok) {
           const data = (await resp.json().catch(() => ({}))) as { error?: string }
           const msg = data.error || `导入失败 ${resp.status}`
           error.value = msg
           throw new Error(msg)
         }
         return (await resp.json()) as ImportResult
       } finally {
         importing.value = false
       }
     }
     return { importing, error, importArchive }
   }
   ```

2. 改 `packages/creator/src/pages/DeckListPage.vue`:
   - script 加:
     ```ts
     import { useImport } from '../composables/useImport'
     import { Upload } from 'lucide-vue-next'
     const { importing, error: importError, importArchive } = useImport()
     const fileInput = ref<HTMLInputElement | null>(null)
     function onImportClick() {
       fileInput.value?.click()
     }
     async function onFileChange(e: Event) {
       const target = e.target as HTMLInputElement
       const file = target.files?.[0]
       target.value = '' // 允许选同一文件再次触发
       if (!file) return
       try {
         const result = await importArchive(file)
         await router.push(`/decks/${result.deckId}`)
       } catch {
         /* useImport 已 set error,template 渲染 */
       }
     }
     ```
   - template 加按钮 + 文件 input + 错误显示
   - 加 `.btn-secondary` style(对齐项目惯例)
3. 单测 `packages/creator/src/composables/__tests__/useImport.test.ts`:
   - happy:mock fetch 返 `{ deckId: 7, title: 'X(导入)' }` → 断 importArchive 返该 obj + form 字段 file 正确
   - 400 schema 错:mock 返 `{ error: '数据包版本 N 不被支持' }` → 断 throw + error.value
   - 413 oversized:同上
4. 单测 `packages/creator/src/pages/__tests__/DeckListPage.test.ts`(若已存则扩):
   - render → 断「导入」按钮可见 + accept `.lumideck`
   - 模拟选文件 → fetch mock → 断 router.push(`/decks/N`) 被调
   - mock fetch 返错 → 断 error 文本出现
5. E2E `packages/e2e/tests/archive-export.spec.ts`:
   - 注册 + 登录 + 创建 deck(走 picker)
   - 编辑器内点导出 → 选 .lumideck radio → confirm → waitForEvent('download')
   - 断 download filename 含 `.lumideck` + size > 100 bytes(空 deck 也得有 manifest + content.md)
   - download.path() 后用 `node:fs.statSync` + `node:fs.readFileSync` 读 magic bytes 前 4 字节 = `PK\x03\x04`
6. E2E `packages/e2e/tests/archive-roundtrip.spec.ts`:
   - 注册 + 登录 + 创建 deck(starter,无 AI 图也行) + export .lumideck → save 到 /tmp
   - 删原 deck(deck 列表点 trash)
   - 在 deck 列表点「导入」按钮 → setInputFiles 模拟选 /tmp/...lumideck
   - 等 router.push 到 `/decks/<新 id>` → 断标题含「(导入)」+ 默认 5 页 starter 仍可见
   - **可选**(若 fixture deck 含 AI 图):断 AI 图 `<img>` src 应该指向新 uuid(`expect(img.src).not.toContain(原 uuid)`)
7. 改 `docs/requirements/roadmap.md` Phase 15 段落(close-out 时):标 ✅ + 链接 plan 31

**验证方法**:

- `pnpm -F @big-ppt/creator vitest run src/composables/__tests__/useImport.test.ts src/pages/__tests__/DeckListPage.test.ts`
- `pnpm -F @big-ppt/e2e test --grep archive`
- 手测:登录 → export deck → 退出登录注册另一个账号 → 登录 → 列表页点导入 → 选 .lumideck → 跳新 deck → 看图

**风险**:

- **多账号 cookie 隔离**:E2E 跨账号场景在 playwright 用两个 `browser.newContext()` 实现;round-trip 测可以**同一账号**先 delete 再 import 避免复杂度
- **VueTestUtils 不跨 Teleport**(CLAUDE.md 已知坑):DeckListPage 自身不用 Teleport(无 modal),但 import error 显示用 plain `<p>` 不用 modal 简化测试
- **`<input type="file" accept=".lumideck">` 浏览器不识别 `.lumideck`**:`accept` 只是 hint,浏览器不强制;OS 文件选择器会以「兼容」模式显示;**反正提交 server 也会重新 magic-bytes 校验**,不必担心 client 端 accept 不严
- **DeckListPage 文件 input target.value 清空**:必须有,否则用户选同一文件第二次不触发 change event
- **import 没进度条**:dogfood 期接受,Phase 17+ 加 SSE 进度(每 N MB 报一次)

**工时**:2d

---

## 验收条件(roadmap.md Phase 15 清单映射)

- [ ] **export `.lumideck` 文件 < 5s 出包**(含 N=10 AI 图 deck):集成测覆盖 + 手测计时
- [ ] **import 同账号刚 export 的 .lumideck → 新 deck 视觉跟原 deck 像素级一致**:E2E `archive-roundtrip.spec.ts` 覆盖 + 手测含 AI 图 deck
- [ ] **schemaVersion 不在 SUPPORTED_SCHEMA_VERSIONS 时,import 端点返 400 + 友好错误**:集成测 `archive-parse.test.ts` + `routes-decks-archive.test.ts`
- [ ] **跨账号 import 隔离**:用户 A 的包用户 B 能 import 成 B 的新 deck,不污染 A — 集成测覆盖
- [ ] **损坏 zip / 缺 manifest / manifest 字段缺失 → 友好错误不 crash**:集成测全分支覆盖
- [ ] export 路由 ownership 校验(越权 403)
- [ ] import 路由 size cap 413 / 未登录 401
- [ ] 编辑器顶栏导出 modal 含「归档包 (.lumideck)」radio
- [ ] deck 列表页含「导入」按钮 + accept `.lumideck`
- [ ] 全量回归(`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿)
- [ ] coverage 门槛维持(agent 90/85,creator 75/65)

---

## 不做什么(范围围栏)

- ❌ **Markdown 粘贴导入** / 任意 `.md` 转 deck：2026-07-11 产品决策，永久不做
- ❌ **PPTX 外部格式导入**：2026-07-11 产品决策，永久不做
- ❌ **跨 schema version 自动 migration**:不支持版本直接 400 让用户用新版 Lumideck 重新导出
- ❌ **import 时分支冲突解决**(同名 deck / 同 ID 冲突):一律 new deck,标题加「(导入)」后缀
- ❌ **包内 user_assets**(ChatPanel 上传的 PDF/DOCX 等参考资料):不在 deck 渲染路径
- ❌ **包内 deck_versions 历史**:只 export 当前 currentVersion;历史属 audit 不在备份语义
- ❌ **异步任务队列 / jobs 表 / 进度 SSE**:同步路由已能满足 < 100MB 包 5s 内场景
- ❌ **导入历史记录表 / 重新下载**:留 Phase 17+
- ❌ **包加密 / 数字签名**:留 Phase 17+(企业场景需求)
- ❌ **改 deck_assets / decks / deck_versions schema 字段**:本 Phase 零 schema 变更
- ❌ **archiver / tar-stream 等新 zip 库**:jszip 已够用
- ❌ **删除 Phase 14 export 链路**:.lumideck 跟 PDF/PNG/PPTX 互补共存

---

## 踩坑预案(实施前预告;实施期发现新坑回写"踩坑与解决")

### 预案 1:Hono sub-router wildcard middleware 泄漏

- **关联 CLAUDE.md 已知坑**:plan 18 Phase 9-B/9-C 踩
- **本 Phase 应用**:`decksArchiveRoute` **不写** `decksArchiveRoute.use('*', mw)`,只用显式 path(`decksArchiveRoute.get('/decks/:id{...}/export-archive', ...)`),无 wildcard 泄漏 risk
- **测试守门**:集成测**必须**走 `app.fetch()` 真路由 mount(routes-decks-archive.test.ts 已规划)

### 预案 2:shared 包 NodeNext build 不完整 → 生产 ERR_MODULE_NOT_FOUND

- **关联 CLAUDE.md 已知坑**:plan 19 踩坑 4(shared)+ Phase 11.6 (slidev/\_catalog)
- **本 Phase 应用**:Task A 新建 `packages/shared/src/archive.ts` 后,**必须**跑 `pnpm -F @big-ppt/shared build` emit `.js` + `.js.map`;`scripts/deploy.sh build_agent` 已含 shared build,本 Phase 不动部署脚本,只需 commit 前本地 build 一次跑测

### 预案 3:db.transaction 内 prepared statement stale

- **关联 CLAUDE.md 已知坑**:plan 29 踩坑 1(Aliyun RDS TRUNCATE → DELETE FROM)
- **本 Phase 应用**:test setup 沿用 `useTestDb()` 已经走 DELETE,无 risk;`randomUUID()` 是 v4 uuid 碰撞概率 2^-122,可忽略

### 预案 4:multipart parseBody 100MB 文件 → Node 内存峰值 200MB

- **预期症状**:用户同时 import 多个大包时 agent 进程 OOM 触发 pm2 restart
- **根因**:Hono `c.req.parseBody()` 把整文件 load 到内存 Buffer + `Buffer.from(await file.arrayBuffer())` 再复制一次 = 2 × file.size
- **预防**:env `LUMIDECK_IMPORT_MAX_BYTES` 默认 100MB 限单包;dogfood 期单用户串行 import;Phase 17+ 改 streaming 解 zip(用 `unzipper` 包 + 逐 entry stream)
- **监控**:`logServerEvent` category `archive-import` event `success` 带 `bytesSize`,长期数据看用户实际包大小分布

### 预案 5:asset url rewrite 漏 case → 新 deck 显示空图

- **预期症状**:import 后新 deck 打开,AI 图位置空白(`<img src="">`)或 404
- **根因**:`rewriteAssetUrls` 正则只匹配标准 `/api/assets/<uuid>` 格式;若 markdown 内出现其他形式(`/api/assets/<uuid>?v=2` 或 `'/api/assets/<uuid>'` 带引号边界)可能漏匹配
- **预防**:rewrite-asset-urls 单测覆盖各种边界(引号 / 空格 / query string / 嵌入 markdown 段落);正则用 `/g` flag 全文 replace 不止第一次;遗漏的 url 保持原样(map 中无对应 id 时不改),fallback 优雅(图缺但 deck 不崩)
- **手测兜底**:Phase 15 实施时 Task E E2E 必须含 AI 图 round-trip,人眼断图正常显示

### 预案 6:CLAUDE.md「禁用 git add -A」+ subagent 并行撞 git index

- **关联 CLAUDE.md 已知坑**:Phase 13 踩坑 2 commit `0c4bb8a`(并行 3+ agent 共享 worktree 撞 git index)
- **本 Phase 应用**:Task B / C 标记可并行(后端 + 前端独立),但**必走 git worktree**(`superpowers:using-git-worktrees`);Task A / D / E 串行无 risk
- **commit 规则**:每 Task 一个 commit,**只 git add 显式文件名**,严禁 `git add -A`

### 预案 7:jszip generateAsync nodebuffer 大 deck 内存

- **预期症状**:N=50 张 1MB 图打包时 jszip 内存峰值高 / generateAsync 慢
- **根因**:jszip 内部把所有 entry 维持在 internal map,generate 时 single-pass build 整个 Buffer
- **预防**:dogfood 期单 deck N < 20 张图,实测可控(< 50MB Buffer);若用户量起来改 archiver 真 streaming(file-by-file pipe to ReadableStream)
- **compression level 6 是默认**:更高(9)CPU 倍增收益微;更低(1)PNG 已经压缩过,deflate 收益小,选 `compression: 'STORE'` 跳二次压缩(参考 Phase 14 to-png-zip.ts 同套路)

### 预案 8:Aliyun RDS 上 deck_assets BLOB 一次性 SELECT N 行内存峰值

- **预期症状**:`db.select().from(deckAssets).where(eq(deckId, X))` 拉 N 行 MEDIUMBLOB 时 mysql2 driver 把所有 row buffer 化到内存
- **根因**:mysql2 默认是 buffered query;非 streaming
- **预防**:N < 20 张 < 50MB 可接受;若 prod 单 deck 巨多图,改用 mysql2 `pool.query(...).stream()`(plan 17+ 优化项)
- **监控**:`logServerEvent` 加 `assetCount` + `totalBytes` 字段,长期看分布

### 预案 9:Vitest 4 vi.mock dynamic import 不稳定

- **关联 CLAUDE.md 已知坑**:plan 17 踩坑 2(Vitest 4 起 vi.mock 对 dynamic import 拦截不稳定)
- **本 Phase 应用**:archive-build / archive-parse 单测里 mock `jszip` / `getDb`,**必须**用 static import + 顶层 `vi.mock(..., () => ({...}))` factory,**不**在 test 内 `await import('jszip')`
- **集成测**走 real DB + real jszip,无 mock 路径,稳定

### 预案 10:Buffer / Uint8Array / ArrayBuffer 类型混乱

- **关联 CLAUDE.md 已知坑**:plan 30 踩坑 3(buffer polyfill 跟 node Buffer 是不同 class)
- **本 Phase 应用**:agent 全 Node Buffer(原生),无 polyfill 问题;creator 端 useImport 接 File / FormData,**不**碰 Buffer;断言用 `instanceof Uint8Array` 不用 `Buffer.isBuffer()` 保险
- **`new Response(u8, ...)` 不直接传 Buffer**:Buffer 的 underlying ArrayBufferLike 在新 TS 下不兼容 BodyInit 期望;复制到全新 Uint8Array(已在 assets.ts 沿用此套路)

---

## 执行期偏离(2026-05-18 close)

### 偏离 #1:Task B 多加 `:id{[0-9]+}` regex 数字限定

- Why:让 Task C 的 `POST /api/decks/import` 字面量 path 不会被 `/decks/:id/export-archive` handler 误吞(`:id` 默认贪婪)
- 影响:无功能差,提前防 routing 冲突;集成测加 non-digit-id case 兜底

### 偏离 #2:Task C `.find()` 改 Map.get O(N²) → O(1)(reviewer 标的 Minor 1 一并修)

- Why:Task C code-quality reviewer 发现 import asset loop 内 `parsed.manifest.assets.find(a => a.id === oldId)` 每次 O(N) scan。N < 20 当前无感,Map 索引让代码更清晰 + invariant 显式
- 影响:正向 — 移除原"parseArchive 已保证,防御性"注释,Map.get + non-null assertion 已表达不变量

### 偏离 #3:Task B Content-Disposition 加 RFC 6266 双 filename(CJK 防乱码)

- Why:Task B code-quality reviewer 发现 Lumideck 用户主要中文 deck title,HTTP header 非 ASCII 字符不带 percent-encoding 会导致 Chrome 下载文件名乱码。`routes/assets.ts` 不撞坑因为 asset id 是纯 UUID(ASCII),Task B 是项目第一个 emit 用户自定义中文 filename 的下载路径
- 影响:正向 — header 加 `filename*=UTF-8''<percent-encoded>` + ASCII fallback,modern browser 优先读 UTF-8 编码;集成测加 `Q1 业务汇报` case 精确断 percent-encoded sequence + decodeURIComponent 反解 byte-equal

### 偏离 #4:Task C import 加 templateId whitelist 校(防 silent dysfunctional deck)

- Why:Task C code-quality reviewer 发现 import 不校 `manifest.deck.templateId` 在 registry,unknown templateId 写进 decks 表后 → 下游 `getManifest()` 全返 null → deck 看起来创建成功但 AI 出图崩 / 切模板挂 / 预览空。跟 `routes/decks.ts:92-94` 已有 `POST /api/decks` whitelist 检查不一致,plan 抉择 #3「明确报错让用户重新导出比 silent migrate 安全」也支持
- 影响:正向 — transaction 前加 `getManifest(tplId)` 校,返 400 + `code: 'template-unknown'` + logServerEvent audit;集成测加 1 case 用 jszip 重打包改 templateId 为 unknown 验

### 偏离 #5:Task E `ImportResult` 改 `ImportArchiveResponse` 提到 shared 包

- Why:Task E code-quality reviewer 发现 useImport 本地定义 `ImportResult` interface 跟 backend decks-archive.ts return type drift。CLAUDE.md「跨 workspace 包共享 TS types 走单向 re-export:shared 是 source-of-truth」明示
- 影响:正向 — hoist 到 `packages/shared/src/archive.ts`,agent/creator 双向 import,字段改名 TypeScript 一致守门

### 偏离 #6:Task A ArchiveError 改 `override readonly cause?`

- Why:Task A code-quality reviewer 发现 implementer 初版用 `(this as { cause?: unknown }).cause = cause` runtime cast 绕过 type system。LLMError 已有 `override readonly cause?: unknown` ES2022 标准写法 + IDE hover 可见 + `noImplicitOverride: true` 项目标准
- 影响:正向 — 统一项目 typed error pattern

### 偏离 #7:close-out 时补 `.env.example` + `.env.production.example` 加 `LUMIDECK_IMPORT_MAX_BYTES`

- Why:Task C implementer 漏写,Phase 15 final audit 发现。plan 抉择 #11 明示需加。controller 在 close-out 统一补,避免再起 implementer 轮
- 影响:正向 — 文档合规

---

## 踩坑与解决(2026-05-18 close)

### 坑 1:`createApp(Host)` 不继承 main app 全局组件注册 →(Phase 14 已上 CLAUDE.md,本 Phase 不再踩)

本 Phase 不涉及客户端 Vue app instance new。Phase 14 已落 CLAUDE.md 提炼,本 Phase 直接受益。

### 坑 2:HTTP `Content-Disposition` filename 非 ASCII 不 percent-encode → Chrome 下载文件名乱码

- **症状**:Lumideck 用户中文 deck title(`Q1 业务汇报`)export `.lumideck` 时,Chrome 下载到 `Q1 ____-1234.lumideck`(字符显示成下划线 / 问号);Safari / Firefox 行为各异
- **根因**:RFC 6266 + RFC 8187 要求非 ASCII filename 必须用 `filename*=UTF-8''<percent-encoded>` 编码;`Content-Disposition: attachment; filename="..."` 不带 `filename*` 时非 ASCII 字节 undefined behavior
- **修复**:header 改双 filename — `filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>`(percent encoding 用 `encodeURIComponent`);ASCII fallback 把非 ASCII 替成 `_` 给老 client
- **防再犯**:项目里任何新 emit 用户自定义中文字符串到 HTTP header(尤其 Content-Disposition / Content-Type 的 boundary 等)的地方都要走 RFC 6266 encoding。`routes/assets.ts` 不撞坑因为 asset id 是纯 UUID;Task B 是第一个 download 用户自定义 title 路径。**已提炼到 CLAUDE.md「已知坑」**

### 坑 3:Vue `createApp` 第 4 个 commit(c7929e5)前 `ArchiveError.cause` 用 runtime cast 绕 type system

- **症状**:type-check 通过但 IDE hover 看不到 cause 字段,call sites 拿不到 typed cause
- **根因**:`(this as { cause?: unknown }).cause = cause` 是 TS 静默写入,跟 `LLMError` 的 `override readonly cause?: unknown` 构造参数标准 ES2022 写法不一致
- **修复**:改 `override readonly cause?: unknown` 标准写法,删 if cast
- **防再犯**:typed error class 用 `override readonly cause` 跟 LLMError 一致,**不**用 runtime cast 绕 TS。**不提炼到 CLAUDE.md**,本 Phase 一次性 align,LLMError 已有先例

---

## 测试数量落地(2026-05-18 close)

| 指标                    | 起点(Phase 14 close)                | 终点(Phase 15 close)                           | 增量                                                         |
| ----------------------- | ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| agent unit cases        | 970                                 | 1014                                           | +44                                                          |
| agent test files        | (baseline)                          | +4(archive-mime-ext / rewrite / build / parse) | +4                                                           |
| agent integration cases | (含在 unit)                         | (含)                                           | +17(routes-decks-archive 7 export + 10 import 含 round-trip) |
| creator unit cases      | 315                                 | 327                                            | +12                                                          |
| creator test files      | (baseline)                          | +2(useImport / DeckListPage)                   | +2                                                           |
| shared 包               | -                                   | +archive.ts                                    | +1 文件                                                      |
| E2E specs(archive 类)   | 0                                   | 2(`archive-export` + `archive-roundtrip`)      | +2                                                           |
| coverage lines          | 维持 agent 90%+ / creator 75%+ 门槛 | 维持                                           | -                                                            |
| coverage branches       | 维持 agent 85%+ / creator 65%+ 门槛 | 维持                                           | -                                                            |

**Phase 15 commit chain**(由旧到新,10 commit):

| SHA       | 内容                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| `23ee014` | docs(phase15): 重定义 Phase 15 为「归档数据包 export + import 双向闭环」                                       |
| `7531f0a` | feat(phase15-A): shared archive types + agent mime-ext / errors / rewrite-asset-urls 基建                      |
| `c7929e5` | fix(phase15-A): ArchiveError 改 override readonly cause? 跟 LLMError 一致                                      |
| `16821cb` | feat(phase15-B): buildArchive + GET /api/decks/:id/export-archive route                                        |
| `1b517a6` | fix(phase15-B): Content-Disposition 加 RFC 6266 filename\* UTF-8 编码(中文 title 下载防乱码)                   |
| `fb0c3d0` | feat(phase15-C): parseArchive + POST /api/decks/import route + round-trip 测试                                 |
| `52d7b7b` | fix(phase15-C): import 加 templateId whitelist 校(防 unknown 模板 silent corruption)+ .find() → Map index 性能 |
| `f566546` | feat(phase15-D): ExportModal 加 .lumideck radio + useExport lumideck 分支                                      |
| `11fe3d0` | feat(phase15-E): useImport + DeckListPage 导入按钮 + E2E archive export/roundtrip                              |
| `c8acf86` | fix(phase15-E): ImportArchiveResponse 类型提到 shared 包(source of truth)                                      |

**实施总工时**:plan 估 7d,实际(subagent-driven-development + 多轮 review fix)wall-clock 约 **6h**(controller + 5 fresh implementer + 10 reviewer 轮次)。跟 Phase 14 同 pattern;subagent 流程比传统单线程提速 ~8-10x。
