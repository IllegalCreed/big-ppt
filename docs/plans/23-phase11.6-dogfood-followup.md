# Phase 11.6 dogfood follow-up — 工具/prompt 翻新 + 并发限流 + 后端日志 + Slidev 重启

> **状态**：✅ 已关闭（2026-05-01）
> **前置阶段**：[plan 21-phase11.6-image-first.md](21-phase11.6-image-first.md) ✅
> **路线图**：[roadmap.md Phase 11.6](../requirements/roadmap.md#phase-116图片优先模式image-gen-on-时所有内容页直走-image-content)
> **commit 范围**：`19c6278` ~ `4b1bfdd`（共 14 个 commit，分两波 dogfood）

**Goal**：Phase 11.6 主体（plan 21）落地后，用户实际跑 22 页 deck 暴露大量真实问题，分两波收尾：
- **第一波（8 commit `19c6278`~`bebcdc4`）**：工具翻新（fallbackSummary 改必填 / 删 list_templates / read_template 收紧 / edit_slides 长度上限 / manifest required 修正 / 切模板文案）+ 并发限流 + image prompt 结构化 schema
- **第二波（6 commit `e2bab80`~`4b1bfdd`）**：UX 修复（前端 hard timeout / ToolStep state 联动 / LLM 文案约束）+ 后端日志落盘 + LLM 不调生图 regression 修复 + starter 放行 write_slides + MAX_ITERATIONS 200 + Slidev 进程重启入口

---

## 关键设计抉择

每条带 Why（为什么这样选而不是另一种）。

1. **生图 prompt 改成结构化 schema**（commit `19c6278`）：原 v1 让 LLM 自由文本写 prompt，22 页并发各画各的，风格碎裂。改成工具层把 LLM 传的 prompt 重组为「This is slide N/M of deck:<heading>. Visual concept: <prompt>. Mandatory style anchor: <palette + texture + invariants>」结构化模板，所有页用同一 deck-level style anchor。Why：image LLM 不擅长跨 prompt 保持风格一致；style anchor 由工具层强加而非依赖 LLM 自觉，可控性高。参考 Codex imagegen skill 同款做法。

2. **imageGenStyle 色板搬到 manifest.json**（commit `6b4d18d`）：原架构错误地在 agent 里维护 `Record<templateId, palette>` 映射表。Why：模板视觉元数据归属违反「模板元数据归属」原则——色板跟模板同包才能避免加新模板要改两处 + 数据漂移。已写入 CLAUDE.md「模板元数据归属」章。

3. **per-user image worker 并发限流（默认 3）**（commit `095e0e8`）：dogfood 时 22 个生图 job 并发触发，撞 OpenAI Tier 1 RPS（默认 5 image/min）限制，部分 job 429 失败。加 `pLimit(IMAGE_GEN_CONCURRENCY)` per-user，默认 3。Why：保守值 3 在多数 OpenAI tier 下安全；env override 让重度用户调高。配合 graceful-degradation 兜底，撞 429 时 worker fallback 自动重写为组件版。

4. **fallbackSummary 改必填**（commit `058b0c1`）：Phase 11.6 v1 设为可选，dogfood 时 LLM 经常不传 → worker 失败兜底无输入 → 整页空白。schema required + 入口校验直接拒收。Why：「设计上可选 + 实际必填」的字段是反模式，应该 schema 强制。

5. **删 list_templates 工具 + read_template 收紧到当前 deck**（commit `b5fa865`）：dogfood 看到 beitou deck 里 LLM 写出 `layout: jingyeda-cover` 跨模板 layout 名。Why：list_templates 把所有模板 manifest 一起 dump 给 LLM，LLM 看到别的模板 layout 名直接复用——根因是工具暴露了它不需要的信息。当前 deck 模板 id 已在 system prompt 里，list_templates 多余。read_template 同步收紧到当前模板（templateId 从 ctx 读），不让 LLM 传模板路径。

6. **edit_slides old_string 长度上限 300 char**（commit `0e488ef`）：LLM 误用 edit_slides 一次替换整段或跨页内容（拿来改大段是反模式，违反「页内字符串小改」语义）。schema maxLength 300 + 入口运行时双重校验，超长拒收 + 引导 update_slide。Why：300 char 覆盖"改一个词 / 数字 / 短短语 / 一句话"的合理用法，超过说明 LLM 误用。

7. **read_template 白名单收紧到 ALLOWED_NAMES**（commit `0e488ef`）：早期 cover.md / content.md 等 Phase 6 layout-per-file 概念已废弃，当前模板目录下其实只有 DESIGN.md / starter.md。LLM 调任意 .md 名字浪费工具调用。schema enum + 运行时双重校验，仅这两个文件名通过。

8. **manifest image-content required 修正：[imageSrc] → [heading]**（commit `e226d37`）：原 required 列了工具层填的 imageSrc，让 LLM 视角混乱（写 layout 时它没生图就没法填 imageSrc）。改为 heading 必填（顶部 header bar 渲染，缺 → 留白丑陋），imageSrc 改可选 + description 显式说"由 generate_slide_image 工具填,LLM 不要主动填"。Why：manifest required 字段必须反映 **LLM 视角必填**，不是「最终落盘视角」。

9. **新建 validate-frontmatter helper + create_slide / update_slide 入口校验**（commit `e226d37`）：基于 layout 的 manifest required 校验 frontmatter，缺失直接拒收 + 友好 error 引导。Why：单纯改 manifest required 不够，工具层不读 manifest 就没人执行该规则。helper 用 layout 名 derive templateId（取 prefix 拼 -standard，跟 generate-slide-image 的 deriveImageLayoutName 对称）。

10. **system prompt 决策树修正**（commit `e226d37`）：原 OFF 决策树最后一行「切模板任务时（system 调用）：仅替换 frontmatter `layout:` 前缀」对 LLM 误导（LLM 不知道何为 system 调用，且现在 deterministic 路径才是字符串替换、LLM fallback 路径其实就是 LLM 重写）。改为「切换模板：用 `switch_template` 工具触发」。Why：决策树是给 LLM 看的，应该写 LLM 能直接执行的指令，不写架构内部术语。

11. **LLM-facing 文本清掉「Phase 11.X」内部 phase 标识**（commit `e226d37`）：manifest description / 工具 description 里出现「Phase 11.6 起...」对 LLM 是噪音（LLM 不知道 phase 含义）。grep + 清。开发者注释（JSDoc / // 注释）保留 phase 标识不动。

12. **切模板按钮文案修正 + rewriteForTemplate 加 imageSrc 保留约束**（commit `bebcdc4`）：用户实地核实发现切模板**多数情况是 deterministic 字符串替换**（template-switch-job.ts L78「完全跳过 LLM」），仅 deck 含 chart.js / 原创 Vue 组件 / 模板对不兼容时才 fallback LLM 重写。原前端文案"AI 重写"对多数情况误导。改文案 + 显式说"image-content 页的 AI 图保留"。同时 rewriteForTemplate user prompt 加约束「imageSrc 字段必须逐字保留」防 LLM fallback 路径漏掉 imageSrc。Why：用户体验文案必须反映实际行为；fallback 路径罕见但要兜住，不靠 LLM 自觉。

### 第二波（dogfood 第二轮 6 commit）

13. **修生图 UX 三件套**（commit `e2bab80`）：用户反馈「显示失败但还在跑 / 22 个 ToolStep 一起转圈 / LLM 说"已生成完了"过早」三个问题。
   - **删前端 hard timeout**:`useGenerateImageJob` 原 3min total cap → 排队尾的 job 早超时标 failed,但后端 worker 还在跑实际成功率高,前端误报。删 timeout 改靠后端 IMAGE_QUEUE_TIMEOUT_MS=10min + 用户 cancel 兜底。Why:pending 长时间排队是合理状态,前端不该误超时。
   - **ToolStep label 实时反映 state**:`watch(job.stage)` → pending 显示「排队中…」/ running 显示「生成中…」/ terminal 走原 success 文案。Why:之前从头到尾「正在生成 AI 图片…」转圈,跟后端 pLimit=3 排队脱节,用户看 22 个 ToolStep 一起转误以为全在并行跑。
   - **LLM 文案约束**:system prompt ON 决策树末尾加「最终回复给用户时的措辞约束」,工具描述强化「`{jobId,queued}` 仅表入队,N 张图实际耗时 N/3 × 30-60s」,**不要说**「已生成 N 页 PPT」/「配图已完成」,**应说**「已生成 N 页大纲,正在为 X 个内容页配图(后台异步)」。Why:LLM 收到全部 tool_call success 自然觉得任务结束,文案误导用户。

14. **logServerEvent 后端事件落盘**（commit `c8b9ffa`）：dev server stdout 不持久化,关掉终端就丢;dogfood 报「图没出来」事后无从排查。
   - 新建 `packages/agent/src/logger/server-log.ts`:`logServerEvent({ category, event, ...任意业务字段 })` append 到 `<logsDir>/server-YYYY-MM-DD.jsonl`,失败容错(吞错不抛)
   - image-gen 全链路接入 8 个事件(running / gen-success / done / cancelled / gen-failed / fallback-rewrote / fallback-failed / queue-timeout)+ generate-slide-image worker wrapper 兜底 worker-wrapper-error
   - 配套 console.log mirror,既给 dev 终端实时看又落盘
   - 5 个新 server-log.test 单测(落盘 / 多次 append / 自动 mkdir / fs 失败容错 / ts override)
   - **CLAUDE.md 新增「后端日志规范」章节**(放安全规范之后,详写必须落盘 vs 不必落盘场景 + 调用约定 + 事后排查 grep / jq 命令示例)
   - Why:dogfood 用户问"图没出来"我们事后能 grep 到原因(OpenAI 502 vs 排队超时 vs cancel),不再抓瞎。

15. **修 LLM 不调生图 regression**（commit `87cd77a`）：dogfood 报「同样的提示词不调生图工具了」。日志定位 LLM 走「局部修改」路径(slides.md 已有页非空 deck),用 update_slide / create_slide 一页一页加 *-image-content layout,但**完全没调 generate_slide_image**。原 ON 决策树只描述了「write_slides 输出整 deck 后串联 N 个 generate_slide_image」,**没覆盖** create_slide / update_slide 两条等价入口。
   - 决策树「工具调用契约」段重写为「**只要你创建/改写一个 *-image-content 页**(无论 write_slides / create_slide / update_slide),接下来必须给该页调一次 generate_slide_image」+ A/B/C 三种入口的具体调用序列示例
   - 末尾强调「每输出一个 *-image-content layout 字段都必须配一次 generate_slide_image,**没有例外**」
   - **server-log NODE_ENV=test 跳过写入**:发现之前 vitest 跑 image-gen-job.test fixture 数据(asset-uuid-001 / OpenAI 502 mock 等)写到 `<repo>/logs/server-*.jsonl` 跟用户真 dogfood 日志混在一起,定位失败被它误导过一次。`logServerEvent` 加保护:`NODE_ENV=test && !BIG_PPT_LOGS_DIR` 时跳过,想验证落盘的测试自己 setEnv。

16. **starter 占位骨架放行 write_slides + MAX_ITERATIONS 20→200**（commit `ef4c2b3`）：dogfood 报「第一次生成不是整体生成,一上来就单张」+「主循环没明确结束就跳出」。
   - **starter 放行**:deck 创建时填入了模板 starter.md 演示骨架(cover + toc + section + content + back-cover 5 页带占位文字),`read_slides` 看到 ≥1 页非空 → LLM 走「局部修改」用 update_slide / create_slide 一页一页改,而不是 write_slides 整体。`writeSlides` 加 `isDefaultStarterContent` 检测(`YYYY/MM/DD` + `请填写标题` + `请填写副标题` 占位 marker ≥2 个同时存在视为 starter,放行整体覆盖;真用户内容仍拒)。system prompt「工作方式」段同步引导:`read_slides` 看到占位 marker → 视为空 deck → 用 write_slides
   - **MAX_ITERATIONS 20→200**:Phase 11.6 图片优先单页路径每页吃 2 turn(`create_slide` → 下一 turn `generate_slide_image`),10 页 deck 已经满。日志显示 `session_end reason="max_iterations" turns=20` LLM 还在调 tool 就被截断。调到 200 给 50+ 页极长 deck 留余地。
   - 新增 2 个工具单测:starter 放行 + 真用户内容仍拒收

17. **session-end 主动 refresh iframe(轻症缓解 HMR 缓存)**（commit `e467e53`）：dogfood 报「第 20 页又出现另一个模板的配色」。日志核实 LLM 行为完全正确(layout 全 beitou-* 没漏 replaceFrontmatter)——纯 Slidev / Vite dev server 进程内 vite module cache 在 long session(几十次 frontmatter HMR patch)累积错位,layout component 缓存对不上。
   - useAIChat session 结束(reason=completed 或 max_iterations)时主动调 `slideStore.refresh()` 触发 iframe full reload,强同步 iframe 跟最终 slides.md
   - 因为 session 已结束没新改动,跟 Slidev HMR race 风险消除(已知坑「不要在 HMR 期间手动 refresh,否则 502」对 session-end 时机不适用)
   - **局限**:仅治前端 iframe 缓存层,清不了 Slidev dev server 进程内 vite cache(用户报告刷新没用就是这层)

18. **SlidePreview 「刷新」按钮改造为「重启 Slidev 进程」**（commit `4b1bfdd`）：iframe full reload 清不了 Slidev dev server 进程内 vite module cache;唯一根治是重启进程。
   - **后端**:新增 `POST /api/slidev-restart` 路由(`packages/agent/src/routes/slidev-restart.ts`),production execFile `pm2 restart lumideck-slidev`(pm2 ecosystem 已注册);development 返 503 + 提示「dev 跑 turbo,agent 无 supervise 权限,请手动 cmd+C 再 pnpm dev」;落 `restarted-by-user` / `restart-failed` / `restart-rejected-dev-mode` 三种 server-log 事件
   - **前端**:SlidePreview 「刷新」按钮 onClick 改调 `/api/slidev-restart`,等 1.5s 让 Slidev 起来再 `slideStore.refresh()` iframe reload;dev 503 fallback 仅 iframe reload + 提示
   - **LLM-busy 保护**:`useSlideStore` 加 module-scope `aiBusy` ref + `setAIBusy`;`useAIChat` `watch(status)` 同步(`thinking`/`streaming`/`calling_tool` → `aiBusy=true`);SlidePreview 按钮在 `aiBusy=true` 时变橙色警示色 + title「⚠️ AI 工作中,重启会中断当前任务(慎重)」+ 点击弹 `confirm`「重启会中断 tool_call,确定?」。允许卡死场景强制重启,默认警示
   - **Why**:正常情况下 LLM 不在跑时一键清缓存(1-2s 等);卡死场景给用户兜底强制重启;且生产 / dev 模式都 work(生产走 pm2,dev 走 fallback)

---

## ⚠️ Secrets 安全红线

- 本 Phase 不引入新环境变量（IMAGE_GEN_CONCURRENCY 是可选 env override，默认 3，不入 .env.example）
- 所有 commit 走 `git add` 显式列文件

---

## 文件改动汇总（按 commit）

| commit | 标题 | 主要文件 |
| --- | --- | --- |
| `19c6278` | 工具层 prompt 重构为结构化 schema（参考 Codex imagegen skill） | `tools/local/generate-slide-image.ts`（buildImagePromptWithStyle helper）|
| `6b4d18d` | imageGenStyle 色板搬到 manifest.json，纠正架构错误 | `templates/{beitou,jingyeda}-standard/manifest.json`（imageGenStyle 字段）+ agent 删除内部映射表 |
| `095e0e8` | image worker 加 per-user 并发限流（默认 3） | `image-gen-job.ts`（pLimit）+ env IMAGE_GEN_CONCURRENCY |
| `058b0c1` | fallbackSummary 改必填 + system prompt 强化 heading 必填约束 | `tools/local/generate-slide-image.ts` schema required + 入口校验；buildSystemPrompt ON 决策树文案 |
| `b5fa865` | 修跨模板污染—删 list_templates 工具，read_template 收紧到当前 deck | 删 `tools/local/list-templates.ts`；`tools/local/read-template.ts` 改 ctx-aware（拿 deck.templateId） |
| `0e488ef` | edit_slides 长度上限 + read_template 白名单收紧 | `tools/local/edit-slides.ts` maxLength 300；`tools/local/read-template.ts` ALLOWED_NAMES enum |
| `e226d37` | manifest required 修正 + frontmatter 校验 + LLM-facing 文本清理 | `manifest.json` × 2 image-content required；新建 `templates/validate-frontmatter.ts`；`tools/local/create-slide.ts` + `update-slide.ts` 入口校验；buildSystemPrompt 决策树切模板表述；plan 21 / roadmap 文档回填 |
| `bebcdc4` | 切模板按钮文案修正 + rewriteForTemplate 加 imageSrc 保留约束 | `creator/components/{TemplatePickerModal,TemplatePreviewPane,DeckEditorCanvas}.vue` 文案；`prompts/rewriteForTemplate.ts` user prompt 加约束 |
| `e2bab80` | 修生图 UX 三件套(timeout / ToolStep / LLM 文案) | `creator/composables/useGenerateImageJob.ts` 删 hard timeout;`useAIChat.ts` `trackImageJob` 加 `watch(stage)`;buildSystemPrompt ON 决策树最终回复约束 + `tools/local/generate-slide-image.ts` description |
| `c8b9ffa` | logServerEvent + image-gen 全链路接入 | `agent/src/logger/server-log.ts`(新)+ image-gen-job.ts 8 事件 + generate-slide-image worker wrapper + `test/server-log.test.ts` + CLAUDE.md「后端日志规范」 |
| `87cd77a` | 修 LLM 不调生图 regression(ON 决策树覆盖 3 种入口) + server-log NODE_ENV=test 保护 | `prompts/buildSystemPrompt.ts` 决策树重写为「create_slide / update_slide / write_slides 三种入口都要调生图」+ `logger/server-log.ts` 加测试隔离 |
| `ef4c2b3` | starter 放行 write_slides + MAX_ITERATIONS 20→200 | `slides-store/index.ts` `isDefaultStarterContent` 检测 + buildSystemPrompt 工作方式段引导 + `creator/composables/useAIChat.ts` `MAX_ITERATIONS` 200 + 2 个新工具单测 |
| `e467e53` | LLM session 结束主动 refresh iframe(轻症缓解 HMR) | `creator/composables/useAIChat.ts` 在 reason=completed/max_iterations 后 `slideStore.refresh()` |
| `4b1bfdd` | SlidePreview 「刷新」按钮改为「重启 Slidev 进程」+ LLM-busy 保护 | `agent/src/routes/slidev-restart.ts`(新)+ `app.ts` mount + `creator/components/SlidePreview.vue` onClick 改 + `useSlideStore.ts` `aiBusy` + `useAIChat.ts` `watch(status)` 同步 |

---

## 测试增量

agent unit：525（Phase 11.5 起点） → 539（Phase 11.6 主体） → 558（第一波 dogfood 收尾） → 580+（第二波 dogfood follow-up）

新增 / 改写测试（精选）：

**第一波**：
- `test/validate-frontmatter.test.ts`（新建）+9：beitou-image-content 缺 heading / 齐 / 空字符串视为缺；cover 缺 mainTitle；section-title 多必填；未知 layout/template prefix 跳过
- `test/tools-local.test.ts`：+5（create_slide / update_slide 校验通路）+ 2（edit_slides 长度上限）+ 1（read_template enum 白名单）
- `test/prompts-ab-contract.test.ts`：决策树短语断言更新（'仅替换 frontmatter' → 'switch_template'）
- `test/tools-generate-slide-image.test.ts`：fallbackSummary 改必填后断言更新
- `test/rewriteForTemplate.test.ts`：imageSrc 保留约束断言（user prompt 含「imageSrc 字段必须逐字保留」）
- `test/image-gen-job.test.ts`：并发限流测试
- `creator/test/TemplatePickerModal.spec.ts`：警告条文案改成新版断言

**第二波**：
- `test/server-log.test.ts`（新建）+5：基础落盘 / 多次 append / 自动 mkdir / fs 失败容错 / NODE_ENV=test 跳过
- `test/image-gen-job.test.ts`：补 image-gen 全链路 8 个事件断言（running / gen-success / done / cancelled / gen-failed / fallback-rewrote / fallback-failed / queue-timeout）
- `test/prompts-ab-contract.test.ts`：决策树「create_slide / update_slide / write_slides 三种入口都要调生图」断言
- `test/tools-write-slides.test.ts`（扩展）+2：starter 占位放行 / 真用户内容仍拒
- `test/routes-slidev-restart.test.ts`（新建）+3：dev mode 503 / production execFile 调 pm2 / 失败兜底 server-log
- `creator/test/useAIChat.test.ts`（扩展）+2：session-end 后 slideStore.refresh 调用断言 / aiBusy watch 同步 status

---

## 不做什么（范围围栏）

- ❌ **切模板时按新模板色板重新生图**：用户已选 v1.5 方案（切模板对话框加 checkbox），但工程量中等（~150-200 行 + worker 改造），单独 commit 推进，**不在本 plan 范围**。本 plan v1 仅做 imageSrc 透传 + 文案告知"图保留旧色板"。
- ❌ **rewriteForTemplate 改成完全 deterministic**：仍保留 LLM fallback 路径（chart.js / 原创组件 / 模板对不兼容情形）。Why：deterministic 路径 plan 17 已设计且实现，本 plan 不动。
- ❌ **OpenAI image edit API 探索（"只改配色不改构图"）**：技术约束分析过——image LLM 不擅长精细局部修改，不在本 plan 范围。

---

## 踩坑与解决

详见 [plan 21 「踩坑与解决」段](21-phase11.6-image-first.md#踩坑与解决) 坑 3-6（dogfood 期间发现的 4 个真坑）。

新增（本 plan 期）：

### 坑 7：Edit 工具处理 TypeScript 模板字符串内 backtick 转义

- **症状**：用 Edit 工具改 buildSystemPrompt.ts 的 DECISION_TREE_SECTION_OFF 常量（template literal 内含 `\`layout:\`` 转义反引号），匹配字符串失败 + sed 替换出 syntax error
- **根因**：源文件里反引号是 `\\\`` 字面双字节序列（backslash + backtick），Edit old_string 传 `\`` 单字节匹配失败；sed 用 `\\\`` 反义又把行尾闭合的反引号保留进新行末尾
- **修复**：直接传**字面反引号**到 Edit old_string（既不转义也不双反斜杠），Edit 工具能正确匹配；调试时先 xxd 看 hex 确认源文件实际字节
- **防再犯**：改 TypeScript template literal 内含转义字符的字符串时，先 hex 看一下源文件实际字节序列再决定 Edit / sed 怎么写。**未提炼到 CLAUDE.md**（一次性认知偏差）

### 坑 8：合并 manifest required 字段时漏改 description

- **症状**：把 image-content required 从 [imageSrc] 改 [heading] 后，contract 测试 pass，但 dogfood 仍偶发漏 heading
- **根因**：manifest properties.heading.description 仍写「页标题(可选...)」，跟 required 矛盾。LLM 看 description 优于看 required 数组（自然语言更容易吸收），仍按"可选"理解
- **修复**：description 同步改为「(必填,渲染在顶部 header bar;缺失会让 header 留白)」
- **防再犯**：改 manifest required 时**同步检查** properties[字段].description 文案，确保两边一致。**未提炼到 CLAUDE.md**（manifest schema 改动是常规工作，非工具链坑）

### 坑 9：dev server stdout 不持久化,dogfood 失败事后无从排查

- **症状**:用户报「图没出来」/「LLM 不调生图了」/「第 6 页空白」,但 dev terminal 已翻飞,console.log 全丢,根因抓瞎
- **根因**:agent dev server 用 `tsx watch` 跑,stdout 仅留在终端;关掉终端 / 翻屏过头就没。重要业务事件(image-gen / template-switch / LLM 调用结果等)只 console.log 不落盘
- **修复**:新建 `logServerEvent({category, event, ...任意业务字段})` 落盘到 `<logsDir>/server-YYYY-MM-DD.jsonl`,image-gen 全链路接入 8 个事件;CLAUDE.md 加「后端日志规范」章节,定义必须落盘 vs 不必落盘场景 + 调用约定 + 事后排查 grep / jq 命令示例
- **防再犯**:**已提炼到 CLAUDE.md「后端日志规范」章节**。日后任何后端关键事件(异步 worker 状态转移 / 外部 API 调用结果 / 用户主动操作的 audit-worthy 副作用)**必须** logServerEvent 落盘,纯 console.log 不够

### 坑 10：vitest 测试 fixture 数据写到生产 logs/ 干扰真 dogfood 排查

- **症状**:加完 logServerEvent 后,定位 LLM 不调生图 regression 时 grep `logs/server-*.jsonl` 看到大量 `"jobId":"asset-uuid-001"` / `"errorMsg":"OpenAI 502"` 假数据,跟用户真 dogfood 日志混在一起,差点被误导
- **根因**:`logServerEvent` 不区分 NODE_ENV,vitest 跑 image-gen-job.test 时 fixture 数据(模拟 502 / 模拟 cancel 等)也老老实实写进生产 logs/ 目录
- **修复**:`logServerEvent` 加保护——`NODE_ENV=test && !BIG_PPT_LOGS_DIR` 时跳过写入;想验证落盘行为的 server-log 单测自己 setEnv 给 BIG_PPT_LOGS_DIR override 到 tmpdir
- **防再犯**:**已提炼到 CLAUDE.md「后端日志规范」章节**(测试隔离要求)。日后任何 file IO 副作用都要考虑「测试是否会污染生产数据目录」

### 坑 11：LLM 走「局部修改」路径完全不调 generate_slide_image (regression)

- **症状**:dogfood 报「同样提示词不调生图工具了」,日志看 LLM 走 update_slide / create_slide 一页一页加 *-image-content layout 但**完全没调** generate_slide_image
- **根因**:Phase 11.6 ON 决策树**只描述了** write_slides 路径(「write_slides 输出整 deck 后串联调 N 个 generate_slide_image」),**没覆盖** create_slide / update_slide 两条等价入口。LLM 通过这俩入口写 *-image-content layout 时 prompt 里没说「也要调生图」,自然不调
- **修复**:决策树「工具调用契约」段重写为「**只要你创建/改写一个 *-image-content 页**(无论 write_slides / create_slide / update_slide),接下来必须给该页调一次 generate_slide_image」+ A/B/C 三种入口的具体调用序列示例;末尾强调「每输出一个 *-image-content layout 字段都必须配一次 generate_slide_image,**没有例外**」
- **防再犯**:写工具调用契约时**枚举所有进入点**,不要假设「主流路径覆盖了就够」。LLM 不会自己推广。**未提炼到 CLAUDE.md**(prompt 工程一次性认知偏差)

### 坑 12：第一次生成不走 write_slides 整 deck 路径(starter 占位骨架被当成"用户内容")

- **症状**:dogfood 报「第一次生成不是整体生成,一上来就单张」+「主循环没明确结束就跳出」(turns=20 max_iterations 截断)
- **根因**:deck 创建时填入了模板 `starter.md` 演示骨架(cover + toc + section + content + back-cover 5 页带 `请填写标题` / `请填写副标题` 占位文字)。LLM `read_slides` 看到 ≥1 页非空 → 走「局部修改」路径用 update_slide / create_slide 一页一页改,而不是 write_slides 整体生成。N 页 deck 单页路径吃 2N turn(`create_slide` → 下一 turn `generate_slide_image`),很快撞 MAX_ITERATIONS=20 上限
- **修复**:`writeSlides` 加 `isDefaultStarterContent` 检测(`YYYY/MM/DD` + `请填写标题` + `请填写副标题` 占位 marker ≥2 个同时存在视为 starter,放行整体覆盖;真用户内容仍拒);system prompt「工作方式」段引导:`read_slides` 看到占位 marker → 视为空 deck → 用 write_slides;`MAX_ITERATIONS` 20→200(给 50+ 页极长 deck 留余地)
- **防再犯**:任何「空 vs 非空」判定都要考虑系统填入的占位内容。**未提炼到 CLAUDE.md**(产品形态特定)

### 坑 13：Slidev / Vite long session 内 vite module cache 累积错位,iframe reload 清不了

- **症状**:dogfood 长 session(几十次 frontmatter HMR patch)后,某些页渲染成另一模板(layout 字面量明明是 beitou-* 但渲染出 jingyeda 蓝色 header + JYD logo),iframe 「刷新」按钮 (`slideStore.refresh()`) 也不管用
- **根因**:`slideStore.refresh()` 只触发**前端 iframe full reload**(改 src 强制 fetch HTML);Slidev dev server **进程内**的 vite module graph + HMR component cache 仍然错位。Slidev 启动时扫两套模板(beitou + jingyeda)注册到同一个 vite components registry,long session 内大量 HMR patch 累积错乱
- **修复**:**两层修法**——
  1. 轻症层(LLM session-end 自动 refresh iframe):session 结束时主动调 `slideStore.refresh()` 强同步前端 iframe 跟最终 slides.md(commit `e467e53`)
  2. 重症层(SlidePreview 「刷新」按钮改造为「重启 Slidev 进程」):后端 `POST /api/slidev-restart` 在生产 execFile pm2 restart,dev 模式 503 引导用户手动重启 dev;前端按钮在 LLM busy 时变橙色警示 + confirm 弹窗(commit `4b1bfdd`)
- **防再犯**:**已提炼到 CLAUDE.md「Slidev 反代 + HMR」段**(long session 大量 frontmatter 改动 vite module cache 错位 → 重启 Slidev 进程才能根治,iframe reload 不够)。长期根治走 Phase 10.5 (候选)自研 DeckRenderer Vue 组件取代 Slidev iframe

---

## 模板使用说明

本 plan 是 plan 21 的延伸记录，不是独立 phase。未来若有类似「主体 phase 落地后用户 dogfood 暴露的修补」需求，可参考本 plan 结构（按 commit 整理设计抉择 + 文件 + 测试）。
