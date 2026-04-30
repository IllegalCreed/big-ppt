# Phase 11.6 dogfood follow-up — 工具/prompt 翻新与并发限流

> **状态**：✅ 已关闭（2026-04-30）
> **前置阶段**：[plan 21-phase11.6-image-first.md](21-phase11.6-image-first.md) ✅
> **路线图**：[roadmap.md Phase 11.6](../requirements/roadmap.md#phase-116图片优先模式image-gen-on-时所有内容页直走-image-content)
> **commit 范围**：`19c6278` ~ `bebcdc4`（共 8 个 commit）

**Goal**：Phase 11.6 主体（plan 21）落地后，用户实际跑 22 页 deck 暴露多个真实问题（并发风格漂移、第 6/7 页 frontmatter 空白、跨模板污染、撞 OpenAI RPS 限制等），需要一系列工具 / prompt / manifest 修补。本文档把 dogfood 期间的 8 个 commit 整理成单独 plan，详化每项的设计抉择 / 文件改动 / 测试增量。

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

---

## 测试增量

agent unit：525（Phase 11.5 起点） → 539（Phase 11.6 主体） → 558（dogfood 收尾） → ~566+（含 plan 23 工具校验测试）

新增 / 改写测试（精选）：

- `test/validate-frontmatter.test.ts`（新建）+9：beitou-image-content 缺 heading / 齐 / 空字符串视为缺；cover 缺 mainTitle；section-title 多必填；未知 layout/template prefix 跳过
- `test/tools-local.test.ts`：+5（create_slide / update_slide 校验通路）+ 2（edit_slides 长度上限）+ 1（read_template enum 白名单）
- `test/prompts-ab-contract.test.ts`：决策树短语断言更新（'仅替换 frontmatter' → 'switch_template'）
- `test/tools-generate-slide-image.test.ts`：fallbackSummary 改必填后断言更新
- `test/rewriteForTemplate.test.ts`：imageSrc 保留约束断言（user prompt 含「imageSrc 字段必须逐字保留」）
- `test/image-gen-job.test.ts`：并发限流测试
- `creator/test/TemplatePickerModal.spec.ts`：警告条文案改成新版断言

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

---

## 模板使用说明

本 plan 是 plan 21 的延伸记录，不是独立 phase。未来若有类似「主体 phase 落地后用户 dogfood 暴露的修补」需求，可参考本 plan 结构（按 commit 整理设计抉择 + 文件 + 测试）。
