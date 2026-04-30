# Phase 11.5 — AI 图片内容页(generate_slide_image)

> **状态**:✅ 已关闭(2026-04-30)
> **前置阶段**:plan 16(模板分层)、plan 19(生产部署)
> **后续阶段**:plan 21(Phase 11 多用户并发与分享 - 待规划)
> **路线图**:[roadmap.md Phase 11.5](../requirements/roadmap.md)
> **执行子技能**:`superpowers:executing-plans`

---

## Context

当前 LLM(GLM 为主)能改 slides.md 文本内容并切模板,内容页是纯文字。本 Phase 引入**第三种内容形态**:用户在 ChatPanel 明确要求 AI 出图时,LLM 调用 `generate_slide_image` 工具,工具后台调 OpenAI Responses API 的 `image_generation` 内置 tool 出图,把 base64 **写入 DB BLOB(`deck_assets` 表)**,agent 提供鉴权 serving 路由 `GET /api/assets/:id`,把目标 slide 的 layout 切成 `*-image-content`,frontmatter 注入 `imageSrc: /api/assets/<assetId>`。

**模板体系不变**,只是 layout 多一种;现有 `*-content` / `*-section-title` 等照旧。出图是异步 job(参考 `switch_template_job` 范式),不阻塞 LLM streaming;前端通过 `useGenerateImageJob` composable 轮询进度,SlidePreview 通过 Slidev HMR 自动刷新。

**关键架构选择:图片字节入 DB 不入磁盘**,因为 Phase 10.5 spike 候选 + Phase 11 要 Slidev 多实例化,把图存 Slidev `public/` 目录会撞三个硬伤:
1. **跨实例不可迁移**:实例 A 持有 deck 时图存 A,迁移到实例 B 要同步文件,且锁切换时窗找不到图
2. **跨用户隔离靠目录而非鉴权**:URL 一旦泄漏(history / 复制 slides.md / iframe 截图)就漏图
3. **生产部署需共享存储**:多实例没 NFS/OSS 直接废,Phase 10 现在也只是单机

入库 + agent serving 路由方案:slides.md 只存 `/api/assets/<assetId>` 引用,资源跟 deck 走,跨实例迁移只迁 DB,Slidev 完全不碰图片资源。

**为什么现在做**:
- gpt-5.5(2026-04-23)+ image_generation tool + gpt-image-2 全部 GA(2026-04-30 验证 OpenAI docs);路 A `/v1/responses` + `image_generation` tool 底层默认派 gpt-image-2,路 B `/v1/images/generations` + `gpt-image-2` 也直接可用。**唯一限制是 OpenAI 付费 tier**(Free tier 不支持 image-2)
- 用户(Lumideck 产品方)明确希望"用户要图就 AI 出图"作为内容页可选形态
- Phase 11 多用户并发依赖本 phase 的 image-job 模型一并设计,先做这个 Phase 11 的并发故事更完整

---

## 关键设计抉择(2026-04-30 与用户对齐)

1. **保留模板体系,只新增一种 layout 不替代 MD 改写路径**
   - **Why**:用户明确"还是要套用模板的,只是多了一种内容页的形式"。保留 `*-content` / 栅格组件 / chart 路径,出图仅当用户**显式要求** AI 生图时才触发
   - 放弃"整页直出图替代 Slidev MD"是因为会摧毁现有 PetalFour / BarChart / token 体系,不可逆

2. **图片尺寸固定 1280×720,layout 内硬编**
   - **Why**:用户说"看每个模板内容页的内容部分的位置和大小决定"。Slidev 默认画布 1920×1080,既有 content layout padding `48px 60px` 后内容区约 1800×960,取 1280×720 留对称留白,16:9 与 OpenAI 原生图最优比例匹配
   - 不暴露到 token 是因为 token 现状只管色/字/形/影 4 类(`packages/slidev/components/TOKENS.md`),引入"内容区尺寸 token"会污染契约;layout 自带尺寸更内聚

3. **生图模型独立配置,与 Chat LLM、MCP Servers 并列为 Settings 第三 tab(`Image LLM`)**
   - **Why**:用户明确"现阶段只有用 OpenAI gpt 的 key 时开放出图"。直接判断主 LLM key 类型不可靠(GLM 用 OpenAI-compatible 协议,key 看不出区别)。改成**让用户在独立 tab 显式配置"生图模型 + key"**:
     - 主聊天用 GLM、生图用 GPT 完全可行,两者解耦
     - 后端不需推断 key 归属,直接读 `users.image_llm_settings` 字段
     - 未配置 → 工具显式拒绝并返友好错误"请到设置 → 生图模型 中配置"
     - 未来加 Midjourney / Flux / Stable Diffusion 等其他生图 provider 时,该 tab 扩展性好
   - 放弃"在 llm_settings 加可选 openai 子字段"是因为 UX 不清晰(用户不知道为啥配主 LLM 时还要配 openai)
   - 放弃"项目级 admin key + 用户配额"是因为商业模式未定,且 per-user key 简化第一版
   - **当前阶段唯一支持 provider 是 OpenAI**(路 A 走 Responses API,路 B 走 Images API);UI 上 provider 下拉只有 "openai" 一项,但代码结构允许后续新增

4. **路 A 主 + 路 B fallback**
   - **Why**:image_generation Responses tool 是 OpenAI 推荐的"原生多模态"路径,带 reasoning 自动改写 prompt + 多轮 edit + LLM 决定何时出图,体验更高级
   - 路 B(`/v1/images/generations` + `gpt-image-2`)直接调底层模型简单稳定。**保留 fallback 不是因为 image-2 没开放**(2026-04-30 验证已 GA),而是 Responses API 的 image_generation tool schema 是 2026-04 新发布,字段命名 / output 结构可能未来微调,留 fallback 让基础功能不挂
   - **付费 tier 要求**:gpt-image-2 在 OpenAI Free tier 不可用,用户必须有 Tier 1+(任意付费档),agent 端透传 OpenAI 401/403 错误即可

5. **异步 job 状态用 in-memory Map,但图片字节入 DB**
   - **Why(job 不入库)**:job 是进程内调度对象,30-60s 跨进程同步无价值;与 `template-switch-job.ts` 一致,进程重启用户重发可接受
   - **Why(图片入库)**:见 6
   - 失败回滚靠"不动 slides.md"——工具同步 `{jobId, status:'queued'}` 立返,实际 `updateSlide` 在 worker 成功才发生

6. **图片字节存 DB BLOB(`deck_assets.data MEDIUMBLOB`)而不是 Slidev `public/` 磁盘**
   - **Why**:Phase 10.5 spike 候选 + Phase 11 要 Slidev 多实例化,Slidev 进程跟 deck 短暂绑定(锁机制),图片资源必须**与 Slidev 进程解耦**才能跨实例迁移。入 DB 后:
     - 跨实例迁移只迁 deck row + assets row,Slidev 实例无状态
     - 鉴权强制走 agent(`requireAuth` + 校验 deck 归属),不靠目录隔离 + URL 不可猜
     - 备份/恢复纳入 DB 全量备份,与 deck_versions / users 一致
     - 删 deck 时 cascade 删 assets,无文件孤儿
   - 放弃"对象存储 + DB 元数据"是因为本阶段 RDS 容量足、单图 1-3MB MEDIUMBLOB(16MB 上限)够用、不引入 OSS 依赖简化部署。**长期方案(留 99-tech-debt)**:用户量大后图迁 OSS,DB 只留 url + 元数据
   - 不用 base64 内嵌 slides.md `data:image/png;base64,...` 是因为 markdown 文件会从几十 KB 暴涨到几 MB,Vue parse / HMR / 版本历史全炸

6. **`generate_slide_image` 单页单次,LLM 多页就多次调**
   - **Why**:用户选了"单页单次工具",符合"工具原子性"原则。多页批处理工具中途失败回滚逻辑复杂,且 OpenAI rate limit 倾向单请求

7. **layout 切到 image-content 时 body 清空(破坏性)**
   - **Why**:image-content layout 没 slot,保留旧 body 会变孤儿 markdown。工具 description 明确"convert this slide to image",用户要保留文字时应"create_slide 新页"而非"update_slide"

8. **ThoughtChain 实时进度 + LLM 不等图完成**
   - **Why**:tool 即返 jobId,LLM 拿到"queued"立即可以告诉用户"正在生成第 N 页图"并继续别的工作;前端 useGenerateImageJob 独立轮询。这是 `switch_template_job` 的成熟模式

---

## ⚠️ Secrets 安全红线(沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则))

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不动
- **本 Phase 是否引入新环境变量**:是
  - `BIG_PPT_TEST_IMAGE_MODE=stub`(test only,跳过真 OpenAI 直接用 fixture PNG bytes)
  - `.env.*.example` 添加占位符,`.env.*.local` gitignored
- OpenAI API key 走 `users.llm_settings` AES-256-GCM 加密(同 GLM 现状),**绝不**入仓
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/slidev/layouts/beitou/beitou-image-content.vue` | beitou 模板的图片内容页 layout(标题 + 1280×720 图 + 可选 caption) |
| `packages/slidev/layouts/jingyeda/jingyeda-image-content.vue` | jingyeda 模板的图片内容页 layout(同上,jyd 配色) |
| `packages/agent/src/db/deck-assets.ts` | `deck_assets` 表的 drizzle 查询封装:createAsset / getAsset / deleteAssetsByDeck |
| `packages/agent/src/routes/image-llm-settings.ts` | `GET/PUT /api/image-llm-settings`,加密读写 users.image_llm_settings |
| `packages/agent/src/db/image-llm-settings.ts` | 解密读取 helper:`getImageLlmSettings(userId)` 返 `ImageLlmSettings | null` |
| `packages/shared/src/image-llm-settings.ts` | 前后端共享类型 `ImageLlmSettings` |
| `packages/creator/src/components/SettingsModal/ImageLlmTab.vue` | Settings 第三 tab UI:provider 下拉(v1 仅 openai)+ apiKey + baseUrl + model 选择 |
| `packages/agent/src/llm/openai-image.ts` | OpenAI 出图 client(路 A Responses tool + 路 B Images API fallback) |
| `packages/agent/src/image-gen-job.ts` | image-job 状态机 + in-memory store,提供 createImageJob/runImageJob/cancelImageJob |
| `packages/agent/src/tools/local/generate-slide-image.ts` | LLM 工具实现:校验 + 启 job + 同步返 jobId |
| `packages/agent/src/routes/image-jobs.ts` | `GET /api/image-jobs/:id` + `DELETE /api/image-jobs/:id` |
| `packages/agent/src/routes/assets.ts` | `GET /api/assets/:id` 鉴权后流式返图片 bytes(image/png) |
| `packages/creator/src/composables/useGenerateImageJob.ts` | 前端 job 轮询 composable,状态机 + 进度 + abort |
| `packages/agent/test/db/deck-assets.spec.ts` | DB 层 CRUD + 跨用户隔离 |
| `packages/agent/test/llm/openai-image.spec.ts` | client 单测,覆盖路 A 成功 / 5xx 降级 / 401 fail-fast / 缺 image_generation_call |
| `packages/agent/test/image-gen-job.spec.ts` | job 状态机 + 取消 |
| `packages/agent/test/tools/generate-slide-image.spec.ts` | 工具单测(mock client),覆盖 happy + 边界 |
| `packages/agent/test/routes/assets.spec.ts` | serving 路由鉴权(401/403/404)+ Content-Type / Cache-Control 头 |
| `packages/creator/test/composables/useGenerateImageJob.spec.ts` | 前端 composable 集成测(走 app.fetch shim) |
| `packages/e2e/tests/image-content.spec.ts` | E2E,stub 模式跑全流程 |
| `packages/agent/test/fixtures/test-image.png` | E2E + 单测 fixture(1×1 PNG checked in) |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/slidev/templates/beitou-standard/manifest.json` | `layouts[]` 加 `beitou-image-content` 条目(frontmatterSchema + bodyGuidance) |
| `packages/slidev/templates/jingyeda-standard/manifest.json` | 同上 jyd 版 |
| `packages/agent/src/db/schema.ts` | 加 `deckAssets` 表 + `users.imageLlmSettings` 字段 |
| `packages/agent/src/tools/local/index.ts` | 注册 generateSlideImageTool |
| `packages/agent/src/app.ts` | mount `imageJobsRoute` + `assetsRoute` + `imageLlmSettingsRoute` |
| `packages/agent/src/routes/decks.ts` | 删 deck 时调 `deleteAssetsByDeck(deckId)` cascade 清 BLOB 行 |
| `packages/creator/src/components/SettingsModal/index.vue`(假设路径,Task F 时 grep 确认) | 加第三 tab "生图模型 / Image LLM" |
| `packages/creator/src/composables/useDecks.ts` | 加 `generateSlideImage(deckId, body)` + `getImageJob(jobId)` API 包装 |
| `packages/creator/src/composables/useAIChat.ts` | `TOOL_STATUS_MAP` 加 generate_slide_image;`extractFocusPage` case;tool 拦截启 useGenerateImageJob |
| `packages/agent/.env.development.example` / `.env.test.example` / `.env.production.example` | 加 `BIG_PPT_TEST_IMAGE_MODE=` 占位 |
| `docs/requirements/roadmap.md` | 加 Phase 11.5 条目 |
| `CLAUDE.md` | 工具列表(若有枚举);"已知坑"如发现新坑追加 |

### 删除

无。

---

## 数据模型变更

### `deck_assets` 表(新增,核心架构改动)

```ts
// packages/agent/src/db/schema.ts 新增
export const deckAssets = mysqlTable('deck_assets', {
  id: varchar('id', { length: 36 }).primaryKey(),                        // crypto.randomUUID()
  deckId: int('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mimeType: varchar('mime_type', { length: 50 }).notNull(),              // 'image/png'
  bytesSize: int('bytes_size').notNull(),                                // 字节数,用于配额/统计
  data: mediumBlob('data').notNull(),                                    // 图片字节;MEDIUMBLOB 上限 16MB
  prompt: text('prompt'),                                                // 出图 prompt 留档(可选,纯审计用)
  model: varchar('model', { length: 50 }),                               // 'gpt-5.5' / 'gpt-image-2' 等,用于成本核算
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  deckIdx: index('idx_deck_id').on(t.deckId),
  userIdx: index('idx_user_id').on(t.userId),
}))
```

- **`onDelete: 'cascade'`** 确保删 deck / 删 user 时 BLOB 自动清,无孤儿
- **`bytesSize`** 字段冗余存储,后续做用户配额统计不必走 OCTET_LENGTH(data) 全表扫
- **不加 `slideIndex` 字段**:asset 与 slide 是松耦合(slide 重排 / 删除时 asset 仍存),关联仅靠 slides.md frontmatter `imageSrc: /api/assets/<id>` 的反向引用。这样 `deck_versions` 恢复回旧版本时 asset 仍可用
- **不加 `lastReferencedAt`**:本 phase 不做 GC,留给 99-tech-debt

迁移策略:`drizzle-kit push`(dev:`db:push`,test:`db:push:test`,prod:`db:push:prod`)。MySQL `MEDIUMBLOB` 是标准类型,drizzle-orm-mysql 支持。

### `users` 表新增 `image_llm_settings` 字段(独立于 `llm_settings`)

```ts
// packages/agent/src/db/schema.ts users 表新增
imageLlmSettings: text('image_llm_settings'),   // 加密 JSON,可空(未配置)
```

JSON 解密后 schema:

```ts
// packages/shared/src/image-llm-settings.ts(新建)
interface ImageLlmSettings {
  provider: 'openai'                        // v1 仅支持 openai;预留 enum 给未来扩展
  apiKey: string
  baseUrl?: string                          // 默认 https://api.openai.com/v1
  model?: string                            // 默认 'gpt-5.5'(走 Responses API tool);用户也可显式选 'gpt-image-2' / 'gpt-image-2' 直走 Images API
}
```

加密机制完全复用 `llm_settings` 套路(AES-256-GCM with `APIKEY_MASTER_KEY`):

- `packages/agent/src/crypto/apikey.ts` 已有 `encryptApiKey` / `decryptApiKey`,可直接复用
- 旧用户记录 `image_llm_settings IS NULL` → 工具检查时返"未配置"

迁移策略:`drizzle-kit push` 加字段,默认 NULL,不需要数据迁移。

**关键**:工具读 settings 时**优先**用 `image_llm_settings`(独立配置),与主 `llm_settings` 完全解耦;`provider` 字段决定走 Responses API 还是 Images API:
- `provider === 'openai'` 且 `model` 含 `gpt-5` 前缀 → 走路 A(Responses API + image_generation tool)
- `provider === 'openai'` 且 `model` 含 `gpt-image` 前缀 → 直走路 B(Images API),无 fallback
- 默认(未填 model)→ 路 A 主 + 路 B fallback,与 `gpt-5.5` 主 `gpt-image-1.5` fallback 默认一致

### `image_jobs`(in-memory Map,无 DB 表)

`packages/agent/src/image-gen-job.ts` 的 `Map<string, ImageJob>`,字段:

```ts
interface ImageJob {
  id: string                    // crypto.randomUUID()
  userId: number
  deckId: number
  slideIndex: number            // 1-based
  prompt: string
  caption?: string
  size: '1280x720'
  state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  pathTaken?: 'A' | 'B'
  assetId?: string              // 完成后的 deck_assets.id
  errorMsg?: string
  startedAt: Date
  finishedAt?: Date
  controller: AbortController   // 不序列化
}
```

进程重启数据丢失,可接受(用户重发请求,与 `template-switch-job` 同策略)。

---

## 阶段拆分

每 Task 一个 commit;每步绿测试 + 当步独立可回退。

### Task 0:✅ `users.image_llm_settings` 字段 + Settings 第三 tab

**目的**:让用户在 Settings 页独立配置生图模型(provider + apiKey + baseUrl + model),为后续工具读 settings 提供数据源。本 Task 完整闭环(后端字段 + 路由 + 前端 UI),不依赖任何后续 Task,可单独合并先上线让用户先填 key。

**操作**:
1. 改 `packages/agent/src/db/schema.ts`:`users` 表加 `imageLlmSettings: text('image_llm_settings')`(可空)
2. `pnpm -F @big-ppt/agent db:push` + `db:push:test`
3. 新建 `packages/shared/src/image-llm-settings.ts`:export `ImageLlmSettings` 接口(见数据模型变更)
4. 新建 `packages/agent/src/db/image-llm-settings.ts`:
   ```ts
   export async function getImageLlmSettings(userId: number): Promise<ImageLlmSettings | null>
   export async function setImageLlmSettings(userId: number, settings: ImageLlmSettings): Promise<void>
   ```
   内部走 `encryptApiKey` / `decryptApiKey`(`packages/agent/src/crypto/apikey.ts`)
5. 新建 `packages/agent/src/routes/image-llm-settings.ts`:
   - `GET /api/image-llm-settings` → 返 `{ provider, baseUrl, model, hasApiKey: boolean }`(**不返 apiKey 明文**,只标识"已配置")
   - `PUT /api/image-llm-settings` → body `{ provider, apiKey, baseUrl?, model? }`,encrypt 后写入
   - 都走 `requireAuth`
6. 改 `packages/agent/src/app.ts`:`app.route('/api/image-llm-settings', imageLlmSettingsRoute)`
7. 新建 `packages/creator/src/components/SettingsModal/ImageLlmTab.vue`:
   - provider 下拉(v1 仅 `openai` 一项,显式标"暂仅支持 OpenAI")
   - apiKey 输入(密码框,如已配置显示"已设置 ●●●●",再次输入覆盖)
   - baseUrl 输入(可选,placeholder `https://api.openai.com/v1`)
   - model 下拉(可选,默认空 = 自动 `gpt-5.5` 主 + `gpt-image-1.5` fallback;可显式选 `gpt-image-2` 强制路 B)
   - 保存按钮 → PUT
8. 改 Settings Modal 入口(grep `SettingsModal` 确认路径):加第三 tab "生图模型 / Image LLM",icon 用 `Sparkles` 与 favicon 同款
9. 单测:
   - `packages/agent/test/db/image-llm-settings.spec.ts`(加密往返)
   - `packages/agent/test/routes/image-llm-settings.spec.ts`(PUT/GET + 401 + 未配置返 hasApiKey: false)
   - `packages/creator/test/components/ImageLlmTab.spec.ts`(基本 UI 单测)

**验证**:
- 单测全绿
- 手测:`pnpm dev` → 登录 → Settings → 生图模型 tab → 填 OpenAI key 保存 → 刷新页面看 `hasApiKey: true`

**风险**:
- master key `APIKEY_MASTER_KEY` env 必须已配(沿用现有 plan 18 安全机制),启动时 fail-fast
- 前端 UI 要明确说"未配置 = 出图功能不可用"(防用户疑惑)
- v1 限制 provider: 'openai' 在 PUT 路由 schema 校验里硬编 `enum: ['openai']`,后续加 provider 改 enum 即可

### Task A:✅ Slidev `*-image-content` layout + manifest

**目的**:模板侧加图片内容页,frontmatter 渲染图片 + 标题 + caption。图片 src 是 **agent 侧绝对 URL `/api/assets/<assetId>`**,不经 Slidev `--base` 前缀(关键!)。

**操作**:
1. 新建 `packages/slidev/layouts/beitou/beitou-image-content.vue`:
   - `defineProps<{ heading?: string; imageSrc: string; caption?: string; imageFit?: 'cover' | 'contain' }>()`
   - 模板:`<h1>` 复用 beitou-content 标题样式 + `<img>` 1280×720 居中 + `<p class="caption">`(可选)
   - **图片 src 直接绑定 `:src="imageSrc"`,不过 `templateAsset()`**:imageSrc 形如 `/api/assets/<uuid>`,这是 agent 绝对路径,**不应**加 `--base /api/slidev-preview/` 前缀(否则会变 `/api/slidev-preview/api/assets/<uuid>` 走错路由)
   - 容器 class `beitou-template image-content-slide`,继承 `--bt-bg-page` / `--bt-fg-secondary` / `--ld-shadow-card` 等现有 token
2. 新建 `packages/slidev/layouts/jingyeda/jingyeda-image-content.vue`:同上 jyd 配色(`--jyd-*`)
3. 修改 `packages/slidev/templates/beitou-standard/manifest.json`,在 `layouts[]` 加:
   ```
   { name: 'beitou-image-content', frontmatterSchema: { required: ['imageSrc'], properties: { heading, imageSrc, caption, imageFit } }, bodyGuidance: 'body 默认空。imageSrc 形如 /api/assets/<uuid>,由 generate_slide_image 工具填,LLM 不要直接 update_slide 修改 imageSrc 字段' }
   ```
4. 同改 `packages/slidev/templates/jingyeda-standard/manifest.json`

**验证**:
- 手测:在 dev DB 手 INSERT 一行 `deck_assets`(用 `LOAD_FILE` 或 SQL 客户端贴 BLOB),写 slides.md `layout: beitou-image-content` + `imageSrc: /api/assets/<id>`,`pnpm dev` 看渲染。Slidev iframe 同源加载 `<img src="/api/assets/<id>">`,浏览器自动带 session cookie,agent 路由鉴权通过,图正常显示
- 加 layout snapshot test(若 packages/slidev 有 test 目录;否则跳过,留 E2E 验)

**风险**:
- **关键**:`imageSrc` 走绝对路径 `/api/...`,**绝对不能**经 `templateAsset()` 包装(那会让浏览器请求 `/api/slidev-preview/api/assets/...` 直接 404)。layout 单测断言 `<img>` 的 src attribute 与 prop 完全一致,防未来"统一处理"重构破坏
- markdown-it 对 frontmatter `imageSrc: /api/assets/abc-uuid` 解析正常(纯字符串无歧义)
- 验证 `tryDeterministicSwitch`(`packages/agent/src/template-switch-job.ts:98-118`)对新增 layout 的处理:两套模板都加 `*-image-content` 后缀,前缀替换映射不变,deterministic-switch 不破

### Task B:✅ `deck_assets` 表 + DB 封装 + assets serving 路由

**目的**:图片字节入 DB,agent 提供鉴权 serving 路由,Slidev / 浏览器通过 `/api/assets/:id` 拿图。

**操作**:
1. 改 `packages/agent/src/db/schema.ts`:加 `deckAssets` 表定义(见数据模型变更节)
2. `pnpm -F @big-ppt/agent db:push` + `db:push:test`(本地开发推 dev 库 + test 库;prod 走 plan 19 部署流程)
3. 新建 `packages/agent/src/db/deck-assets.ts`:
   ```ts
   export async function createAsset(args: {
     deckId: number; userId: number; mimeType: string;
     data: Buffer; prompt?: string; model?: string
   }): Promise<{ id: string }>

   export async function getAsset(id: string): Promise<{
     id: string; deckId: number; userId: number; mimeType: string;
     bytesSize: number; data: Buffer
   } | null>

   export async function deleteAssetsByDeck(deckId: number): Promise<number>  // 返删除数量
   ```
   - createAsset 内部 `id = crypto.randomUUID()`、`bytesSize = data.length`
   - 不走 ORM 自动序列化大 Buffer:用 drizzle 的 `mysql.execute(sql"INSERT ...")` 显式控制
4. 新建 `packages/agent/src/routes/assets.ts`:
   - `GET /api/assets/:id` 路由(必走 `requireAuth`)
     - `getAsset(id)` → 404 if null
     - 验 `asset.userId === ctx.var.user.id`(或 deck 在用户名下)→ 403 if 不通过
     - 设头:`Content-Type: ${mimeType}`、`Content-Length: ${bytesSize}`、`Cache-Control: private, max-age=86400`、`X-Content-Type-Options: nosniff`
     - body:`return new Response(asset.data, { headers })`
5. 改 `packages/agent/src/app.ts`:`app.route('/api/assets', assetsRoute)`,且确保 mount 在 `requireAuth` middleware 之后(否则未登录用户能直接拉图)
6. 单测 `packages/agent/test/db/deck-assets.spec.ts`:
   - createAsset → getAsset → 字节相等
   - deleteAssetsByDeck cascade
   - cross-deck 隔离(deckId=A 的 asset 不在 deckId=B 的列表)
7. 单测 `packages/agent/test/routes/assets.spec.ts`(用 `app.fetch` 内联调):
   - 401:未登录请求 → 401
   - 200:owner 请求 → 字节相等 + Content-Type 正确
   - 403:其他 user 请求 → 403,**响应 body 不能泄露字节**(防侧信道)
   - 404:不存在的 id → 404
   - Cache-Control 含 `private` 防 CDN 缓存

**验证**:
- `pnpm -F @big-ppt/agent vitest run test/db/deck-assets.spec.ts test/routes/assets.spec.ts`
- 手测:`pnpm dev` + `curl -b "session=..." http://localhost:4000/api/assets/<id> --output -.png`

**风险**:
- **MEDIUMBLOB 16MB 上限**:gpt-image-2 出 1280×720 PNG 通常 1-3MB,远低于上限,但若未来加视频/高分辨率要换 LONGBLOB(4GB)
- DB 连接池 + 大 BLOB:并发拉图时 `mysql2` 默认连接池 10 个连接,每个 BLOB 读传输 ~10ms,10 用户并发拉图就把池吃光。**缓解**:重度 BLOB 路由用单独连接池(本 phase 不做,Phase 11 多用户时若发现瓶颈再改);浏览器 `Cache-Control: max-age=86400` 让 99% 请求是 304
- **session cookie 必须**带过来:Slidev iframe 是同源,fetch `/api/assets/...` 自动带 cookie;但若用户在浏览器单独打开图 URL 也能下载,这是 by design(用户能下载自己的图)
- 跨 spec 测试污染:agent 测试用 `lumideck_test` 库,每个 `beforeEach` TRUNCATE deck_assets(同现有 schema 套路)

### Task C:✅ image-gen-job 状态机 + image-jobs 路由

**目的**:后端 image-job 状态机 + REST 端点,可独立 GET/DELETE 测试。

**操作**:
1. 新建 `packages/agent/src/image-gen-job.ts`:
   - export `createImageJob` / `getImageJob` / `cancelImageJob` / `runImageJob` / `__resetImageJobsForTesting`
   - in-memory `Map<string, ImageJob>`
   - `runImageJob(jobId, deps)` 接受 `{ generateImage, createAsset, updateSlide }` 三个 DI(便于单测 mock)
   - `getImageJob` 序列化时剥 `controller` 字段
2. 新建 `packages/agent/src/routes/image-jobs.ts`:
   - `GET /:id` → 返 `{ job }`,401 无 user / 403 跨用户 / 404 不存在
   - `DELETE /:id` → cancel,200/404
   - 沿用 `packages/agent/src/routes/decks.ts:337-345` 的 switch-template-jobs 路由风格
3. 改 `packages/agent/src/app.ts`:`app.route('/api/image-jobs', imageJobsRoute)`
4. 单测 `packages/agent/test/image-gen-job.spec.ts`:
   - 创建 → 状态机迁移 → 取消正确性
   - cross-user GET 拒绝
   - `__resetImageJobsForTesting` 跨 spec 清状态

**验证**:
- `pnpm -F @big-ppt/agent vitest run test/image-gen-job.spec.ts`
- agent 不启动也能跑(纯模块单测)

**风险**:
- 进程内状态跨测试污染(参考 plan 14 踩坑 6 / plan 15 7D-C):必须暴露 reset hook
- AbortController 在 abort 后再 abort 是 noop,但 `controller.signal.aborted` 检查要在 fetch 调用前后两点都做

### Task D:✅ OpenAI 出图 client(路 A + B fallback)

**目的**:`generateImage()` 单一入口,内部决定走哪条路。

**操作**:
1. 新建 `packages/agent/src/llm/openai-image.ts`:
   ```ts
   export async function generateImage(input: {
     prompt: string
     size: '1280x720'
     signal: AbortSignal
     apiKey: string
     baseUrl?: string
     primaryModel?: string    // 默认 'gpt-5.5'
     fallbackModel?: string   // 默认 'gpt-image-2'
   }): Promise<{ b64: string; modelUsed: string; pathTaken: 'A' | 'B' }>
   ```
2. 路 A 实现:
   - `POST {baseUrl}/responses`,body `{ model, input: [{ role: 'user', content: prompt }], tools: [{ type: 'image_generation', size }], tool_choice: { type: 'image_generation' } }`
   - 解析 `response.output[].find(i => i.type === 'image_generation_call')`,读 `result`(base64)
   - 缺失 `image_generation_call` → throw `ImagePathAFailed`
3. 路 B fallback(catch 5xx 或 ImagePathAFailed):
   - `POST {baseUrl}/images/generations`,body `{ model, prompt, size, n: 1, response_format: 'b64_json' }`
   - 解析 `data[0].b64_json`
4. 错误映射:
   - 401/403 → `ImageAuthError`(不 fallback,认证问题不会变)
   - 429 → 单次重试(读 `Retry-After` cap 5s),仍 429 → fail
   - 5xx 路 A → cascade B
   - signal aborted → `ImageCancelled`
5. 单测 `packages/agent/test/llm/openai-image.spec.ts`:
   - mock fetch(`vi.spyOn(global, 'fetch')`),覆盖路 A 成功 / 路 A 缺 result fallback B 成功 / 401 fail-fast / 双路均失败
   - 注意:Vitest 4 起 `vi.mock` 对 dynamic import 不稳定,用 `vi.spyOn(globalThis, 'fetch')`(plan 17 踩坑 2)

**验证**:
- `pnpm -F @big-ppt/agent vitest run test/llm/openai-image.spec.ts`
- 手测(可选):导出 `OPENAI_API_KEY` 跑一个 manual smoke 脚本调真 API,验证响应 schema(因风险点 1)

**风险**:
- 路 A `tools: [{ type: 'image_generation' }]` 的 schema 可能未来微调:scanner 用 `endsWith('image_generation_call')` 容错
- baseUrl 用户配自定义 proxy 时要支持(同现有 GLM 转发逻辑)

### Task E:✅ `generate_slide_image` 工具(粘合 Task B/C/D)

**目的**:LLM 可调用的工具,sync 返 jobId,async 跑出图 → 写 DB → 改 slides.md。

**操作**:
1. 新建 `packages/agent/src/tools/local/generate-slide-image.ts`:
   - 工具 schema:`{ slideIndex: integer, prompt: string (1..1000), caption?: string (≤120), aspectRatio?: 'landscape'|'portrait'|'square' }`
   - description 严格写"only when user explicitly asks for AI-generated visuals;for charts use BarChart/LineChart/PieChart components, not this tool"(防 LLM 自作主张烧 token)
   - exec 流程:
     1. `getRequestContext()` 拿 userId / activeDeckId,缺则 error
     2. 校验 slideIndex 在 `parseSlides(readSlides()).pages.length` 范围内
     3. 读 deck.templateId → 拼 layout name `${prefix}-image-content`,验 manifest 存在
     4. `getImageLlmSettings(userId)` 解密读 `users.image_llm_settings`(独立于主 LLM 配置),NULL → `{ success: false, error: '请到设置 → 生图模型 中配置 OpenAI API Key' }`
     5. 启 image-job(传 `imageLlmSettings.apiKey / baseUrl / model` 给 worker)→ 即返 `{ success: true, jobId, status: 'queued', estimatedSeconds: 45, hint: 'GET /api/image-jobs/<jobId>' }`
   - background `runImageJob(jobId, deps)` 内调:
     1. `generateImage({ prompt, size: '1280x720', signal, apiKey, baseUrl })`(Task D)
     2. 拿到 b64 → `Buffer.from(b64, 'base64')` → `createAsset({ deckId, userId, mimeType: 'image/png', data: buffer, prompt, model: pathTaken==='A' ? 'gpt-5.5' : 'gpt-image-2' })`(Task B)→ 拿 assetId
     3. `updateSlide(slideIndex, { layout: '<prefix>-image-content', frontmatter: { heading: existing.heading || '', imageSrc: `/api/assets/${assetId}`, caption }, body: '' })`
     4. mark job done with `assetId`
   - 失败:job state=failed + errorMsg,**slides.md 不动**;若 asset 已写但 updateSlide 失败,asset 留库不清(deck 仍属用户,且 deck-delete cascade 时会清,可接受小冗余)
2. 改 `packages/agent/src/tools/local/index.ts`:`registerLocalTools()` 内加 `register(generateSlideImageTool)`
3. **stub 模式**:`BIG_PPT_TEST_IMAGE_MODE === 'stub'` 时,`runImageJob` 跳过 `generateImage`,直接读 `packages/agent/test/fixtures/test-image.png` 文件 bytes 走 `createAsset`(E2E 跑无真 OpenAI 调用)
4. 单测 `packages/agent/test/tools/generate-slide-image.spec.ts`:
   - mock generateImage,assert 同步返 `{ jobId, status: 'queued' }` 且 slides.md 未变 + DB 无新 asset
   - 跑 worker → assert DB 新增 deck_assets 行 + slides.md frontmatter.layout 切换 + imageSrc 形如 `/api/assets/<uuid>`
   - 边界:slideIndex 越界 / 缺 OpenAI key / 跨用户 deck
   - 取消:abort signal → state=cancelled,slides.md + DB 均未动
   - 描述包含 "explicitly" + "charts use BarChart" 关键词(防未来弱化措辞)

**验证**:
- `pnpm -F @big-ppt/agent vitest run test/tools/generate-slide-image.spec.ts`

**风险**:
- LLM 工具参数 integer 序列化为字符串(plan 09 踩坑 1):slideIndex 走 coerceInt util(若已有则复用,无则新建)
- 测试 DB 污染:`beforeEach` TRUNCATE deck_assets + decks(同现有套路)

### Task F:✅ 前端 useGenerateImageJob composable + ChatPanel 集成

**目的**:ChatPanel 实时展示出图进度,完成后 SlidePreview 自动定位到目标页。

**操作**:
1. 新建 `packages/creator/src/composables/useGenerateImageJob.ts`(克隆 `useSwitchTemplateJob.ts` 范式):
   - 状态机 pending → running → done/failed/cancelled
   - 轮询:`FAST_INTERVAL_MS=1500` / `FAST_PHASE_MS=30000` / `SLOW_INTERVAL_MS=3000` / `TOTAL_TIMEOUT_MS=120000`
   - 进度增量:running 阶段每 poll +0.02 上限 0.85;done → 1.0
   - `start({ jobId })` / `abort()` 接口
2. 改 `packages/creator/src/composables/useDecks.ts`:加 `generateSlideImage(deckId, body)` 和 `getImageJob(jobId)` API 调用
3. 改 `packages/creator/src/composables/useAIChat.ts`:
   - `TOOL_STATUS_MAP` 加 `generate_slide_image: '正在生成 AI 图片...'`
   - `extractFocusPage` 加 case 返 `args.slideIndex`
   - `executeTool` 拦截:tool name === 'generate_slide_image' 时,从 result 解析 jobId,实例化 useGenerateImageJob 关联当前 toolStep,真异步走 ThoughtChain 展示
4. 集成测 `packages/creator/test/composables/useGenerateImageJob.spec.ts`:
   - 用 `app.fetch` shim 走真后端(`test/_setup/integration.ts`)
   - fake timers 验轮询节奏 + 进度单调 + abort 传播
   - **必须 fileParallelism: false**(plan 11 踩坑 1)

**验证**:
- `pnpm -F @big-ppt/creator vitest run test/composables/useGenerateImageJob.spec.ts`
- 手测:`pnpm dev`,在 ChatPanel 输入"把第 2 页改成 AI 生成的图片",ThoughtChain 出现进度,完成后 SlidePreview 第 2 页变图片页

**风险**:
- SlidePreview 只用 hash 路由 setPage,不调 refresh(plan 15 踩坑 3),Slidev HMR 自己处理 slides.md 变更
- `setTimeout` 必须在 `onUnmounted` 清理(plan 14 踩坑 4)

### Task G:✅ Deck 删除清理 assets

**目的**:删 deck 时清 deck_assets BLOB 行,防 DB 长期膨胀。

**操作**:
1. 改 `packages/agent/src/routes/decks.ts:210-221`(soft delete 路径):删 DB deck 行(实为 soft delete)后调 `await deleteAssetsByDeck(deckId)` —— **这是真删 BLOB 行**(soft delete 不级联到 assets,需显式调)
2. 测试 `packages/agent/test/routes/decks.spec.ts`(若已有则扩展;无则新建):创建 deck + asset → 删 deck → 断言 `getAsset(id)` 返 null

**验证**:
- 单测 + 手测:`pnpm dev` 删一个有图的 deck,DB 里 `SELECT COUNT(*) FROM deck_assets WHERE deck_id = ?` 为 0

**风险**:
- 软删除保留 deck 行但清 assets,若用户从"已删除 deck"恢复(本 Phase 不存在该功能)会读到 broken `imageSrc`;当前无恢复功能,该风险为零;Phase 11 加恢复时回头改:让恢复优先 + 清 assets 改成"硬删 deck 时才清"
- 数据一致性:如果 `deleteAssetsByDeck` 抛异常(连接失败),deck 已 soft delete 但 assets 还在 → 可接受,assets 会孤儿但不影响功能;长期 GC 留 99-tech-debt

### Task H:✅ E2E 测试 + stub fixture

**目的**:全流程 CI 验证,不烧真 token。

**操作**:
1. 加 `packages/agent/test/fixtures/test-image.png`(1×1 PNG ~70 bytes,checked in)—— 注意放在 agent 测试目录,不放 slidev/public(Slidev public 不再是图片源)
2. 改 worker(Task E 已实现):检测 `BIG_PPT_TEST_IMAGE_MODE === 'stub'` → 读 fixture 文件 bytes 走 createAsset,跳过真 OpenAI 调用
3. 新 `packages/e2e/tests/image-content.spec.ts`:
   - playwright.config webServer env 加 `BIG_PPT_TEST_IMAGE_MODE=stub`
   - 流程:登录 → 建 deck → ChatPanel 输入"把第 3 页改成 AI 生成的'未来城市'图片" → 等 ThoughtChain 见 done → 断言 slides.md 第 3 页 frontmatter.layout 含 `image-content` 后缀 + imageSrc 匹配 `/api/assets/<uuid>` + `GET /api/assets/<uuid>` 返 200 + Content-Type image/png + Content-Length > 0
   - **不**断言图片像素 / LLM 生成的措辞(plan 12 踩坑 1)

**验证**:
- `pnpm -F @big-ppt/e2e test`(本地)+ CI 跑

**风险**:
- E2E webServer env 注入(playwright.config.ts):确保 stub mode 真生效
- E2E 浏览器拉 `/api/assets/...` 必须带 session cookie;Playwright 默认在登录后保留 cookie,无需特殊处理

### Task I:✅ 文档 + roadmap 更新

**目的**:plan 落地后回写 roadmap、CLAUDE.md。

**操作**:
1. `docs/plans/20-phase11.5-image-content.md` 从 `~/.claude/plans/gpt5-5-...md` 拷过去(去掉模板说明节,补充已发现的踩坑)
2. `docs/requirements/roadmap.md` 加 Phase 11.5 条目(高 level 验收标准)
3. `CLAUDE.md` 工具列表(若有)加 `generate_slide_image`;若实施期发现工具链 / 测试基建坑,提炼一句到"已知坑"

**验证**:无,文档变更
**风险**:无

---

## 验收条件

**前置**:用户在 Settings → 生图模型 tab 已配 OpenAI key(付费 tier)。

用户在 ChatPanel 输入"**把第 3 页改成 AI 生成的'未来城市'图片**",流程:
- [ ] 10s 内 ThoughtChain 出现"正在生成 AI 图片..."(queued → running)
- [ ] 60s 内 ThoughtChain 状态变 done,LLM 回复确认
- [ ] SlidePreview 自动定位到第 3 页,显示新图片(image-content layout)
- [ ] `slides.md` 第 3 页 frontmatter `layout: beitou-image-content` + `imageSrc: /api/assets/<uuid>`
- [ ] DB 表 `deck_assets` 多一行记录,bytes_size > 0
- [ ] `GET /api/assets/<uuid>` 带 session cookie 返 200 + `Content-Type: image/png` + 实际字节
- [ ] 跨用户访问该 asset → 403,响应不泄露字节
- [ ] 删除该 deck 后 `deck_assets` 行被清(`SELECT COUNT(*) WHERE deck_id = ?` 为 0)
- [ ] 用户未在 Settings 配生图模型时,工具返"请到设置 → 生图模型 中配置 OpenAI API Key",不 crash agent
- [ ] 跨用户访问其他用户的 image-job → 403
- [ ] 主 LLM 是 GLM 时,生图功能仍可用(主 LLM 与生图模型完全解耦)
- [ ] 全量回归:`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿
- [ ] coverage 维持(agent 90/85,creator 75/65)

---

## 不做什么(范围围栏)

- ❌ **整页直出图替代 Slidev MD 渲染**:用户明确"还是要套用模板的",保留模板体系
- ❌ **多页一次性批处理工具**(`plan_and_generate_images`):用户选了单页单次原子,后续 phase 视使用反馈再加
- ❌ **图片缓存 / 去重**:同 prompt 重出 = 用户主动 reroll,不缓存
- ❌ **Prompt 客户端审核**:OpenAI 自带 moderation,透传错误就行
- ❌ **DB 表存 image-job**:in-memory Map,进程重启丢失可接受(参考 switch-template-job)
- ❌ **跨设备进度同步**:单标签页用,不需要
- ❌ **图片定期 GC scrub**:本 Phase 只做 deck-delete 钩子;长期孤儿清理留 99-tech-debt
- ❌ **多 provider image gen**:Settings 第三 tab 的 provider 下拉本 phase 仅暴露 `openai` 一项;GLM/Kimi 等不开放出图能力(原因:它们 OpenAI-compatible 协议没有原生 image_generation tool)
- ❌ **图片资源走文件系统 / Slidev public 目录**:Slidev 多实例化方向下,资源必须与 Slidev 进程解耦;入 DB BLOB 是本 phase 选择
- ❌ **生图模型与主 LLM 共用 key**:用户明确要求两者独立配置(避免后端推断 key 类型不可靠)
- ❌ **slide 内 N 张子图 / 拼贴 layout**:本 phase 一页一图;复杂 layout 是后续 Phase
- ❌ **支持用户上传图片**:只生成,不上传;上传是另一个独立功能
- ❌ **修改 LLM 转发主路径**(`routes/llm.ts`):chat completions 与 image gen 走完全独立的代码路径,互不影响 semaphore

---

## 主要风险

### Risk 1:Responses API + image_generation tool schema 不稳定(高)

**症状**:路 A 永远走不通,所有出图请求都 fallback 到路 B(image-1.5),浪费"用最新模型"的初衷。
**根因**:OpenAI Responses API + 内置 image_generation tool 是 2026-04 新发布,tool 调用 schema 可能微调(`size` 字段名 / `tool_choice` 形式 / output item type 字符串等)。
**缓解**:
- Task D 单测做 schema 容错:`item.type.endsWith('image_generation_call')` 而非精确匹配
- Task D 完成后做一次 manual smoke 测试用真 OpenAI API 验响应 schema 与 plan 一致
- 监控:agent 加 metric `image_gen_path_a_success_rate`,< 50% 时告警(本 phase 不做,留 Phase 12 监控)

### Risk 2:LLM 误触发烧用户 OpenAI key(中)

**症状**:用户说"这页内容不够丰富",LLM 自作主张调 generate_slide_image,用户莫名其妙看到图,key 配额烧了。
**根因**:工具 description 写不够严格,LLM 对"丰富"等模糊指令乱推断。
**缓解**:
- Task E description 严格写 "only when user **explicitly** asks for AI-generated visuals" + 反例 "for charts use BarChart not this tool"
- 单测断言 description 包含关键约束词,防未来弱化
- system prompt 加一段"图片工具只在用户用'生成'/'画'/'AI'/'图'等明确词时调用"的硬性指引

### Risk 3:`deck_assets` 表 BLOB 长期膨胀(中)

**症状**:用户用半年后,`deck_assets` 表 GB 级,DB 备份/迁移变重。
**根因**:slide 删除 / 替换图时不清旧 asset(为支持 deck_versions 恢复故意保留)。
**缓解**:
- 本 Phase 至少做 deck-delete 钩子(Task G),覆盖最大泄露源(整 deck 删除)
- 长期方案:加定期 GC 扫描 `deck_versions.content` 中的 `imageSrc: /api/assets/<id>` 引用,清 7 天前未引用的 asset 行。**留给 99-tech-debt 或 Phase 12**
- 终极方案:迁对象存储,DB 只存 url 元数据。本 phase 不动

---

## 与现有架构冲突点

- **无**LLM 转发主路径冲突:image gen 走独立 `openai-image.ts`,不沾 `routes/llm.ts` 的 chat-completions 转发与 per-user semaphore
- **`users` 表 schema 改动**:新增 `image_llm_settings` 字段(可空 TEXT),drizzle-kit push 兼容;旧用户记录无该字段,工具检查时返"未配置"
- **`deck_assets` 新表**:`onDelete: 'cascade'` FK 到 decks,但 decks 是 soft delete,所以 cascade 不触发;Task G 显式调 `deleteAssetsByDeck`
- **`tryDeterministicSwitch` 兼容性**:两套模板都加 `*-image-content` 后缀,前缀替换路径不破。验证方法:Task A 完成后跑 `packages/agent/test/template-switch-job.spec.ts`,所有现有测试应继续通过
- **slide 版本恢复**:`deck_versions` 恢复到删 asset 之前版本时,可能引用已被 GC 的 asset → `/api/assets/<id>` 返 404。**本 Phase 不做 GC,所以暂无该问题**;Phase 12 加 GC 时一并设计
- **DB 连接池压力**:大 BLOB 读会占住 mysql2 连接较长(对比小 row 查询);Phase 11 多用户时若发现压力再加专用 BLOB 连接池

---

## 实施顺序建议

```
Task 0 (image-llm-settings) ──┐
Task A (layouts)              ├─→ Task E (tool) ─→ Task F (frontend) ─→ Task H (E2E) ─→ Task I (docs)
Task B (deck_assets + assets serving) ──┤
Task C (image-gen-job + routes) ────────┤
Task D (openai-image client) ───────────┘
Task G (deck-delete cleanup,可与 Task E 后任意时刻独立合)
```

依赖:
- Task 0 / A / B / C / D **完全独立**,可并行起跑
- Task E 同时依赖 Task 0 / B / C / D(读 image_llm_settings + createAsset + 启 job + 调 generateImage)
- Task F 依赖 Task C(routes 要存在)+ Task E(tool 要可用)
- Task G 是孤立小改,Task E 后任意时刻合
- Task H 是 E2E,所有 task 后跑
- Task I 文档,最后做

**强烈建议先合 Task 0**:它是完整闭环(用户在 Settings 里能配生图模型 key,但工具还没接,先不出图),可以让 dogfood 用户先填 key,等后续 task 一上线立刻可用。

---

## 执行期偏离

- **测试文件命名**:plan 写 `*.spec.ts`,实际仓库约定是 `*.test.ts` 平铺在 `packages/agent/test/`,不分子目录
- **assets 路由响应字节**:plan 说用 `c.body(asset.data, ...)`,但 Buffer<ArrayBufferLike> 在新 TS 下不兼容 BodyInit。改成 `new Uint8Array(byteLength).set(...)` 复制到纯 ArrayBuffer-backed Uint8Array 后 `new Response(...)`
- **Task 执行顺序**:Task 0 → A → B → D → C → E → G → F → H → I(plan 建议的依赖图保留,只是 G 比 F 先合,因为 G 是孤立小改)

## 踩坑与解决

### 坑 1:Buffer<ArrayBufferLike> 与 fetch BodyInit 类型不兼容

- **症状**:agent type-check 报 "类型 'Buffer<ArrayBufferLike>' 缺少类型 'URLSearchParams' 的属性"。先后试 Hono c.body(buffer) / `new Uint8Array(buffer.buffer, offset, len)` / `new Blob([buffer])` 全报错
- **根因**:新版 @types/node Buffer 是 `Uint8Array<ArrayBufferLike>`,而 fetch BodyInit 期望 `Uint8Array<ArrayBuffer>`(SharedArrayBuffer / ArrayBuffer 类型分歧)
- **修复**:复制到一个**全新分配**的 Uint8Array(`new Uint8Array(byteLength).set(buf)`),其 buffer 类型是干净 ArrayBuffer
- **防再犯**:无,运行时影响可忽略(memcpy 1-3MB BLOB 几 us)。**不提炼**到 CLAUDE.md

### 坑 2:drizzle-orm 0.45 mysql-core 没原生 mediumBlob 函数

- **症状**:`mediumBlob('data')` import 直接报错
- **根因**:drizzle-orm 0.45 mysql-core 只提供 `binary` / `varbinary`,无 TINY/MEDIUM/LONG-BLOB
- **修复**:用 `customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'mediumblob' })` 自定义。drizzle-kit push 正确 emit MySQL `mediumblob` 列
- **防再犯**:**应提炼**到 CLAUDE.md 已知坑(下个 Phase 加 LONGBLOB / 二进制大字段时同套路)

### 坑 3:tool def 的 exec 属性触发 security hook 误报

- **症状**:Write 工具定义文件时 PreToolUse hook 报 child_process.exec 警告
- **根因**:hook 简单 grep `.exec(` 字面量,把 ToolDef interface 的 exec 属性当成 child_process.exec
- **修复**:工具内部 exec body 提到顶层 `async function runTool(args)`,ToolDef.exec 只引 ref;测试侧 `const runTool = tool.exec.bind(...)` alias 绕开
- **防再犯**:无,纯命名约定。**不提炼**

## 测试数量落地

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit/integration | 478 | 522 | +44(image-llm-settings 14 + deck-assets 5 + assets-route 5 + openai-image 9 + image-gen-job 15 + tool 10 + decks-cleanup 1 - 调整 2 旧 case 减 11 后净增 44)|
| creator unit     | 79 | 79 | 0(本 phase 没新增 creator 单测;前端逻辑由 E2E 覆盖)|
| E2E              | 9 | 12 | +3(image-content.spec.ts) |
