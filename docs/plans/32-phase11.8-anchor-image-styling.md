# Phase 11.8 — 锚图选样:跨 slide AI 生图风格统一 实施文档

> **状态**:待启动
> **前置阶段**:Phase 11.5 [plan 20](20-phase11.5-image-content.md) / Phase 11.6 [plan 21](21-phase11.6-image-first.md) [plan 23](23-phase11.6-dogfood-followup.md) / Phase 11.7 [plan 22](22-phase11.7-grid-refactor.md);hybrid vision-aware 已 verify(commit `627c981` + `d8b2ae5` + 2026-05-18 真打 smoke 跑通)
> **后续阶段**:无强依赖
> **路线图**:[roadmap.md Phase 11.8](../requirements/roadmap.md)
> **执行子技能**:`superpowers:executing-plans`(规模中等,单 session 串行执行即可)

**Goal**:解决 dogfood 反复反馈的「同一份 deck 22 张 AI 生图风格不统一」问题。当前 [`buildStructuredImagePrompt`](../../packages/agent/src/tools/local/generate-slide-image.ts#L100-L117) 只通过 prompt 注入 deck-level palette / styleHint 约束,palette 维度对齐但**构图 / 笔触粒度 / 元素密度**仍跨页漂移。本 Phase 加锚图选样模式:首次走 image-gen 路径前,**主 LLM 看 deck 大纲现场生成 3 个差异化样张 prompt** → 并发出图 3 张让用户挑/换批,选定锚图持久化到 deck,后续所有 `generate_slide_image` 自动注入锚图走 hybrid vision-aware(vision encoder 真"看到"风格而非仅读 prompt 描述),跨 slide 视觉对齐。**配套加 hybrid 失败三级降级**(hybrid → text-only 路 B + palette 约束 → rewrote),避免单页 vision 抖动就丢图。

---

## 关键设计抉择(2026-05-18 与用户对齐)

1. **风格样张主题:主 LLM 看 deck 大纲现场出 3 个差异化 prompt,工具层不预设风格字符串**(2026-05-19 用户反馈推翻原硬编预设方案)
   - **流程**:write_slides 完成后,工具层调主 LLM **一次非流式**,输入 deck content 前 2KB(cover heading + 部分内容页) + system prompt「生成 3 个 image prompt,每个表达本 deck 的主题但视觉风格**明显不同**;**不要**全部默认成 flat infographic / realistic photo;风格方向由你看上下文自己决定」,LLM 输出 JSON `{ samples: [{ style: short_label, prompt: full_image_prompt }, × 3] }`
   - 拿到 3 个 prompt 后并发调 `generateImage` 出 3 张图(尺寸 `512x512` 缩略图,降本)
   - 用户挑哪张,该图就是 anchor;另 2 张丢弃
   - **放弃 A(原方案):工具层硬编 3 套预设(flat-geometric / soft-watercolor / minimalist-line-art)** —— 用户反馈两条致命问题:(1) **产品永久天花板**,3 套是工程师拍的,真实用户的"我想要 Bauhaus / 浮世绘 / isometric / 手绘"等无穷风格永远进不来;(2) **跟用户实际业务脱节** —— deck 大纲已经在 DB 里,信息可用,却拿抽象 mood board(无业务元素)让用户挑,用户挑的"调性"在后续业务图里能 transfer 多少不知道
   - **放弃 B:用 deck cover heading 文本作为 prompt 直接调 generateImage 3 次让生图 LLM 内部 sampling 出差异** —— OpenAI gpt-image-2 同 prompt 多次调用 sampling diversity 不可靠,3 张可能雷同到用户挑不出区别;且没有"风格关键词"约束 LLM 容易默认 flat infographic 一种
   - **Why**:风格是 emergent 的、跟业务相关的、应该让用户**通过看实际业务图**反馈来挑,而不是从工程师预设里挑;主 LLM 看上下文出风格关键词比工程师拍脑袋出关键词更贴合 deck 主题(AI 主题可能 LLM 给 isometric / cyberpunk / flat-tech;教育主题可能给 hand-drawn / 水彩 / 卡通);多花 1 次主 LLM 非流式调用(用户买单 ~$0.005)换"产品风格上限不被工程师锁死",划算
   - **风险与兜底**:LLM 可能违反约束输出 3 个雷同 prompt(全 flat) → 工具层加 sanity check「3 个 style label 字符相似度 ≥ 0.8 时,把 prompt 改写指令再 retry 一次」;retry 也雷同 → 接受降级让用户挑(用户会用"换一批"自救)

2. **"换一批"硬限 3 次**:每次 3 张 × $0.04 = $0.12,上限 $0.48。前端按钮在第 3 次后 disabled + tooltip「3 次还不满意通常是 prompt engineering 问题,跳过用 text-only 模式继续」。**Why**:防误操作烧 $5+;3 次足够覆盖"我没选对方向"的纠错,超过就回到产品诉求层面的问题

3. **hybrid 失败三级降级**:当前 [openai-image.ts:138-140](../../packages/agent/src/llm/openai-image.ts#L138-L140) 设计是 hybrid 路 A 一失败**直接抛**到 worker 走 `fallback-rewrote`(重写成组件版),**不**降级路 B(因路 B 不接 image input,丢失"基于原图改"语义被认为偏差更大)。但锚图模式落地后,22 页里任何一页 vision 抖一下就丢掉 image 模式,不可接受。**新降级链**:
   - 路 A + image_input + image_generation tool(hybrid,带锚图) — 用 anchor 对齐
   - 失败 → 路 B + 纯 text + `buildStructuredImagePrompt`(palette / styleHint anchor) — 退回 Phase 11.6 实现,palette 维度仍对齐
   - 失败 → `fallback-rewrote` 重写组件版 — 最后兜底
   - **Why**:vision 失败时 palette 约束仍保留(buildStructuredImagePrompt 跨调用一致),比直接丢图好得多

4. **锚图持久化:`decks.anchor_asset_id` 单字段**
   - 一个 deck 一个锚图,后续 `generate_slide_image` 默认注入
   - 锚图本身存 `deck_assets` 表(复用 BLOB 通路)同时 deck.anchor_asset_id = 该 asset 的 uuid
   - FK `onDelete: 'set null'`(asset 被显式删时不连带删 deck;但 user/deck cascade 删 asset 时 anchor 自动失效)
   - **Why**:跟 currentVersionId 同款"循环 FK 留 nullable"套路;一个 deck 一个 anchor 是最简单产品语义(多 anchor / 每页一个 anchor 留 Phase 17+)

5. **切模板时清空 `anchor_asset_id`,不保留**
   - `switch_template` 流水线落新 version 时 anchor_asset_id 置 NULL,下次走 image-gen 前再次触发 mood board picker
   - **Why**:切模板的核心诉求就是换风格,anchor 本来跟旧模板色板一脉相承,保留反而冲突;让用户重选符合直觉。undo 切模板时 anchor 一并恢复(走 deck_versions 历史快照即可,见 Task A)

6. **UI 流程:write_slides 完成后阻塞弹窗**
   - 用户点"生成 PPT" → 大纲 write_slides 完成 → 即将批量 generate_slide_image **之前** → 弹 AnchorPickerModal(3 张缩略图 + 换一批 + 跳过)
   - 用户选一张 → deck.anchor_asset_id 落库 → 编辑器自动恢复 LLM session 继续(LLM 收到信号继续派发 N 张 generate_slide_image,工具层自动读 anchor)
   - **Why**:阻塞流程跟现状「点一下喝咖啡」体验有冲突,但用户本来就要等图(并发 3 跑 22 页 ~5 min),阻塞 30s 选风格其实可接受;**跳过**按钮回到现在的纯 text-only + palette 路径(向后兼容)

7. **样张生成阶段 `manifest.imageGenStyle` 不参与**
   - 主 LLM 出 3 个样张 prompt 时,system prompt 不喂模板色板(否则 3 张全偏同一调,用户没得挑)
   - **选定 anchor 后**,后续 generate_slide_image 仍用 buildStructuredImagePrompt 注入模板 palette,跟 anchor 一起给生图 LLM(palette + 风格双约束,生图 LLM 自己 reconcile)
   - **Why**:样张阶段需要"风格自由度"让用户真有选择;落地阶段才需要"deck 内一致性"靠模板 palette 兜底

8. **协议层:LLM 不感知 anchor 存在**
   - `generate_slide_image` 工具层入口**自动**读 `decks.anchor_asset_id` 注入 baseImage(跟现在读 frontmatter imageSrc 同套路,见 [generate-slide-image.ts:269-303](../../packages/agent/src/tools/local/generate-slide-image.ts#L269-L303))
   - **anchor 优先级 < frontmatter imageSrc**:slide 已有图(用户/agent 多轮迭代)优先用该图做 baseImage;slide 没图但 deck 有 anchor → 用 anchor;都没有 → text-only
   - **Why**:工具协议保持简洁,LLM 不需要传新参数;现有 prompt / system prompt 完全不动

9. **触发入口 + frontend / backend 协议**
   - 后端新加 `POST /api/decks/:id/mood-board/generate` 路由,生成 3 张抽象 mood board → 返回 3 个 asset uuid(不写 anchor_asset_id,纯候选)
   - 后端新加 `POST /api/decks/:id/anchor` 路由,body `{ assetId }`,选定锚图 → 写 anchor_asset_id
   - 前端 `useMoodBoardPicker` composable:封装"生成 3 张 + 换一批 + 选定 + 跳过"四操作 + 限 3 次状态
   - **触发点 1**:用户首次新建 deck + image LLM 已配 + 还没 anchor → write_slides 完成后 useAIChat 检测 + 暂停 LLM session 弹 modal
   - **触发点 2**:用户已有 deck 但还没 anchor + 主动触发(顶栏新加"重选风格"按钮)→ 直接弹 modal
   - **触发点 3**:切模板后 anchor 被清空 → 切模板完成后自动弹 modal(类似触发点 1)

10. **mood board 缩略图本身存在 `deck_assets` 但 markdown 不引用**
    - 3 张候选图都生成 asset 行(便于 frontend 通过 `/api/assets/<uuid>` 加载缩略图)
    - 用户选定 1 张 → 该 asset 作为 anchor 持久化;另外 2 张 + 历史"换一批"丢弃的 → 标记 `purpose: 'mood-board-discarded'`(新加字段)→ daily cron 清(留 Phase 17+,本 Phase 暂留)
    - **Why**:简单,复用 BLOB 通路;丢弃的图在 GC 前占空间但 deck 通常 <10 个,加上 anchor 选样上限 3 次 × 3 = 9 张 × 200KB 每张 ≈ 1.8MB / deck,可接受

---

## ⚠️ Secrets 安全红线(HARD,沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则))

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- 本 Phase 是否引入新环境变量:**否**(沿用 OpenAI image key + `BIG_PPT_TEST_IMAGE_MODE` 既有 env)
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/agent/src/mood-board/index.ts` | 样张生成器:**调主 LLM 出 3 个差异化 prompt** + sanity check(style label 相似度) + 并发调 generateImage + 写 deck_assets(purpose='mood-board-candidate')+ 返 3 个 uuid + 3 个 style label |
| `packages/agent/src/mood-board/prompt.ts` | 主 LLM 调用的 system prompt + JSON schema(`{ samples: [{ style, prompt }, × 3] }`)+ 解析与校验 |
| `packages/agent/src/routes/mood-board.ts` | POST `/api/decks/:id/mood-board/generate`(限 3 次/deck)+ POST `/api/decks/:id/anchor`(选定) |
| `packages/agent/test/mood-board.test.ts` | 样张生成器单测(主 LLM 返 3 prompt 路径 + sanity check retry + 任一图失败整批失败 + IDOR guard) |
| `packages/agent/test/routes-mood-board.test.ts` | 路由集成测(401/403 / 限 3 次 / 选定写库) |
| `packages/creator/src/components/AnchorPickerModal.vue` | 选风格 modal(3 缩略图 + 换一批 + 跳过 + 第 3 次后 disabled) |
| `packages/creator/src/composables/useMoodBoardPicker.ts` | 封装生成/换批/选定/跳过 + 限频状态 + open/close 跟 LLM session 联动 |
| `packages/creator/test/AnchorPickerModal.test.ts` | 选风格 modal 单测(渲染 / 选定 emit / 换批限频) |
| `packages/creator/test/useMoodBoardPicker.test.ts` | composable 单测(限频 + IDOR 错误兜底) |
| `packages/agent/test/integration/anchor-image-flow.test.ts` | 集成测:create deck → 生 mood-board → 选 anchor → generate_slide_image 工具确实透传 baseImageBase64 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/src/db/schema.ts` | `decks` 表加 `anchorAssetId varchar(36)` nullable FK to deck_assets.id `onDelete: 'set null'`;`deck_assets` 表加 `purpose varchar(32)` nullable(枚举:`null` 普通生图 / `'anchor'` / `'mood-board-candidate'` / `'mood-board-discarded'`) |
| `packages/agent/src/tools/local/generate-slide-image.ts` | 同步入口加 anchor 注入逻辑:slide 已有 frontmatter imageSrc → 沿用现状;否则读 `deck.anchor_asset_id` → 加载 asset → 透传 baseImageBase64/Mime |
| `packages/agent/src/llm/openai-image.ts` | hybrid 失败三级降级:hasBaseImage 路 A 失败时**先**尝试路 B(纯 text + buildStructuredImagePrompt,丢失 anchor 但保留 palette)再抛错 |
| `packages/agent/src/db/deck-assets.ts` | `createAsset` 接 `purpose` 参数;新增 `listMoodBoardCandidates(deckId)` / `markAsAnchor(deckId, assetId)` helper |
| `packages/agent/src/db/decks.ts`(如已存在) | `setAnchorAsset(deckId, assetId \| null)` helper;切模板流水线落新 version 后清 anchor_asset_id |
| `packages/agent/src/template-switch-job.ts` | snapshot 写 fromTemplateId 后,新 version 落库时 `decks.anchor_asset_id = NULL`(undo 时由 restore 流水线恢复 — 这里参考 Phase 7D-A deck_versions.template_id 同源套路) |
| `packages/agent/src/db/schema.ts` 中 `deckVersions` | 加 `anchorAssetId varchar(36)` nullable 列,snapshot 跟随 templateId 一起记;restore 端点 fallback 同步 `decks.anchor_asset_id`(undo 切模板时恢复 anchor) |
| `packages/agent/src/routes/decks.ts` | restore 端点同步恢复 anchor_asset_id(fallback) |
| `packages/creator/src/composables/useAIChat.ts` | write_slides 工具回包后检测 `deck.anchorAssetId === null && imageLlmConfigured` → 暂停 LLM session,通过新 `'anchor-picker-required'` 事件触发 useMoodBoardPicker 开 modal;用户选定/跳过后 resume LLM session |
| `packages/creator/src/components/DeckEditorCanvas.vue`(或顶栏组件) | 顶栏加"重选风格"按钮(仅 image LLM 已配 + deck 已有 anchor 时显示) |
| `packages/shared/src/api.ts` | 加 `MoodBoardCandidate { assetId, prompt, style }` / `AnchorAssetSummary { assetId }` 类型 + 路由响应 shape |
| `packages/creator/src/api/decks.ts` | `generateMoodBoard(deckId)` / `setAnchor(deckId, assetId)` 调用方法 |

### 删除

无。

---

## 数据模型变更

### `decks` 表加列

```ts
// packages/agent/src/db/schema.ts
export const decks = mysqlTable('decks', {
  // ... 既有字段 ...
  /**
   * Phase 11.8: 选定的视觉锚图 asset id,生图时自动注入 baseImage 跨 slide 对齐风格。
   * - nullable: 未配 image LLM / 用户跳过选样 / 切模板清空时为 NULL
   * - FK onDelete 'set null': asset 被显式删除时 deck 不连带删,只清 anchor 引用
   * - 跟 deck_assets.purpose='anchor' 一对一:一个 deck 一个 anchor
   */
  anchorAssetId: varchar('anchor_asset_id', { length: 36 }),
  // ... 其余字段 ...
})
```

注:circular FK 不在 schema 里显式声明(避免 drizzle-kit push 生成失败);application-level 保证一致性 + 单测覆盖。

### `deck_assets` 表加列

```ts
export const deckAssets = mysqlTable('deck_assets', {
  // ... 既有字段 ...
  /**
   * Phase 11.8: asset 用途分类。
   * - null: 默认/历史/普通 generate_slide_image 产物
   * - 'anchor': 当前选定锚图
   * - 'mood-board-candidate': 候选未选中(用户可能再选)
   * - 'mood-board-discarded': 历史"换一批"丢弃(留待 Phase 17+ GC 清)
   */
  purpose: varchar('purpose', { length: 32 }),
  // ... 其余字段 ...
})
```

### `deck_versions` 表加列(undo 切模板恢复 anchor)

```ts
export const deckVersions = mysqlTable('deck_versions', {
  // ... 既有字段 ...
  /**
   * Phase 11.8: 此 version 创建时所属的 anchor asset id(snapshot 用 from / 新版本用 to)。
   * restore 时 fallback 同步 decks.anchor_asset_id 实现切模板可逆 anchor 恢复。
   * 跟 Phase 7D-A templateId 同源套路。
   */
  anchorAssetId: varchar('anchor_asset_id', { length: 36 }),
  // ... 其余字段 ...
})
```

迁移策略:
- dev:`pnpm -F @big-ppt/agent db:push`
- test:`pnpm -F @big-ppt/agent db:push:test`
- prod:`pnpm -F @big-ppt/agent db:push:prod`(部署脚本会自动跑)
- 老数据:三列全 nullable 默认 NULL,老 deck 不动,行为完全向后兼容

---

## 阶段拆分

每个 Task 一个 commit;每步绿测试 + 当步独立可回退。

### Task A:DB schema 演进 + helpers + version snapshot 接线

**目的**:落 schema + asset helpers + version 历史快照,为后续 Task 提供数据层基础。

**操作**:
1. 改 `packages/agent/src/db/schema.ts`:`decks.anchorAssetId` / `deckAssets.purpose` / `deckVersions.anchorAssetId` 三列
2. 跑 `pnpm -F @big-ppt/agent db:push` + `db:push:test`(dev + test 双库)
3. 改 `packages/agent/src/db/deck-assets.ts`:`createAsset` 接 `purpose` 可选参数(默认 null);新增 `listMoodBoardCandidates(deckId): Promise<Asset[]>` / `markAsAnchor(deckId, assetId): Promise<void>`(把 purpose 从 candidate 改 anchor,同 deck 其它 candidate 改 discarded)
4. 改 `packages/agent/src/template-switch-job.ts`:落新 version 时记当时 anchor_asset_id(snapshot from / 新 version anchor_asset_id = NULL,跟切模板的清空语义一致)
5. 改 `packages/agent/src/routes/decks.ts` restore 端点:fallback 同步 `decks.anchor_asset_id = version.anchorAssetId`
6. 加 `packages/agent/test/db-anchor-schema.test.ts`(3 列存在 + nullable + FK 行为)

**验证方法**:
- `pnpm -F @big-ppt/agent vitest run test/db-anchor-schema.test.ts`
- 手验 db:push 跑通,新建 deck 看 `anchor_asset_id` 列为 NULL
- 切模板 + restore 一轮:`anchor_asset_id` 跟 `templateId` 同步快照/恢复

**风险**:circular FK 在 drizzle 上的 introspection 异常 — 沿用 `decks.currentVersionId` 同款做法(不声明 references,application-level 保证)避免 drizzle-kit push 卡

---

### Task B:样张生成器(主 LLM 出 prompt + 并发出图)

**目的**:产出"看 deck 大纲后给 3 张差异化样张"的核心能力。

**操作**:
1. 新建 `packages/agent/src/mood-board/prompt.ts`:
   - 导出 `MOOD_BOARD_SYSTEM_PROMPT` 字符串(语义:「Look at this deck outline. Generate 3 different image prompts that capture this deck's theme. Each prompt MUST use a CLEARLY DIFFERENT visual style — pick whichever 3 directions you think best match the content. Do NOT default all 3 to 'flat infographic' or 'realistic photo' or any single style. Output strict JSON: `{ samples: [{ style: short_label, prompt: full_image_prompt }, ..., 3 items] }`」)
   - 导出 `parseMoodBoardLlmResponse(raw: string): { samples: Array<{ style: string; prompt: string }> }` — 容错 JSON 解析(去 markdown fence + zod schema 校验长度 === 3 + style/prompt 非空)
   - 导出 `extractDeckOutlineForPrompt(content: string): string` — 截前 2KB + 优先保留 cover heading + 各页 heading(给主 LLM 紧凑上下文)
   - 导出 `assessStyleDiversity(samples: Array<{ style: string }>): number` — pairwise Levenshtein normalized similarity 平均,≥ 0.8 视为雷同要 retry
2. 新建 `packages/agent/src/mood-board/index.ts`:
   - 导出 `generateMoodBoard(input: { deckId, userId, deckContent, mainLlmSettings, imageLlmSettings }): Promise<{ candidates: Array<{ assetId, style, prompt }> }>`
   - 步骤:(a) extractDeckOutlineForPrompt 截上下文 →(b) **复用 Phase 12+ pi-ai client 调主 LLM 非流式 1 次**(用 `mainLlmSettings`,system = MOOD_BOARD_SYSTEM_PROMPT,user = outline)→(c) parseMoodBoardLlmResponse 解析 →(d) assessStyleDiversity 检查,雷同则 **retry 1 次**(prompt 加「Previous attempt produced too similar styles: <prev labels>. This time make them genuinely distinct.」)→(e) 仍雷同走 fallback 接受用 → (f) 3 个 prompt 并发调 `generateImage`(size 固定 `512x512` 缩略图,降本)→(g) 每张图存 `deck_assets`(purpose='mood-board-candidate')
   - 任一图失败 → 整批失败 + 已写入 candidate 标记 discarded(避免脏 row);失败抛 `MoodBoardGenError`
3. 加 testing seams:`__setMainLlmCallerForTesting` + `__setGenerateImageForTesting`(沿用 [generate-slide-image.ts](../../packages/agent/src/tools/local/generate-slide-image.ts) 同款 DI 套路 + afterEach 复位防跨文件污染)
4. 加 `packages/agent/test/mood-board.test.ts`:
   - happy path:主 LLM 返 3 个差异化 prompt → 出 3 图 → 3 个 candidate uuid 落库
   - sanity check retry:主 LLM 第一轮返 3 个雷同 style → retry 触发 → 第二轮通过
   - retry 仍雷同 → 接受降级(不抛错,降级标志写日志)
   - 主 LLM 返非法 JSON → 抛 ParseError(用户看到友好错)
   - 任一图失败 → 已写入 candidate 标记 discarded + 抛 MoodBoardGenError
   - IDOR guard:跨 user deckId 拒绝
5. 加 `packages/agent/test/mood-board-prompt.test.ts`:`extractDeckOutlineForPrompt`(2KB 截断保留 heading)+ `parseMoodBoardLlmResponse`(去 fence + schema 校验)+ `assessStyleDiversity`(雷同/差异化 case)

**验证方法**:
- `pnpm -F @big-ppt/agent vitest run test/mood-board.test.ts test/mood-board-prompt.test.ts`
- inline snapshot 锁 `MOOD_BOARD_SYSTEM_PROMPT` 字符串防未来误改;**不**锁 LLM 输出(LLM 输出本就是动态的,只校 schema)

**风险**:
- 3 张并发同时调 OpenAI 撞 Tier 1 RPS:接 `image-semaphore.ts`(per-user concurrency=3,与生图 worker 共享 slot)
- 主 LLM 调用本身要 LLM key:`mainLlmSettings` 从 `users.llm_settings` 读;**未配主 LLM key 的用户**(理论不存在,所有用户都需要 LLM 才能用 Lumideck)→ 路由层 412 friendly error
- 样张时间 = 主 LLM(~5-10s) + 并发 3 图(~30-45s)≈ 35-55s:前端 modal 加双段 progress hint(「分析大纲 → 出图」)

---

### Task C:路由层 + 限频

**目的**:暴露 HTTP 端点,加 per-deck 3 次"换一批"限制 + IDOR guard。

**操作**:
1. 新建 `packages/agent/src/routes/mood-board.ts`:
   - `POST /api/decks/:id/mood-board/generate` → 调 `generateMoodBoard`(deckId, userId);per-deck 计数器 `mood_board_generate_count`(进程内存 Map 即可,重启清零;严格语义不重要 — 重启后用户从 0 重计 acceptable);第 3 次后 429 + 友好 error
   - `POST /api/decks/:id/anchor` body `{ assetId: string }` → IDOR guard(asset 必须属于该 deck + user,且 purpose='mood-board-candidate')→ 调 `markAsAnchor`(从 candidate 改 anchor,同 deck 其它 candidate 改 discarded,deck.anchor_asset_id 落库)
   - 两端点都 `requireAuth`
2. 把路由挂到 `packages/agent/src/app.ts` 主 router(`app.route('/api', moodBoardRouter)` 或直接 sub-mount);**避免 Hono wildcard 泄漏**(沿用 [CLAUDE.md 已知坑](../../CLAUDE.md#hono-路由) 第 1 条:显式 path 不用 `*`)
3. 加 `packages/agent/test/routes-mood-board.test.ts`:401(未登录)+ 403(跨 user)+ 429(限 3 次)+ 200(选定写库 + purpose 流转)

**验证方法**:
- `pnpm -F @big-ppt/agent vitest run test/routes-mood-board.test.ts`
- `curl -X POST http://localhost:4000/api/decks/1/mood-board/generate -H "Cookie: ..."` dev 手验(配 image LLM 后跑通)

**风险**:per-deck 计数 Map key 用 `deckId`(int),重启后清零是预期行为;若担心异常用户连点 4-5 次,可改 DB 行(留 Phase 17+ 如果真有滥用)

---

### Task D:`generate_slide_image` 工具层 anchor 注入

**目的**:工具层自动读 deck.anchor_asset_id,LLM 不感知。

**操作**:
1. 改 [`generate-slide-image.ts:269-303`](../../packages/agent/src/tools/local/generate-slide-image.ts#L269-L303) 的 hybrid 检测段:
   - **优先级**:slide frontmatter imageSrc(已有图,迭代) > deck.anchor_asset_id(全 deck anchor)> none
   - 现状已读 frontmatter imageSrc;补一段「frontmatter imageSrc 为空 + deck.anchor_asset_id 非空」分支:加载 anchor asset → 透传 baseImageBase64/Mime(IDOR guard 仍三条件 asset.deckId === deckId + asset.userId === ctx.userId + asset.data.length > 0)
2. 加 `packages/agent/test/routes-tools-anchor.test.ts`(或扩 routes-tools.test.ts):4 case
   - slide 已有 imageSrc + deck 有 anchor:用 imageSrc(优先)
   - slide 无 imageSrc + deck 有 anchor:用 anchor
   - slide 无 imageSrc + deck 无 anchor:无 baseImage(走当前 text-only)
   - deck 跨 user anchor 不被错读(IDOR 防护)

**验证方法**:
- `pnpm -F @big-ppt/agent vitest run test/routes-tools.test.ts -t "anchor"`
- 用 `__setGenerateImageForTesting` 捕获 worker 真透传给 generateImage 的 `baseImageBase64` 是否等于 anchor asset 的 BLOB base64

**风险**:测试已有 `__setGenerateImageForTesting` seam,沿用;**必须**加 afterEach 复位防跨文件污染(沿用 [CLAUDE.md 测试基建](../../CLAUDE.md#测试基建) 条 2)

---

### Task E:hybrid 失败三级降级

**目的**:vision 路 A 失败时退到路 B(纯 text + palette 约束),不直接走 fallback-rewrote。

**操作**:
1. 改 [`openai-image.ts:138-160`](../../packages/agent/src/llm/openai-image.ts#L138-L160):
   - 当前 `if (hasBaseImage)` 段是「不降级路 B,直接抛」;改为「先尝试路 B 一次(input.prompt 不变,baseImage 自动丢弃 — callImagesApi 本来就不读 baseImage),成功返 pathTaken='B';路 B 也失败再抛」
   - 抛错时 message 拼上 hybrid path A 的原错(诊断信息)
2. 加 `packages/agent/test/llm-openai-image.test.ts` 扩 case:
   - hybrid 路 A 5xx 失败 → 路 B 成功:返 pathTaken='B' + modelUsed='gpt-image-2'
   - hybrid 路 A + 路 B 都失败:抛错 message 含两个原因
   - hybrid 路 A 401:不退路 B(认证问题不解决),直接抛 ImageAuthError(现状保留)
3. 改 [`image-gen-job.ts` worker]:状态机增加 path-B-fallback 事件落 logServerEvent(`event:'path-b-fallback'`),便于排查 dogfood 时哪些页降级了

**验证方法**:
- `pnpm -F @big-ppt/agent vitest run test/llm-openai-image.test.ts`
- 跑 image-gen-job-fallback.test.ts 确认 state 流转 done(via path B)而非 fallback-rewrote

**风险**:hybrid 模式现在依赖 anchor 风格,降级路 B 后 anchor 风格丢失 — 这是已知 tradeoff,降级后**该页风格跟其它 anchor 页有偏差**,但 palette 维度仍对齐(buildStructuredImagePrompt 注入),比 fallback-rewrote 把图换成组件版好得多。logServerEvent 记 path-B-fallback 让用户可看到哪些页降级,知道为何风格不全统一

---

### Task F:前端 AnchorPickerModal + useMoodBoardPicker

**目的**:UI 层"选风格"流程。

**操作**:
1. 新建 `packages/creator/src/components/AnchorPickerModal.vue`:
   - 3 缩略图 grid + 选定按钮 + "换一批"按钮(第 3 次后 disabled + tooltip)+ "跳过本次"按钮
   - loading 状态(生成中 30-45s 显示骨架 + hint「正在为您准备 3 张风格样张,约 30 秒」)
   - error 状态(429 / 网络错 / OpenAI 失败,加 retry / 跳过)
2. 新建 `packages/creator/src/composables/useMoodBoardPicker.ts`:
   - state:`open: Ref<boolean>` / `candidates: Ref<Candidate[]>` / `loading` / `error` / `remainingGenerations: Ref<number>`(client-side mirror,真限频在 backend)
   - methods:`openPicker(deckId)` / `regenerate()` / `selectAnchor(assetId)` / `skip()`
   - 调 `api/decks` 的 `generateMoodBoard` / `setAnchor`
3. 加 `packages/creator/test/AnchorPickerModal.test.ts`(渲染 / 选定 emit / 换批 disabled 第 3 次)
4. 加 `packages/creator/test/useMoodBoardPicker.test.ts`(限频 / IDOR 兜底 / 跳过 emit)

**验证方法**:
- `pnpm -F @big-ppt/creator vitest run test/AnchorPickerModal.test.ts test/useMoodBoardPicker.test.ts`

**风险**:VTU 不跨 Teleport 边界 query(沿用 [CLAUDE.md 测试基建](../../CLAUDE.md#测试基建) 条 5),modal 加 `disableTeleport` prop

---

### Task G:useAIChat 接驳 + write_slides 完成后触发

**目的**:让选风格自然插入 LLM 生成流程,LLM 不感知 modal 存在。

**操作**:
1. 改 `packages/creator/src/composables/useAIChat.ts`:
   - LLM tool execution event 监听:`tool_execution.end` 且 `toolName === 'write_slides'` 且 `success === true` 时,fetch `GET /api/decks/:id` 检查 `anchorAssetId === null` 且 `hasImageLlmSettings === true`
   - 如条件成立:**暂停**继续收 LLM events(用 internal flag 在下一个 `useAIChat` consume 循环 await 信号)+ emit `anchor-picker-required` 事件到组件树
   - 组件树由 DeckEditorCanvas 接 → 调 `useMoodBoardPicker.openPicker(deckId)` 弹 modal
   - 用户选定/跳过 → composable resolve 信号 → useAIChat 继续 consume LLM events
2. 改 `packages/creator/src/components/DeckEditorCanvas.vue`(或顶栏组件):
   - 顶栏加"重选风格"按钮(image LLM 已配 + deck 已有 anchor 时显示);点击直接调 `useMoodBoardPicker.openPicker(deckId, { force: true })` 跳过 anchor === null 检查
   - 监听 `anchor-picker-required` 事件触发 modal
3. 加 `packages/creator/test/useAIChat-anchor-flow.test.ts`(或扩既有 useAIChat 测):
   - mock LLM session 发 write_slides tool_execution.end → 验证 modal 被打开 + LLM session 暂停 → 用户选定 → LLM 恢复
   - mock 跳过路径:LLM session 直接继续,不写 anchor

**验证方法**:
- `pnpm -F @big-ppt/creator vitest run test/useAIChat-anchor-flow.test.ts`
- 手验:`pnpm dev` → 新建 deck(image LLM 配过)→ 输入"生成 3 页关于 AI 的 PPT" → write_slides 完成后看 modal 是否弹出 → 选定 → 后续 generate_slide_image 是否都带 baseImage(看 `logServerEvent` 的 `hybrid-with-anchor` 事件)

**风险**:LLM session 暂停 + 恢复语义跟 useAIChat 当前 stream consume 循环耦合;**写之前先 grep `useAIChat` 现有 pause / resume 机制**(image-gen polling 已有类似 hook),复用而非另起;否则会撞 [CLAUDE.md 测试基建 条 11](../../CLAUDE.md#测试基建) "异步工具桥 polling"同款时序坑

---

### Task H:E2E 冒烟 + dogfood 验证

**目的**:全链路过一遍,确认产品体验跟设计预期一致。

**操作**:
1. 加 `packages/e2e/tests/anchor-image-flow.spec.ts`:
   - 走 stub 模式 `BIG_PPT_TEST_IMAGE_MODE=stub` 跳真 OpenAI(fixture PNG 复用 Phase 11.5)
   - 创 deck → image LLM 已配(test fixture user)→ 输入生成 prompt → write_slides 完成 → AnchorPickerModal 弹出 → 选第 1 张 → 后续 generate_slide_image 全部 success(stub 模式都返 fixture)→ DB 验证 `decks.anchor_asset_id` 写入 + N 张 slide asset 行 `purpose=null`
   - 跳过路径:开 modal → 点跳过 → deck.anchor_asset_id 仍 null + 流程继续
   - 换一批限频:连点 3 次"换一批" → 第 4 次按钮 disabled
2. dogfood 真打验证(commit 完成后,用户自己跑):
   - 用 test-api-keys memory 里的 OpenAI key 配 image LLM
   - 生成一个 22 页 deck → 走完 anchor 选定 → 看 22 张图风格肉眼是否更统一(尤其构图 / 笔触 / 元素密度)
   - 跟 Phase 11.6 老 deck(无 anchor)对比

**验证方法**:
- `pnpm -F @big-ppt/e2e test` 整套 E2E 全绿
- dogfood:产出 before/after 截图对比放 `docs/plans/32-phase11.8-anchor-image-styling.md` 末尾(关闭时)

**风险**:E2E webServer 启动 env 透传(BIG_PPT_TEST_IMAGE_MODE / DUCKCODING_TEST_BASE_URL)沿用既有 playwright.config 套路,无新风险

---

## 验收条件

- [ ] DB schema:`decks.anchor_asset_id` + `deck_assets.purpose` + `deck_versions.anchor_asset_id` 三列落 dev/test/prod
- [ ] `POST /api/decks/:id/mood-board/generate` 返 3 个 candidate asset uuid,per-deck 限 3 次后 429
- [ ] `POST /api/decks/:id/anchor` 选定后 `decks.anchor_asset_id` 写入,其它 candidate purpose 改 discarded
- [ ] `generate_slide_image` 工具 slide 无图但 deck 有 anchor 时自动透传 baseImageBase64(集成测验证)
- [ ] hybrid 失败三级降级:路 A 失败 → 路 B 成功(state=done + path-b-fallback 落日志);双失败 → fallback-rewrote
- [ ] 切模板 → anchor 清空,undo 切模板 → anchor 恢复
- [ ] AnchorPickerModal:正常打开/换批/选定/跳过 + 第 3 次后换批 disabled
- [ ] write_slides 完成后自动弹 modal(条件:image LLM 已配 + anchor === null);用户选定/跳过后 LLM session 自然继续
- [ ] 顶栏"重选风格"按钮:image LLM 配 + deck 有 anchor 时显示,点击重新走 mood board 流程
- [ ] E2E spec 全绿(stub 模式 4 case:正常选定 / 跳过 / 换批限频 / 工具透传 baseImage)
- [ ] dogfood 手验:22 页 deck 选定 anchor 后,图视觉风格肉眼对比 Phase 11.6 无 anchor deck 更统一(构图 / 笔触 / 元素密度)
- [ ] 全量回归 `pnpm test` + `pnpm e2e` 全绿
- [ ] coverage 门槛维持(agent 90/85,creator 75/65)

---

## 不做什么(范围围栏)

- ❌ **多 anchor**(每页一个 anchor / 章节级 anchor):一个 deck 一个 anchor 是本 Phase 简化语义。多 anchor 留 Phase 17+
- ❌ **用户上传自己的图作为 anchor**:虽然技术上能复用 user_assets 通路,但 UX / 校验 / 失败兜底都要单独想,本 Phase 不开。留 Phase 17+
- ❌ **基于 deck 主题 LLM 决定 anchor 风格**:LLM 提示生图模型选风格 → 失去用户对"调性"的控制权,跟"用户挑"产品定位冲突
- ❌ **跨 deck 复用 anchor**(同一用户多 deck 共享同一 mood board):同用户多 deck 主题各异,统一 anchor 反而限制创造;留远期
- ❌ **anchor 编辑**(用户改 anchor 几个像素再用):scope 失控
- ❌ **mood-board-discarded asset GC cron**:本 Phase 暂留 DB,Phase 17+ 跟其它 GC 一并做
- ❌ **样张超过 3 张**(4-6 张同时给用户挑):3 是 mvp;选项越多决策疲劳越大,留 dogfood 反馈再扩
- ❌ **用户手写 style label 自定义样张 prompt**(让用户输入"我想要 isometric 风"):主 LLM 已经看大纲自动出,用户挑就够;手写自定义是 prompt engineer UX,留远期
- ❌ **anchor 缩略图加水印 / 标记 "已选" 视觉提示**:顶栏"重选风格"按钮就够;modal 内当前已 anchor 不刻意展示

---

## 执行期偏离

### 偏离 #1: 多样性算法从字符级 Levenshtein 换 token-based Jaccard,阈值 0.8 → 0.3(2026-05-19,Task B-1)

- **原 plan(抉择 1)**:"sanity check pairwise Levenshtein normalized similarity 平均,≥ 0.8 视为雷同要 retry"
- **实测发现**:字符级 Levenshtein 对 "flat infographic / flat geometric / flat illustration" 这种"共享一个高频词但后半截全不同"系列只算 0.48 — 编辑距离看字符变换数,后半截不同就距离大。**用户视角下这 3 个 label 是雷同的**(都"flat" 调),算法没抓到
- **修正**:换 token-based Jaccard(把 label 按空白 / 连字符切词,小写后比 set 交并比)。"flat X / flat Y / flat Z" → 3 对都共享 {flat},Jaccard 各 1/3=0.33,平均 0.33;阈值改 **0.3** 触发 retry
- **commit**:同 Task B-1
- **预防回归**:`mood-board-prompt.test.ts` 加 case「3 个共享 flat 的 style → Jaccard 1/3=0.33 → 高于阈值触发 retry」+ 「2 对共享 1 对不共享 → 平均 1/9≈0.11 低于阈值放行」,实测数字锁死

### 偏离 #2: 并发出图从 Promise.all 换 Promise.allSettled(2026-05-19,Task B-2)

- **原 plan(Task B 操作 6)**:"3 个 prompt 并发调 generateImage";"任一图失败 → 整批失败 + 已写入 candidate 标记 discarded"
- **实测发现**:Promise.all 任一 reject 立即抛,**其它 inflight promise 还在跑 createAsset 写库**。catch 段执行 discardAssets 时 writtenAssetIds 仍空(fulfilled promise 还没 push id),最终 DB 留两条 candidate 没被 discard(脏 row)
- **修正**:换 Promise.allSettled,**等所有 settled 后**根据结果分流;有失败时收集所有 successful asset ids 再 discardAssets;失败时立即 ctrl.abort() 信号其它 inflight image 调用(对支持 AbortSignal 的 generateImage 友好,默认 generateImage 也接此参数)
- **commit**:同 Task B-2
- **预防回归**:`mood-board.test.ts > 出图任一失败` 显式断言「DB 中应有 2 行(头 2 张图已落库)+ 全部 purpose=mood-board-discarded」,而不是 0 行

---

## 踩坑与解决(实施期 / 关闭后追加)

> 待执行后回填。

---

## 测试数量落地(关闭后追加)

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit       |      |      |      |
| creator unit     |      |      |      |
| shared unit      |      |      |      |
| E2E              |      |      |      |
| coverage lines   |      |      |      |
| coverage branch  |      |      |      |
