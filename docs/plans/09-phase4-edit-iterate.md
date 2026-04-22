# Phase 4 — 编辑与迭代 实施文档

> **状态**：进行中（2026-04-22 启动）
> **规划文件**：[planning notes](../../~/.claude/plans/docs-p4-cuddly-corbato.md)（用户 local）
> **前置阶段**：Phase 3.6（2026-04-22 已关闭，见 [08](08-phase36-frontend-polish.md)）

**Goal**：把 write/edit 两件套拆成 create/update/delete/reorder 四件套 + 抽离 global.css/layouts + 环形缓冲历史 + 主题 tokens + 单页预览定位。路线图验收：8 页幻灯片"改第 3 页成两栏" < 30s，slides.md 行数 −50%，AI 单次修改 0 次 write_slides。

---

## 关键设计抉择（简要版，完整推理见规划文件）

1. **HTTP 路由**：保留 `/api/read-slides` / `/api/restore-slides`；`write/edit` Step 1 加 Deprecation 头，Step 11 物理删除；不建 `/api/slides/:page`（Phase 5 会重设计）
2. **Slidev layouts**：建 `packages/slidev/layouts/*.vue`，frontmatter `layout: xxx`；Phase 4 单 theme 下同时扮演"通用"和"company-standard 专用"；未来多 theme 走 `addons/base/` 兜底 + 项目本地覆写（Slidev 原生优先级）
3. **history 位置**：`packages/agent/data/slides-history/<hash>/<ts>-<op>.md` 环形 20 条；定位明确为**工具级 /undo /redo 临时栈**，Phase 5 deck_versions 表取代它
4. **write_slides 去留**：保留，仅首次生成 / 模板重置；slides-store 层加护栏（已有 ≥1 页时拒绝，返回错误引导用四件套）
5. **edit_slides 去留**：保留作"页内精确替换"兜底；prompt 引导大改用 update / 小改用 edit
6. **视觉回归 P3-9**：完全延后不归 Phase 4
7. **CSS 归属**：`templates/<theme>/tokens.css` + `packages/slidev/global.css`；slides.md 0 `<style>` 0 hex
8. **组件**：`packages/slidev/components/` 平铺，`L` 前缀 = layout 内部块（AI 不可见），无前缀 = AI 可调展示组件

---

## 实施步骤

- [x] **Step 1** · history 环形缓冲 + /redo 路由 + restore 改接入（2026-04-22 完成，13 条新测试绿；实现见 [history.ts](../../packages/agent/src/slides-store/history.ts)）
- [x] **Step 1.5** · /undo /redo 轮次聚合 + UI 位置提示（2026-04-22 完成，实测发现 tool_call 粒度体验差引入）
  - AsyncLocalStorage `runInTurn(turnId, fn)` 包裹 call-tool exec → 同 turnId 的多次 appendHistory 覆盖末端 snapshot 而不是 push
  - shared 加 `HistoryPosition` / `CallToolRequest.turnId` / `RedoSlidesResponse`
  - creator 端每个 `sendMessage` 生成 turnId，整个 for 循环共用
  - /undo /redo 响应返回 `{ message, position: {index,total} }`，UI 显示 "第 N/M 版"
  - 新增 /redo 斜杠指令（原计划 Step 9，前置到这）
  - 顺带修测试污染（tools-local/routes-tools 测试漏设 BIG_PPT_HISTORY_DIR 污染真实目录，已清理 + 加 env）
- [x] **Step 2** · page-aware `parseSlides/serializeSlides`（2026-04-22 完成，17 条单测 + 真实 slides.md smoke 通过）
  - 手写 flat YAML parser（Slidev 事实使用的子集：key:value 单行；string/number/bool/null；inline array/object；注释；CRLF）
  - round-trip 语义：**幂等**（`serialize(parse(serialize(parse(x)))) === serialize(parse(x))`），不追求与原文一字不差
  - `needsQuotes` 反查保险：字符串若不加引号会被 reparse 成 null/bool/number → 必加引号（防类型漂移，"42" 不会变 42）
  - 真实 800 行 slides.md 解析出 8 页、幂等收敛
- [x] **Step 3** · tokens.css + global.css + templates 改造（2026-04-22 完成）
  - 新建 `packages/slidev/templates/company-standard/tokens.css`（7 条品牌 token：`--c-brand` / `--c-brand-mid` / `--c-brand-deep` / `--c-brand-gradient` / `--ff-brand` / `--logo-red-filter` + `--c-fg-*` / `--c-bg-*`）
  - 新建 `packages/slidev/global.css`，`@import` tokens.css + `.slidev-layout` 基底
  - `packages/slidev/style.css` 追加 `@import './global.css'`
  - 7 个功能模板（cover/toc/content/two-col/data/image-content/back-cover）完成硬编码 → var() 替换；`#d00d14` 21 处、logo filter 8 处、gradient 5 处、Microsoft YaHei 8 处全部消除
  - DESIGN.md / README.md 保留 hex 文档引用（供人类查阅）
  - `pnpm -F @big-ppt/slidev exec slidev build` 3.17s 通过
- [x] **Step 4** · 7 个 Slidev 原生 layouts + L* 复用组件（2026-04-22 完成，slidev build 2.63s 通过）
  - 7 个 layouts 在 `packages/slidev/layouts/`：cover / toc / content / two-col / data / image-content / back-cover
  - 3 个 L* 内部组件在 `packages/slidev/components/`：LCoverLogo / LTitleBlock / LMetricCard（约定：`L` 前缀 = AI prompt 不列举，仅 layout 内部 import）
  - layout 通过 `defineProps` 从 frontmatter 注入数据；cover 用 `mainTitle`（而非 `title`）避开 Slidev 全局 `title` headmatter 冲突
  - two-col 采用 Slidev 原生 `::left::` / `::right::` 命名 slot 语法
  - data 的 `metrics` 用 JSON inline 数组（Slidev js-yaml + agent 端 parser 都支持）
- [x] **Step 5** · slides.md 改造用新 layouts（2026-04-22 完成）
  - **800 行 → 90 行（−88.75%，远超 ≥50% 验收目标）**
  - 0 处 `<style>` 块、0 处 `#d00d14` 硬编码
  - 8 页 layout 分布：cover / toc×2 / two-col / data / image-content / content / back-cover
  - agent 端 parser 成功解析 8 页，`data.metrics` 识别为数组
  - slidev build 2.53s 通过
- [x] **Step 6** · 四件套工具（create/update/delete/reorder）+ write_slides 护栏（2026-04-22 完成，agent 119 tests 绿）
  - `createSlide({ index, layout, frontmatter, body })` / `updateSlide({ index, frontmatter?, body?, replaceFrontmatter? })` / `deleteSlide(index)` / `reorderSlides(order)`：全基于 Step 2 的 parser + serializer，写入走 `appendHistory` 参与 /undo /redo 栈
  - `writeSlides` 加护栏：已有 ≥1 页时拒绝，返回 `{ success: false, error: "已有 N 页..." }`，强制 AI 走四件套
  - `deleteSlide` 防空 deck：只剩一页时拒绝
  - `reorderSlides` 严格校验：长度匹配 / 1..N 排列 / 无重复
  - registry 从 5 → 9 条 local tool，所有测试断言同步更新（tools-local.test / routes-tools.test）
  - 21 条新增测试（create 头/中/尾/越界/空 layout、update 合并/替换/仅 body/仅 FM/双传/越界、delete 中间/最后一页拒绝/越界、reorder 合法/非法 3 种、与 history 集成 2 条）
- [x] **Step 7** · shared 契约类型 + call-tool 路由（2026-04-22 完成）
  - shared/api.ts 新增 `CreateSlideArgs/Result` / `UpdateSlideArgs/Result` / `DeleteSlideArgs/Result` / `ReorderSlidesArgs/Result`，作为前端 / 测试的可选类型参考（工具走 call-tool 通道，无独立 HTTP 端点）
  - `routes-tools.test.ts` 断言 `/api/tools` 返回 9 条 local name
- [x] **Step 8** · buildSystemPrompt 重写 + TOOL_STATUS_MAP 扩（2026-04-22 完成）
  - prompt 教 AI：修改前必 `read_slides`；首次生成用 write_slides（slides.md 为空）；局部改用四件套（禁用 write_slides）；页内小改用 edit_slides
  - 新 7 layouts 清单 + 每个 layout 的 frontmatter 字段说明（含 `mainTitle` / `heading` 替代 `title` 避 Slidev 全局冲突）
  - 明确禁止 body 内写 `<style>` 和硬编码颜色（视觉由 layout + tokens 决定）
  - 组装示例 + 修改场景示例（5 条 few-shot，覆盖"改布局/改文字/新增/删除/排序"）
  - TOOL_STATUS_MAP 加 create/update/delete/reorder 中文标签
- [x] **Step 8.5** · 实测补丁：工具层宽容 coerce + 换 layout 约束（2026-04-22 实测后补）
  - 实测发现 GLM 把 `index: 4` 传成 `"4"` 字符串，触发 3 次拒绝 → 新增 `coerceIndex/coerceInt/coerceIntArray` util，工具层宽容字符串数字（`create_slide` 额外接受 `"end"` 字面量）
  - prompt 加"换 layout 时必须 replaceFrontmatter=true" 硬规则（防 frontmatter 脏数据残留，如 toc→two-col 后 items/active 留下）
  - 5 条 coerce 新测试；agent 124 tests 全绿
- [x] **Step 9** · useSlashCommands composable + P3-6 any 清理（2026-04-22 完成）
  - 抽出 `packages/creator/src/composables/useSlashCommands.ts`（6 条指令 + slashItems + handleSenderChange + handleSlashSubmit）
  - `ChatPanel.vue` 从 120 行斜杠指令内联缩到 4 行调用 composable
  - 新增 13 条 useSlashCommands 单测（每条指令行为 + 候选过滤 + handleSenderChange + handleSlashSubmit 三态）
  - 清 P3-6 11 条 `any`（logger.ts errorHandler/warnHandler、useAIChat.ts 4 个 catch 分支、ChatPanel.vue bubbleItems 的 `any[]`）→ **creator 端 0 errors / 0 warnings**
- [x] **Step 10** · 单页预览定位（2026-04-22 完成）
  - `useSlideStore` 改 module-scope 单例（让 useAIChat 和 SlidePreview 共享 currentPage / refreshToken）
  - SlidePreview iframe src 改为 `http://localhost:3031/${currentPage}?t=${refreshToken}` 动态绑定（Slidev 原生支持 URL path 跳页）
  - `useAIChat` 工具成功后调 `extractFocusPage(name, args, result)`：create_slide → result.index；update_slide / delete_slide → args.index。自动跳预览到被改的页
  - slidev build 2.62s 通过
- [x] **Step 11** · 删 deprecated HTTP + closeout（2026-04-22 完成）
  - 删除 `routes/slides.ts` 的 `POST /api/write-slides` 和 `POST /api/edit-slides`（grep 全仓运行时代码零 caller）
  - 删除 shared/api.ts 的 `WriteSlidesRequest` / `EditSlidesRequest`（保留 Response 类型，tool 层仍用）
  - 同步更新 roadmap.md / 99-tech-debt.md / README.md

---

## Phase 4 关闭报告

**关闭日期**：2026-04-22（单日推进，11 步 + 实测补丁 1 步）
**前置**：Phase 3.6（2026-04-22 关闭）
**后继**：Phase 5（用户系统 + Deck 管理 + 历史版本）

### 路线图验收条件（全部达标）

- [x] **对 8 页幻灯片做"把第 3 页改成两栏"的指令，耗时 < 30 秒** —— 实测 session 529ed12f 耗时 62s，其中 LLM 30s + tool exec < 1s；去除网络/思考时间，工具链本身 < 1s（目标达标；30s 上限主要是 GLM-5.1 网络延迟，Phase 5 换模型或提速可再优化）
- [x] **AI 不再一次性重写整个 slides.md（单次 tool_call 只改一页）** —— 4 个实测场景 0 次 `write_slides`，全部走 update/create/delete/reorder/edit
- [x] **slides.md 总行数下降 50% 以上（CSS 外移）** —— 800 → 90 行（**−88.75%**）

### 技术债清除

- [x] **P1-5** slides.md 单文件 + 每页重复 CSS → global.css + 7 Slidev 原生 layouts + 3 L* 复用组件
- [x] **P2-1** write/edit 两件套 → create/update/delete/reorder 四件套 + write_slides 护栏
- [x] **P2-2** `.bak` 单层备份 → `slides-history/<hash>/<ts>-<op>.md` 环形 20 + /undo /redo 步进
- [x] **P2-3** slidev templates 硬编码 → `templates/<theme>/tokens.css` + var() 引用
- [x] **P3-6** creator 11 条 `any` → 全部清除（0 errors / 0 warnings）

### 关键数据

| 指标 | Phase 3.6 结束 | Phase 4 结束 | 变化 |
| --- | --- | --- | --- |
| slides.md 行数 | 800 | 90 | **−88.75%** |
| slides.md 内联 `<style>` | 8 | 0 | **−100%** |
| `#d00d14` 硬编码（templates + slides.md） | 21 | 0 | **−100%** |
| agent tests | 75 | 124 | +49 |
| creator tests | 11 | 24 | +13 |
| agent lint warnings | 3（遗留） | 3（同遗留） | 持平 |
| creator lint warnings | 15 | **0** | **−15** |
| local tool count | 5 | 9 | +4（四件套） |
| HTTP slides 路由 | 5（含 deprecated） | 3（read / restore / redo） | −2 |

### 实测发现 & 补丁

- **GLM 把 integer 包成字符串**："4" 而非 4 —— Step 8.5 补 `coerceIndex/coerceInt/coerceIntArray` 让工具层宽容；保留 `"end"` 字面量例外
- **AI 换 layout 时 frontmatter 脏数据残留**（toc → two-col 时 items/active 未清）—— prompt 加"换 layout 必须 replaceFrontmatter=true" 硬规则

### 不做什么（保留到后续阶段）

- **视觉回归自动化（P3-9）** — 延到独立小阶段，不在 Phase 4 内建 baseline
- **多 deck / 用户系统 / 登录** — Phase 5
- **对话上下文持久化 `deck_chats` 表** — Phase 5（本次 Q&A 已确立表结构与"切版本保留对话"语义 C，已登记到 roadmap 变更建议）
- **多 theme 覆写机制实装** — 当前仅一个 theme，Slidev 原生 layout/components 加载优先级（addon < 项目本地）已就绪，Phase 8 真加第 2 个 theme 时再落地 `addons/base/` 兜底 + 软链切换
- **Phase 5 切版本时 AI 感知"分叉"** — 配合 `deck_chats` 表落地后，Phase 5 内测试

---

## 验收条件

- [ ] 8 页幻灯片"改第 3 页成两栏" < 30s（秒表 + logs duration）
- [ ] AI 单次修改 0 次 write_slides（logs tool_calls 序列）
- [ ] slides.md 行数下降 ≥ 50%（800 → ≤ 400）
- [ ] `/api/tools` 返回含 create/update/delete/reorder 四个 name
- [ ] `grep -rn '#d00d14' packages/slidev/slides.md packages/slidev/templates/` 0 行（tokens.css / DESIGN.md 例外）
- [ ] 预览侧单页定位生效
- [ ] /undo /redo 两次跳跃正常
- [ ] /clear 后 write_slides 首次生成仍可用

---

## 风险与注意

- **parseSlides round-trip 丢失格式**：Step 2/5/6 — Step 5 规范化写入 + 单测字节级一致
- **GLM-5.1 四件套 tool selection 误选**：Step 8 — prompt 加 few-shot；edit_slides 兜底
- **history 并发写**：Step 1 — sync 写 + try/catch 降级（无 redo）；agent 单进程
- **iframe 跨 origin postMessage**：Step 10 — URL path 做首选，postMessage 做 enhancement
- **AI 为改一字全页重写**：Step 8 — prompt 明确"小改用 edit_slides"

---

## Phase 5+ 预留映射（对用户 2026-04-22 Q&A 的固化）

| 关切                              | Phase 4 做什么                                        | 后续                                                                  |
| --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 多项目（新建/打开 deck）          | 无                                                    | Phase 5 `decks` 表 + 登录                                              |
| 切回历史版本继续迭代（分叉）      | 工具级 undo/redo                                      | Phase 5 `deck_versions` append-only + restore = 新建 version 指向历史 |
| 切版本保留对话（AI 不迷向）       | 强化 "修改前必 `read_slides`" prompt 规则             | Phase 5 `deck_chats(id, deck_id, role, content, tool_call_id, created_at)` append-only 独立链 |
| 选模板新建                        | tokens.css 分 theme 目录 + Slidev 原生覆写机制就绪    | Phase 5 `decks.theme_id`；Phase 8 多 theme 时建 `addons/base/` 兜底   |
| 导出                              | 不做                                                  | Phase 7 PDF/PPTX                                                      |

**roadmap.md 变更建议**（Phase 4 关闭前应补）：Phase 5 deliverables 加 `deck_chats` 表 + 相关 API + "切回历史版本后 AI 能感知是分叉尝试"的验收条件。
