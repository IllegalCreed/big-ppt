# Phase 11.6 — 图片优先模式（image-gen ON 时所有内容页直走 image-content）

> **状态**：✅ 已关闭（2026-04-30）
> **前置阶段**：[plan 20-phase11.5-image-content.md](20-phase11.5-image-content.md)
> **后续阶段**：[plan 待定 Phase 11](../requirements/roadmap.md#phase-11多用户并发--分享链接--多实例部署切换)
> **路线图**：[roadmap.md Phase 11.6](../requirements/roadmap.md#phase-116图片优先模式image-gen-on-时所有内容页直走-image-content)
> **执行子技能**：`superpowers:executing-plans`（与用户当面对齐 + 7 commit 串行落地）

**Goal**：Phase 11.5 落地图片生成基础设施后用户判断「image-content layout 出来的 AI 图远好于自研 layout/组件」。本 Phase 把 `generate_slide_image` 工具的策略从「only when explicitly asks」反转为「DEFAULT for every content slide when image LLM is configured」，把所有内容页直走 image-content 一条路。layout/组件路径仅在生图失败时由后台 worker 自动兜底重写（graceful-degradation）。封面、目录、章节标题、封底等高度定制的结构页保持原选法不动。

---

## 关键设计抉择（2026-04-30 与用户对齐）

1. **两条彼此独立的流程，不是叠加**：用户明确否决「先 write_slides 写完整 layout 版本作兜底，再叠加生图」的双轨方案。OFF 走 layout/component 决策树；ON 走「主 LLM 提炼生图 prompt → 生图 LLM 出图」直通车，slides.md 里同时只存在一种形态。Why：双轨耦合度高、token 浪费、用户视觉上看到两套形态切换有 race。
2. **配 image LLM = 默认 ON，不加独立总开关**：用户原话「如果用户配置了图片生成」直接当 trigger。Why：配 key 本身已经是 explicit consent，加额外开关属于过度设计；后续如成本反馈再加 `users.imageFirstMode` 字段。
3. **保持 image-content layout 纯图，不加文字 slot**：用户明确选「保持纯图」。Why：纯图视觉冲击更纯粹，与失败兜底通过「重写为组件版」实现 graceful-degradation 解耦。
4. **失败兜底 = worker 主动二次调 LLM 重写组件版（不在主流程提前写兜底）**：用户明确选「自动调一次 LLM 重写为组件版」。新建 `rewriteSinglePageToComponents`（借鉴 `rewriteForTemplate` 结构），worker 在 OpenAI 路 A/B 都失败时调一次非流式主 LLM，输入是 `fallbackSummary` + 整 deck 上下文，输出是单页 *-content + 组件版本。Why：保持双流程独立 + 不依赖主 LLM 提前生成冗余内容 + 失败时仍能 graceful 降级。
5. **形式由生图 LLM 自决，主 LLM 只传内容**：用户原话「让 LLM 知道他要生成的是幻灯片页就行了」。主 LLM prompt 只描述业务点 / 关键信息 / 主题氛围，不指定柱状图 / 插画 / 实景等形式限定词；工具层在已有 no-text negative constraint 之外，自动追加 "this is a slide page in a presentation deck" 正向约束。Why：生图模型对视觉判断力强于主 LLM，强限定形式反而限制效果。
6. **结构页不动**：cover / toc / section-title / back-cover 在 ON 模式下仍按结构 layout 选。Why：用户明确这些是「高度定制」的固定形态，AI 出图意义不大。
7. **rewriteForTemplate 切模板期强制 OFF**：buildSystemPrompt 显式传 `imageGenEnabled: false`，imageSrc 透传 + layout 名前缀替换由 LLM 完成。Why：切模板的目的是把旧 deck 重写成新模板的同等版本，不应在切模板期重新生图（用户成本不可控 + 体验混乱）。
8. **image_jobs 内存而非 DB**：发现 Phase 11.5 设计上 image-gen-job 就是进程内内存（注释明确「不依赖 DB 表」），所以 fallbackSummary 等扩展字段直接加 `ImageJobInput` interface 即可，**不需要 drizzle schema 迁移和 db:push**。Why：plan 阶段先以为要改表，落地时核实代码后大幅简化。

---

## ⚠️ Secrets 安全红线

- 本 Phase 不引入新环境变量
- 本 Phase 不动 `.gitignore`、不入新机密
- 7 个 commit 全部走 `git add` 显式列文件，无 `git add -A`

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/agent/src/prompts/rewriteSinglePageToComponents.ts` | 生图失败兜底:用 fallbackSummary + 整 deck 上下文非流式调主 LLM,把单页重写为 *-content + 组件 |
| `packages/agent/test/rewriteSinglePageToComponents.test.ts` | 新模块的最小单测(skeleton 模式 + DI seam 类型契约) |
| `packages/agent/test/image-gen-job-fallback.test.ts` | worker 兜底重写状态机覆盖(fallback-rewrote / fallback-failed / 向后兼容) |
| `docs/plans/21-phase11.6-image-first.md` | 本文档 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/src/prompts/buildSystemPrompt.ts` | `BuildSystemPromptOptions` 加 `imageGenEnabled`;新增 `DECISION_TREE_SECTION_ON` 与 `getDecisionTreeSection()` 选择器 |
| `packages/agent/src/prompts/rewriteForTemplate.ts` | 切模板期显式传 `imageGenEnabled: false`;helper(loadUserLlmSettings/resolveUpstream/stripMarkdownFence) 全部 export 给新模块复用 |
| `packages/agent/src/routes/prompts.ts` | 上 `authOptional` middleware,登录用户配了 image LLM → ON,未登录 / 未配置 → OFF;响应加 `imageGenEnabled` 字段 |
| `packages/agent/src/tools/local/generate-slide-image.ts` | TOOL_DESCRIPTION 改写为「DEFAULT for every content slide」;parameters 加 `fallbackSummary`;prompt 末尾追加 "this is a slide page" 正向约束;wrapper 注入 `updateSlideRaw` / `readSlides` / `rewriteSinglePage` 三个 fallback DI |
| `packages/agent/src/image-gen-job.ts` | `ImageJobState` 扩 `fallback-rewrote` / `fallback-failed`;`ImageJobInput` 加 `fallbackSummary` / `heading` / `templateId`;`RunImageJobDeps` 加 3 个可选 fallback DI;worker catch 块进入兜底流程(三件 DI 全注入 + job 字段全在时) |
| `packages/agent/test/prompts-ab-contract.test.ts` | 加双分支契约测试(ON 含图片优先短语 / OFF 维持现状) |
| `packages/agent/test/tools-generate-slide-image.test.ts` | 描述断言改为「DEFAULT for every content slide + fallbackSummary + graceful-degradation」 |
| `packages/creator/src/composables/useDecks.ts` | `ImageJobState` 镜像后端扩两个状态 |
| `packages/creator/src/composables/useGenerateImageJob.ts` | 新状态进度比例;`isSuccess()` helper;timeout 加宽到 3 分钟 |
| `packages/creator/src/composables/useAIChat.ts` | `trackImageJob` 文案分支(成功出图 / 已自动降级为组件版) |
| `docs/requirements/roadmap.md` | 在 Phase 11.5 段后插入 Phase 11.6 |

### 删除

无。

---

## 数据模型变更

无。`image_jobs` 是进程内内存（参考关键设计抉择 #8），新增字段直接加 TypeScript interface，不动 DB schema、不跑 `db:push`。

---

## 阶段拆分

7 个 commit 串行落地，TDD 顺序（测试在前、实现在后）：

### Commit 1：Phase 11.6 prompt 双分支与工具签名契约测试

加 4 个 ON 分支测试 + 工具描述断言升级 + `BuildSystemPromptOptions.imageGenEnabled` 占位字段。预期 fail 状态：4 个新断言 fail，其余 OFF 测试 + 现有 happy path 全 pass。

**验证**：`pnpm exec dotenv -e .env.test.local -- vitest run test/prompts-ab-contract.test.ts test/tools-generate-slide-image.test.ts` → 4 fail / 29 pass。

### Commit 2：buildSystemPrompt 加 imageGenEnabled 双分支 + ON 决策树

实现 ON 决策树替换 OFF（不是叠加）；routes/prompts.ts 上 authOptional + 读 image-gen settings；rewriteForTemplate 显式传 false。

**验证**：prompts-ab-contract 32/32 pass；tools-generate-slide-image 仍 fail 2 个（描述 + schema）。

### Commit 3：generate_slide_image 加 fallbackSummary 参数 + 描述改写

工具描述改写、parameters 加 fallbackSummary、prompt 末尾追加 "this is a slide page" 正向约束、`ImageJobInput` 与 `ImageJobState` 扩展。

**验证**：48/48 pass（prompt + tool + image-gen-job 三套）。

### Commit 4：rewriteSinglePageToComponents 模块

新建模块（借鉴 rewriteForTemplate 结构）+ 6 个最小单测（skeleton 模式 + DI 类型契约）。helper 从 rewriteForTemplate 全部 export 共享。

**验证**：`vitest run test/rewriteSinglePageToComponents.test.ts` 6/6 pass；全 agent suite 532/532 pass。

### Commit 5：image worker 失败兜底改造

`RunImageJobDeps` 加 3 个可选 fallback DI（updateSlideRaw / readSlides / rewriteSinglePage）；worker catch 块在三件 DI + job 必要字段都在时调 rewriteSinglePage → updateSlideRaw → state='fallback-rewrote'，否则向后兼容标 'failed'。新增 7 个 fallback 测试覆盖所有分支（含老语义向后兼容）。生产链路 generate-slide-image.ts 默认注入这 3 项。

**验证**：`vitest run test/image-gen-job-fallback.test.ts test/image-gen-job.test.ts test/tools-generate-slide-image.test.ts` 31/31 pass；全 agent suite 539/539 pass。

### Commit 6：creator 接 fallback-rewrote / fallback-failed 状态展示

ImageJobState 镜像；`isSuccess()` helper 让 done 与 fallback-rewrote 都触发 SlidePreview 刷新；trackImageJob 文案分两支；timeout 加宽到 3 分钟（兜底重写额外 5-15s）。

**验证**：creator 79/79 pass + type-check pass。

### Commit 7：roadmap 立项 + plan 21 文档

roadmap.md 插 Phase 11.6 段；新建本 plan 文件。

---

## 验收条件

- [x] OFF 用户（未配 image LLM）行为与 Phase 11.5 完全一致（system prompt 走 OFF 决策树）
- [x] ON 用户 system prompt 含「图片优先」「写完 deck 之后必须串联调 generate_slide_image」「fallbackSummary」关键短语
- [x] 工具签名加 fallbackSummary 参数 + prompt 末尾自动追加 "this is a slide page" 正向约束
- [x] worker 出图失败 + 三件 DI 全注入 + 必要 job 字段都在 → state='fallback-rewrote'，slides.md 该页变成 *-content + 组件版
- [x] worker 出图失败 + 兜底也崩 → state='fallback-failed'，slides.md 该页保持 *-image-content + 空 imageSrc
- [x] 切模板期间不重新生图（buildSystemPrompt 强制 imageGenEnabled: false）
- [x] 全量回归：agent 539 + creator 79 全绿；agent coverage 不退步

---

## 不做什么（范围围栏）

- ❌ 已有 deck 自动回填生图（只对新生成 deck 生效；用户主动让 AI 改才会触发）
- ❌ Settings 加「图片优先」总开关（配 key 即默认 ON）
- ❌ 切模板期间重新生图（imageSrc 透传 + layout 前缀替换）
- ❌ N 个 generate_slide_image 的 worker 并发限流（v1 假定 OpenAI tier 1+ RPS 足够）
- ❌ image_jobs 表持久化（沿用 Phase 11.5 进程内内存设计）

---

## 执行期偏离

- **plan 设计阶段以为 image_jobs 是 DB 表**（plan 段 C 写「加 fallback_summary 字段 + db:push」），落地时核实 image-gen-job.ts 注释明确「不依赖 DB 表（不做跨设备同步）」，所以扩展字段直接加 `ImageJobInput` TS interface 即可。**实际省了 drizzle schema 改动和 3 处 db:push**，工作量减少。
- **dogfood 阶段加了 8 件原 plan 没列的事**(详见 [plan 23 dogfood follow-up](23-phase11.6-dogfood-followup.md)):首次跑 22 页 deck 暴露多个真实问题(并行风格漂移 / 第 6/7 页空 frontmatter / heading 缺失 / 跨模板污染 / 撞 RPS 限制等),触发 8 个 commit 收尾(`19c6278` ~ `bebcdc4`):
  - **结构化 image prompt augmentation**:工具层把 LLM 传的自由文本 prompt 重新组装成「This is slide N/M of deck:<heading>. Visual concept: <prompt>. Mandatory style anchor: clean editorial illustration, terracotta + cream + navy palette, paper texture, subtle gradient, no text/title/banner anywhere」结构化模板,所有页风格统一(原 22 页并行各画各的)
  - **fallbackSummary 改必填**:Phase 11.6 v1 设为可选,dogfood 时 LLM 经常不传 → worker 失败兜底无输入 → 整页空白。改为 schema required + 入口校验
  - **删 list_templates 工具**:跨模板返回所有 manifest 触发污染(beitou deck 里 LLM 看到 jingyeda layout 引用,生成出 jingyeda-cover layout)。当前 deck 模板 id 已在 system prompt 中,LLM 不需要再 list
  - **read_template 收紧到当前模板 + ALLOWED_NAMES whitelist**:防跨模板 + 限定 DESIGN.md / starter.md 二选一(早期 cover.md / content.md 等 Phase 6 layout-per-file 概念已废弃)
  - **edit_slides old_string 长度上限 300 char**:LLM 误用它一次替换整段甚至跨页内容,违反「页内字符串小改」语义
  - **manifest image-content required 修正**:[imageSrc] → [heading]。imageSrc 由工具填、LLM 视角不必填;heading 是顶部 header bar 必填字段
  - **create_slide / update_slide 加 frontmatter 必填校验**:基于 layout 的 manifest required 字段集校验。LLM 漏字段 → 工具拒收 + 引导
  - **per-user image worker 并发限流 (默认 3)**:用户 dogfood 时 22 个 job 并发撞 OpenAI Tier 1 RPS,加 `pLimit(IMAGE_GEN_CONCURRENCY)` 默认 3
  - **buildSystemPrompt 自动注入图片资源清单**:扫当前模板目录下的 png/jpg/webp/svg,拼到 prompt「图片资源」段,告诉 LLM 哪些路径合法
  - **system prompt 决策树修正**:原「切模板任务时（system 调用）：仅替换 frontmatter `layout:` 前缀」对 LLM 误导,改为「切换模板：用 `switch_template` 工具触发」
- **manifest tokens.css 色板搬到 imageGenStyle 字段**:Phase 11.6 v1 设计 LLM 在 prompt 里描述配色,但 LLM 不知道当前模板的视觉调性。dogfood 后改:tokens.css 关键色值搬到 `manifest.imageGenStyle.palette` 字段,buildImagePromptWithStyle 把 palette + style invariants 注入每个生图 prompt,实现「同 deck 22 页风格一致」

---

## 踩坑与解决

### 坑 1：OFF 默认分支测试断言 `not.toContain('generate_slide_image')` 太严

- **症状**：写完 Commit 1 测试跑出 5 fail，本来期望 4 fail，多一个是 OFF 默认分支测试 `expect(p).not.toContain('generate_slide_image')`
- **根因**：manifest.json 里 `*-image-content` layout 的 `description` / `bodyGuidance` 本身就含 "generate_slide_image" 字面量（合理：让 LLM 知道这个 layout 的字段由该工具填）。所以 OFF prompt 也含这个字符串，断言永远不可能 pass
- **修复**：把 OFF 分支断言改为只检 ON 独有的「图片优先」+「fallbackSummary」短语（commit 1）
- **防再犯**：写「不含 X」断言时先 grep 一下 X 在 manifest / 工具描述等下游已存在与否——manifest 是 prompt 字面量的源头之一。**未提炼到 CLAUDE.md**（一次性认知偏差，不构成跨 Phase 复发风险）

### 坑 2：测试运行不能直接 `pnpm exec vitest`

- **症状**：直接调 `vitest run` 报「DATABASE_URL 未设置」
- **根因**：agent 测试需要 `lumideck_test` 真 MySQL，`package.json` test 脚本是 `dotenv -e .env.test.local -- vitest run`，必须经过 dotenv 包装注入连接串
- **修复**：用 `pnpm exec dotenv -e .env.test.local -- vitest run <文件>` 替代裸 vitest
- **防再犯**：CLAUDE.md「常用命令」段已经写了正确入口（`pnpm -F @big-ppt/agent test:coverage` 等），下次先看 package.json scripts 再决定怎么调

### 坑 3:dogfood 22 页 deck 并行生图风格不统一

- **症状**:用户实际跑 dev,22 页内容一次性触发,生图 LLM 各画各的(有插画有照片有图表),deck 视觉碎裂
- **根因**:v1 设计「主 LLM 只描述内容,形式让生图 LLM 自决」,但生图 LLM 在不同 prompt 里完全独立选风格(无 deck 级 style anchor)。文字"This is a slide page" + no-text 约束只解决「不画文字」,不解决「同 deck 风格一致」
- **修复**:工具层 prompt augmentation —— 主 LLM 传内容 → 工具层包装成「This is slide N/M of deck:<heading>. Visual concept: <prompt>. Mandatory style anchor: clean editorial illustration, terracotta + cream + navy palette, paper texture, subtle gradient」结构化模板,style anchor 来自 `manifest.imageGenStyle`。所有页用同一 style anchor → 风格一致
- **防再犯**:已写 CLAUDE.md「模板元数据归属」章——AI 出图色板 / 风格 invariants 必须放 manifest 同包,agent 不维护映射表

### 坑 4:并发出图撞 OpenAI Tier 1 RPS 限制

- **症状**:dogfood 22 页并行触发,部分 job 返 429 / 大量 retry / 最终一些页失败
- **根因**:OpenAI Tier 1 image gen 默认 RPS 5,Phase 11.6 v1 不加 worker 并发限流(原假定 RPS 足够)
- **修复**:加 `pLimit(IMAGE_GEN_CONCURRENCY)` per-user 限流,环境变量默认 3
- **防再犯**:任何后台 worker 调外部 API,默认加并发限流;后续 GLM/Anthropic image API 类似处理

### 坑 5:跨模板 manifest 污染

- **症状**:beitou deck 里 LLM 生成 frontmatter 写了 `layout: jingyeda-cover` 跨模板 layout,渲染失败
- **根因**:`list_templates` 工具返回所有 template manifest,LLM 看到 jingyeda 的 layout 名直接复用;`read_template` 也接受任意 path 让 LLM 跨模板读
- **修复**:删 list_templates 工具(当前 deck 模板 id 在 system prompt 已有,LLM 不需要再 list);read_template 收紧到当前 deck 模板 + ALLOWED_NAMES whitelist
- **防再犯**:任何"返回多模板信息"的工具都要按 deck 上下文过滤;manifest 里 layout 名带模板前缀本来就是为了防混淆,但工具不该把多模板 layout 一起塞给 LLM

### 坑 6:image-content layout required 字段错配 LLM 视角

- **症状**:dogfood 第 6/7 页 frontmatter 完全空白,LLM 写 layout 时漏 heading
- **根因**:manifest image-content required = `["imageSrc"]`,但 imageSrc 是工具层填的、LLM 视角不应主动填;真正 LLM 视角必填的 heading(顶部 header bar 渲染)反而没列 required
- **修复**:manifest required 改 `["heading"]`;新建 `validateFrontmatterAgainstManifest` helper,create_slide / update_slide 入口校验缺失字段直接拒收 + 引导
- **防再犯**:写 manifest required 时区分「LLM 视角」vs「最终落盘视角」——必填 = LLM 必须传

---

## 测试数量落地

| 指标             | 起点 | Phase 11.6 主体 | dogfood 收尾 | 终点 |
| ---------------- | ---- | --------------- | ------------ | ---- |
| agent unit       | 525  | 539 (+14)       | +14          | 553  |
| creator unit     | 79   | 79              | +0           | 79   |
| shared unit      | -    | -               | -            | -    |
| E2E              | -    | -               | -            | -    |
| coverage lines   | TBD  | TBD             | TBD          | TBD  |
| coverage branch  | TBD  | TBD             | TBD          | TBD  |

> dogfood 阶段 +14 测试分布:
> - validate-frontmatter.test.ts (新建): +9
> - tools-local.test.ts: +5(create_slide / update_slide 校验 + edit_slides 长度上限 + read_template whitelist)
> - tools-generate-slide-image.test.ts: -? 个老断言改写,净 +0

> agent 的 14 个新测试分布：
> - prompts-ab-contract: +3（imageGenEnabled true / false / 默认 OFF）
> - tools-generate-slide-image: +1（原 1 个改写 + 1 新 schema 断言，净 +1 因为原断言被替换）
> - rewriteSinglePageToComponents（新建）: +6
> - image-gen-job-fallback（新建）: +7
> - 现有 image-gen-job: 不动
