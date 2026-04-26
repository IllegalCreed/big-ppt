# Phase 7.5 — 模板分层重构（公共组件库 POC）

> **状态**：待启动（2026-04-26 设计收敛）
> **前置阶段**：Phase 7（plan 13 / 14 / 15）
> **后续阶段**：Phase 8 依赖全量升级
> **路线图**：roadmap.md Phase 7.5
> **执行子技能**：`superpowers:subagent-driven-development`

## Context

当前两套模板（`beitou-standard` / `jingyeda-standard`）每套都重抄了一份内容部件——两栏、网格、图表、指标卡 layouts 都是各做各的，token 也是各 namespace（`--bt-*` / `--jyd-*`）。这套写法现在是 14 个 Slidev layout 文件 + 4 个模板私有组件，每加一套模板边际成本 ×N，**一旦 Phase 10 上线后用户数据进来再重构，成本暴涨**。

Phase 7.5 趁现在只 2 套模板的窗口，把视觉表达抽两层（Layer 2 内分三类）：

- **Layer 1：Slidev layouts（模板独有，每模板 5 个）**——`cover` / `back-cover` / `toc` / `section-title` / `content`，**唯一**能填入 frontmatter `layout:` 字段；承载该模板的独有装饰（如 jingyeda 的 LJydHeader 蓝条 / beitou 的红色 heading 容器）

- **Layer 2：公共 Vue 组件（跨模板共用）**——写在 `content` layer-1 layout 的 slot 内，**配色读 `--ld-*` token 自动适配模板**：
  - **2A 栅格类**（决定整页区域分布，提供 N 个 named slots，首版 8 个）
  - **2B 装饰类**（NEW，提供"美化几何骨架 + N 个 slots"，配色由 token 自适应；首版 2 个种子）
  - **2C 内容块类**（决定单个区域内的渲染，首版 6 个）

所有公共组件视觉跨模板共用，**仅靠 token 切换配色**——比如花瓣装饰组件 `<PetalFour>` 在 beitou 是红色花瓣，在 jingyeda 是蓝绿花瓣，**几何形状完全一致**。模板私有 `--bt-*` / `--jyd-*` 命名空间仅供 Layer 1 内部使用。

**核心产品断言**：用户切模板时——

- frontmatter `layout:` 字段从 `beitou-X` 改 `jingyeda-X`（且仅在两模板都有的 layer-1 之间映射）
- body 里所有公共组件标签、props、slot 内容**字节级不变**
- 模板私有装饰（layer-1 + token 配色）随模板自动替换

验证由用户人工双 deck 比对（不写 byte-level E2E）。

---

## 概念辨析（关键，写在最显眼防混淆）

| 概念                         | 是什么                                                                  | 怎么用                               | 数量                  |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------ | --------------------- |
| **Slidev layout**            | 真正的 Slidev layout，模板私有 `.vue`                                   | frontmatter `layout: beitou-cover`   | 每模板 5 个           |
| **栅格类组件**（layer 2A）   | 普通 Vue 组件，名字按"分布形态"命名（不带 Layout 后缀，目录已表明语义） | body 里 `<TwoCol>...</TwoCol>`       | 全局 8 个             |
| **装饰类组件**（layer 2B）   | 普通 Vue 组件，含美化几何骨架 SVG/CSS                                   | body 里 `<PetalFour>...</PetalFour>` | 全局 2 个种子（首版） |
| **内容块类组件**（layer 2C） | 普通 Vue 组件                                                           | body 里 `<MetricCard ... />`         | 全局 6 个             |

> 千万不要把"栅格类组件"叫成 "common layout"——它**不是** Slidev layout。

正确写法示例（演示 8 个栅格组件中的 ThreeCol + 1 个装饰组件 PetalFour 嵌套）：

<!-- prettier-ignore -->
```vue
---
layout: beitou-content    ← 唯一的 frontmatter layout 字段，5 选 1
heading: 工作内容
---

<ThreeCol>
  <template #left>
    <MetricCard value="89" unit="%" label="设计" />
  </template>
  <template #center>
    <PetalFour>
      <template #slot1>1</template>
      <template #slot2>2</template>
      <template #slot3>3</template>
      <template #slot4>4</template>
    </PetalFour>
  </template>
  <template #right>
    - 进行新版门户开发工作
    - 对接集团用户系统
  </template>
</ThreeCol>
```

---

## 关键设计抉择（2026-04-26 与用户对齐）

### 1. 公共层全是 Vue 组件，分三类

❌ 否定方案：把"two-col"做成 Slidev layout。
✅ 现行方案：only layer-1（每模板 5 个）是 Slidev layout；公共层全部 Vue 组件，分栅格 / 装饰 / 内容块三类，写在 `content` 的 slot 内。

**Why**：

- frontmatter `layout:` 字段不能跨模板共用 layout 文件，做成 Vue 组件可以由 `auto-import` 跨模板触达
- 切模板心智简单：`layout:` 仅在 5 选 1 中映射

### 2. 装饰几何全公共，仅靠 token 切配色（关键设计）

❌ 否定方案：花瓣 SVG 是 beitou 私有装饰，jingyeda 没花瓣。
✅ 现行方案：花瓣 SVG / 圆环 / 流程箭头等装饰几何**都是公共组件**，颜色读 `--ld-color-brand-primary` 等 token，**模板切换时形状不变、配色自动换**。

**Why**：用户明确反对"装饰强绑定模板"的思路——花瓣造型在 jingyeda 用蓝绿色一样好看；几何形状是中性资产，配色才是模板个性。这让公共组件库可以从结构层一直延伸到装饰层，不留"模板私有美化"的盲区。

模板生态期（Phase 16+）才有"模板可以 override 公共组件"的机制；7.5 阶段先建立"全公共 + token 配色"的基线规范。

### 3. AI 自由发挥 + 决策树引导

✅ "**必须 / 优先 / 自由**"三档决策引导：

| 场景                                | AI 该怎么做                                                         |
| ----------------------------------- | ------------------------------------------------------------------- |
| 整页要并列 / 主从 / 网格分块        | **必须**用栅格类组件包整 body（不在 content 默认 slot 用 div 硬拆） |
| 4 小节方阵 / 阶段流程等需要美化骨架 | **优先**用装饰类组件（`<PetalFour>` / `<ProcessFlow>`）             |
| 数字 + 单位 + 标签标准结构          | **优先** `<MetricCard>`                                             |
| 图表                                | **必须** `<BarChart>` / `<LineChart>`                               |
| 引文 / 关键摘要                     | **优先** `<Quote>` / `<Callout>`                                    |
| 段落自由叙述 / 简单列表             | **自由 markdown**，不硬塞组件                                       |

### 4. content layer-1 layout 保留模板装饰，不极简也不 rename

- ✅ 不 rename `beitou-content` → 保持原名（frontmatter 短）；`jingyeda-content` 同
- ✅ 保留 layer-1 装饰（jingyeda 的 LJydHeader 蓝条、beitou 红色 heading 容器仍在）
- 内部增强为"装饰容器 + heading 字段（如有）+ 默认 slot（公共组件 / 自由 md 自由占位）"

### 5. 切模板加 deterministic 路径（关键，影响产品断言达成）

切模板任务（`switch-template-job`）增加扫描判定：

- 如果存量 deck 的 `deck_versions.content` **每页都仅用 layer-1 layout + 公共组件 + 自由 md**（无遗留旧 layout / 无模板私有组件标签），走 **deterministic 替换路径**——仅扫 frontmatter `layout:` 行字符串前缀替换（`beitou-` → `jingyeda-`），**完全跳过 LLM**
- 否则 fallback 走原 Phase 7C 的 `rewriteForTemplate` LLM 重写路径

**Why**：用户选择此路径作为"字节级一致"产品断言的**真正机制**保障。prompt 约束 LLM 不重写公共层不可靠；deterministic 字符串替换是 100% 字节一致的工程保证。

实现：在 `template-switch-job` 的 `migrating` 阶段开头加 `analyzeDeckPurity` 检查；纯净则 deterministic，否则 LLM。

### 6. token 走全 4 类完整规范

✅ colors / fonts / shapes / shadows 4 类共 22 个 `--ld-*` token，部分 token 当前模板暂无消费方也先在 spec 占位。

### 7. section-title layout 每模板 NEW 一个

frontmatter `chapterNumber: number` + `chapterTitle: string`。视觉在 7.5D 实施期由用户拍板。

### 8. 不引入新 LLM 工具

现有工具数维持 10 不变，公共组件靠 markdown body 透传。

### 9. manifest 单一 `commonComponents` 字段

```ts
interface TemplateManifest {
  // ... 既有字段
  commonComponents?: string[]
}
```

平铺数组列全部组件名（首版两套模板都 opt-in 全 16 个：8 栅格 + 2 装饰 + 6 内容块）。catalog 内每条带 `category: 'grid' | 'decoration' | 'block'`，prompt 拼装时按 category 分三 sub-section。

### 10. 遗留 deck 走脚本一次性迁移

`packages/agent/scripts/migrate-deprecated-layouts.ts` 一次性把存量 `*-data` / `*-two-col` / `*-image-content` layout 字段重写为 `*-content` + 公共组件。

### 11. 不做字节级自动化 E2E

用户人工双 deck 对比验证。

### 12. AI 自由度 5 档 + 切模板双轨降级（关键产品哲学）

✅ 给 AI 5 档"自由度连续谱"，让 AI 自己权衡每档的代价：

| 档  | AI 用什么                                                      | 切模板字节级一致             | 代价                         |
| --- | -------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| 1   | 自由 markdown 文字 / 列表                                      | ✅ 保                        | 无                           |
| 2   | 自由 markdown + 内联 HTML（颜色/字体须用 `var(--ld-*)` token） | ✅ 保（如用 token）          | inline style 易写死 hardcode |
| 3   | + 内嵌公共组件（预制 16 个）                                   | ✅ 保                        | 16 个外需求卡                |
| 4   | + 内嵌 chart.js / 第三方 lib 现写                              | ⚠️ 字面一致但配色易 hardcode | LLM 写易错 + 视觉不读 token  |
| 5   | `<script setup>` 完全原创 Vue 组件                             | ❌ 不保                      | 切模板视觉随机 + 安全风险    |

**双轨降级**：

- **pure 模式**（档 1-3）：`analyzeDeckPurity` 标 pure → 切模板走 **deterministic 字符串替换**（仅改 frontmatter `layout:` 前缀），跳 LLM
- **自由模式**（档 4-5）：标 not-pure → 切模板 **fallback LLM 重写**（让 AI 在新模板风格下重生成原创片段），视觉一致但字节不保

**Why**：用户明确"自由发挥不止 markdown，AI 应能内嵌 chart.js / 原创 Vue 也行"。不能为字节级一致**牺牲 AI 表达力**——但要让 AI **知情决策**：每升一档代价是什么，何时该升何时该收敛。系统通过 deterministic + LLM fallback 双轨吸收所有自由度等级。

**决策原则写入 prompt**：能用预制就用预制；公共组件不够 → 自由 markdown / 内联 HTML（用 token）；仍不够 → 升档 4-5（清楚代价前提下）。

**实现关键**：

- prompt "## 工作模式"段明告 5 档代价
- `analyzeDeckPurity` 输出 `{ pure: boolean, level: 1|2|3|4|5, reasons: [...] }`；扫描升级到识别 inline `style="color: #..."` hardcode、`new Chart(` chart.js 字面、`<script setup>` 等 not-pure 信号
- `template-switch-job` 在 UI 提示阶段告诉用户："本 deck 含 X 页自由档内容，切换后视觉可能调整，可 /undo 回滚"
- E2E smoke 覆盖三种 deck：纯档 1-3（deterministic）/ 含档 4（LLM fallback 仍能重写）/ 含档 5（LLM fallback 视觉调整可见）

### 13. Prompt 投放策略 = 全塞 system prompt（选项 A）

✅ 公共组件 catalog（16 个）+ 决策树**全部塞 system prompt**，每次 LLM 调用都带；不加新 tool 查 doc。

**Why**：

- **AI 行为稳**：国产 LLM（GLM / DeepSeek / Qwen）对主动调 tool 查 doc 积极性不如 Claude；硬塞 system prompt = AI 看就懂、不依赖记忆调用
- **Token 成本可承受**：layer-1 layout 段从 7 → 5 化简（**-300 token**）+ 公共组件三类 catalog（**+1300 token**），净 +1000 token；总 system prompt ~1500 → ~2500 token；GLM 上下文 128k 完全 OK
- **现有架构延续**：Phase 6 manifest-driven prompt 拼装已建立 (`buildSystemPrompt.ts`)，自然扩展
- **simplest first**：实现最简单，0 新工具

**未来扩展路径**：组件库扩到 25+ 时切**选项 C 分层**：

- system prompt 仅留"决策树 + 组件名 + 一句话职责"（精简版 ~400 token）
- 详细 props / 示例移到 `get_component_doc(name)` tool，AI 真正用某组件时按需查

**否定方案**：

- ❌ 加 list/get tool 让 AI 主动查 → 国产 LLM 行为不稳
- ❌ MCP 服务化 → 基础设施重；首版无收益
- ❌ 分层 hybrid → 实现较复杂；首版 16 个组件 token 还容得下，无早期分层动力

**实现关键**：`buildSystemPrompt.ts` 改造分两步串行：

1. 化简 layer-1 layouts 段（从 manifest.layouts 渲染 5 个 layout 时每个简短 2-3 行）
2. 新增 `renderCommonComponentsSection(manifest)` 拼"## 可用 Components"段（按 catalog 中 `category: 'grid' | 'decoration' | 'block'` 分三 sub-section）+ 决策树段

---

## ⚠️ Secrets 安全红线

沿用 CLAUDE.md：`.gitignore` 不动；本 Phase 无新环境变量；commit 前 `git status` 检查；禁用 `git add -A`。

---

## 文件结构变更对照表

### 新增

| 文件                                                                             | 职责                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/slidev/components/TOKENS.md`                                           | `--ld-*` 4 大类 token 规范文档                                                 |
| `packages/slidev/components/COMPONENTS.md`                                       | 公共组件目录（栅格 / 装饰 / 内容块 三 section）                                |
| `packages/slidev/components/grid/TwoCol.vue`                                     | 2A：左右 50/50                                                                 |
| `packages/slidev/components/grid/ThreeCol.vue`                                   | 2A：三列均分（左 / 中 / 右）                                                   |
| `packages/slidev/components/grid/OneLeftThreeRight.vue`                          | 2A：左主右从（左 1 主 + 右 3 列）                                              |
| `packages/slidev/components/grid/OneRightThreeLeft.vue`                          | 2A：右主左从（对称）                                                           |
| `packages/slidev/components/grid/OneTopThreeBottom.vue`                          | 2A：上主下从                                                                   |
| `packages/slidev/components/grid/TwoColumnsTwoRows.vue`                          | 2A：田字格 2×2                                                                 |
| `packages/slidev/components/grid/NineGrid.vue`                                   | 2A：九宫格 3×3                                                                 |
| `packages/slidev/components/grid/ImageText.vue`                                  | 2A：图文 45/55                                                                 |
| `packages/slidev/components/decoration/PetalFour.vue`                            | 2B：花瓣 4 区，slot1..slot4 中央对称排列；颜色读 `--ld-color-brand-primary`    |
| `packages/slidev/components/decoration/ProcessFlow.vue`                          | 2B：流程箭头，items prop 驱动节点（或 N 个 slot），节点间箭头读 token          |
| `packages/slidev/components/MetricCard.vue`                                      | 2C：单数字卡（value/unit/label）                                               |
| `packages/slidev/components/KVList.vue`                                          | 2C：键值对列表                                                                 |
| `packages/slidev/components/Quote.vue`                                           | 2C：引文                                                                       |
| `packages/slidev/components/Callout.vue`                                         | 2C：高亮信息块                                                                 |
| `packages/slidev/test/_setup/index.ts`                                           | mountWithTokens helper（注入 `--ld-*` 测试值）                                 |
| `packages/slidev/vitest.config.ts`                                               | jsdom + vue 插件                                                               |
| `packages/slidev/templates/beitou-standard/layouts/beitou-section-title.vue`     | NEW Layer 1                                                                    |
| `packages/slidev/templates/jingyeda-standard/layouts/jingyeda-section-title.vue` | NEW Layer 1                                                                    |
| `scripts/validate-template-tokens.ts`                                            | 校验 tokens.css 是否覆盖 `--ld-*` schema                                       |
| `packages/agent/scripts/migrate-deprecated-layouts.ts`                           | 存量 deck 一次性迁移                                                           |
| `packages/agent/src/prompts/commonComponentsCatalog.ts`                          | 静态 catalog（含 `category: 'grid'\|'decoration'\|'block'` 分组、props、示例） |
| `packages/agent/src/services/analyzeDeckPurity.ts`                               | NEW：扫 deck 内容判断是否 100% layer-1+公共组件+自由 md                        |

### 修改

| 文件                                                        | 改动摘要                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/shared/src/template-manifest.ts`                  | 加 `commonComponents?: string[]` + zod 校验                                                           |
| `packages/slidev/templates/beitou-standard/tokens.css`      | 增补 22 个 `--ld-*`                                                                                   |
| `packages/slidev/templates/jingyeda-standard/tokens.css`    | 同上                                                                                                  |
| 两套 manifest.json                                          | layouts 7→5；新增 `commonComponents`（16 个）；删 `*-data` / `*-two-col` / `*-image-content`          |
| 两套 starter.md                                             | 用 layer-1 + 公共组件                                                                                 |
| `packages/slidev/components/BarChart.vue` / `LineChart.vue` | token rename `--chart-primary-*` → `--ld-color-chart-primary-*`；fontFamily 读 `--ld-font-family-ui`  |
| 两套 `*-content.vue` layer-1 layout                         | 增强为 heading 容器 + 默认 slot（保留装饰）                                                           |
| `packages/agent/src/prompts/buildSystemPrompt.ts`           | 加 `renderCommonComponentsSection(manifest)`（按 category 分 grid/decoration/block 三小节）+ 决策树段 |
| `packages/agent/src/services/template-switch-job.ts`        | 加 deterministic 路径分支：`analyzeDeckPurity` → 纯净则字符串替换跳 LLM                               |
| `packages/agent/test/prompts-ab-contract.test.ts`           | 加断言：5 layer-1 + 3 sub-section 标题 + 16 组件段 + 决策树关键句                                     |
| `packages/slidev/global.css`                                | 默认 fallback 读 `--ld-*`                                                                             |
| `docs/requirements/roadmap.md`                              | Phase 7.5 状态 + 路线图变更记录                                                                       |

### 删除

| 文件                                                                   | 原因                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| 两套 `*-data.vue` / `*-two-col.vue` / `*-image-content.vue`（共 6 个） | 功能被 layer-1 `*-content` + 公共栅格 + 公共内容块替代 |
| `packages/slidev/components/LBeitouMetricCard.vue`                     | `<MetricCard>` 替代                                    |

`LBeitouCoverLogo` / `LBeitouTitleBlock` / `LJydHeader` 保留（layer-1 layout 内部装饰）。

---

## 阶段拆分（7 子步，每步独立 commit）

### Task 7.5A：token 规范定稿 + 校验脚本

**目标**：定义 `--ld-*` schema 的 4 大类 22 token；spec 文档 + 校验脚本；当前两套模板预期校验失败。

**交付物**：

- `TOKENS.md`（22 token，4 大类）：
  - colors（9）：brand-primary / brand-primary-deep / brand-accent / fg-primary / fg-muted / bg-page / bg-subtle / chart-primary-bg / chart-primary-border
  - fonts（7）：family-brand / family-ui / size-h1 / size-h2 / size-body / weight-bold / weight-regular
  - shapes（4）：radius-sm / radius-md / border-width-thin / border-width-thick
  - shadows（2）：shadow-sm / shadow-md
- `scripts/validate-template-tokens.ts`：解析 `tokens.css` 中 `--ld-*` 集合 + manifest commonComponents 字段值合法性
- `package.json` 加 `validate:tokens` script
- 单测 ≥ 4

**验证**：`pnpm validate:tokens packages/slidev/templates/beitou-standard` → FAIL（22 项缺失）；`pnpm test ...validate-template-tokens.test.ts` → 4 条全过

**风险**：jingyeda 仿宋字体在 chart 文字渲染糊 → `--ld-font-family-ui` 必为雅黑系，公共组件细文字一律读 ui 字体

**commit**：`feat(phase-7.5a): --ld-* token 规范 + 校验脚本（4 类 22 项）`

---

### Task 7.5B：两套模板按规范增补 tokens

**目标**：让 `validate-template-tokens` 对两套模板都通过；建立"`--ld-*` = 模板对外契约 / `--bt-*`、`--jyd-*` = 模板内部细节"的层次。

**交付物**：

- beitou tokens.css 增补 22 个 `--ld-*`：colors 引 `--bt-*`；fonts brand+ui 都设为 `--bt-ff-brand`；shapes / shadows 给保守默认
- jingyeda tokens.css 同样：`--ld-color-brand-accent: var(--jyd-brand-accent);` / `--ld-font-family-ui: var(--jyd-ff-ui);`
- 视觉手验：`pnpm dev` 起来肉眼对比两套模板 starter 无视觉变化

**验证**：两套 `validate-template-tokens` PASS；`pnpm test` 全量无回归

**commit**：`feat(phase-7.5b): 两套模板 tokens.css 按 --ld-* 规范增补`

---

### Task 7.5C-1：抽公共栅格组件（Layer 2A，8 个）

**目标**：建立 `packages/slidev/components/grid/` 下 8 个栅格组件；只读 `--ld-*`；提供 named slots。

**交付物**：

- `packages/slidev/vitest.config.ts` + `test/_setup/index.ts` 首次配置（复用 creator vitest.config 模式）
- 8 个栅格组件：

| 组件                  | slots                                    | props                                                                                                 |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `<TwoCol>`            | `#left` / `#right`                       | `leftTitle?` / `rightTitle?` / `divider?: 'on'\|'off'`                                                |
| `<ThreeCol>`          | `#left` / `#center` / `#right`           | `leftWidth?` / `centerWidth?` / `rightWidth?`（fr 单位，默认 1/1/1）                                  |
| `<OneLeftThreeRight>` | `#main` / `#item1` / `#item2` / `#item3` | `mainWidth?`（默认 0.5fr）                                                                            |
| `<OneRightThreeLeft>` | `#main` / `#item1..#item3`               | 同上对称                                                                                              |
| `<OneTopThreeBottom>` | `#main` / `#item1..#item3`               | 主在上，下方 3 等列                                                                                   |
| `<TwoColumnsTwoRows>` | `#slot1..#slot4`                         | 田字格 2×2                                                                                            |
| `<NineGrid>`          | `#slot1..#slot9`                         | 3×3                                                                                                   |
| `<ImageText>`         | `#text`                                  | `image: string` / `imageBorder?: 'thin'\|'thick'\|'none'` / `direction?: 'image-left'\|'image-right'` |

- 所有栅格组件分隔线 / 边框颜色读 `--ld-color-brand-primary`、宽度读 `--ld-border-width-*`、间距读 `--ld-radius-sm`
- COMPONENTS.md 起草"## 栅格类组件"section
- 单测 ≥ 16（每组件 ≥ 2 条：默认渲染 / slot 透出 / props 配置生效）

**验证**：`pnpm -F @big-ppt/slidev test` ≥ 16 全过；`pnpm test` 全量回归

**风险**：vitest vue 插件首次配置坑 → 复用 creator vitest.config + viteConfig mergeConfig 模式

**commit**：`feat(phase-7.5c-1): 公共栅格组件 8 个`

---

### Task 7.5C-2：抽公共装饰组件（Layer 2B，2 个种子）+ 装饰类规范

**目标**：建立装饰类组件机制；首版 2 个种子（`<PetalFour>` / `<ProcessFlow>`），证明"几何骨架公共 + 配色 token 自适应"机制可用。

**交付物**：

- `packages/slidev/components/decoration/PetalFour.vue`：
  - SVG 路径绘制 4 个花瓣（中央对称，2×2 布局），花瓣描边宽 `var(--ld-border-width-thick)`，描边色 `var(--ld-color-brand-primary)`
  - 4 个 slot（`#slot1..#slot4`）渲染在 4 个花瓣中央
  - slot 内默认放数字（`1`/`2`/`3`/`4`），AI 也可放短标签或单 metric
  - 字号 `var(--ld-font-size-h1)`，字色 `var(--ld-color-brand-primary)`
  - 视觉验证：默认 props 在 beitou 看是红色花瓣 + 红色数字；jingyeda 自动是蓝色花瓣 + 蓝色数字

- `packages/slidev/components/decoration/ProcessFlow.vue`：
  - props：`steps: Array<{ title: string; description?: string }>` 或 `:cols="N"` + 默认 slot 接 N 个 `<step>` 子组件
  - 横向布局：步骤节点 + 节点间箭头；箭头颜色 / 节点边框读 `--ld-color-brand-primary`
  - 节点内 slot 提供短标题 + 描述
  - 适合 3-5 步流程；超过 5 步推 `<Timeline>`（backlog）

- COMPONENTS.md "## 装饰类组件" section + **装饰类组件规范文档**：
  - 命名规则（数量后缀如 PetalFour、ProcessFlow 通常不带数字因为 prop 决定）
  - 必读 token 清单（`--ld-color-brand-primary`、`--ld-color-brand-primary-deep`、`--ld-border-width-*`、`--ld-color-fg-primary` 等）
  - 跨模板视觉验证 checklist（在 beitou / jingyeda 各跑一遍 starter，比对花瓣 / 流程箭头几何形状一致 + 颜色不同）
  - 未来扩展候选：`<CircleFour>` / `<HexThree>` / `<TimelineHorizontal>` / `<PyramidLevels>` / `<VennTwo>` / `<FlowCircular>` / `<RadialSix>` ……（按需加，每次走"提案 + 合并 PR"）

- 单测 ≥ 6：
  - PetalFour × 3：默认渲染（4 花瓣 SVG 节点存在）/ slot 内容透出 / 颜色随 token 变化（mountWithTokens 注入不同 brand-primary 测取色）
  - ProcessFlow × 3：steps prop / slot 子组件 / 箭头数 = steps - 1

**验证**：`pnpm -F @big-ppt/slidev test` 累计 ≥ 22；`pnpm dev` 在 beitou / jingyeda 各看一遍 PetalFour，几何形状一致 + 颜色不同

**风险**：

- SVG 几何在缩放下走形 → 用 `viewBox` + `preserveAspectRatio="xMidYMid meet"`，组件内强制方形容器
- ProcessFlow 在 cols < 3 时箭头位置错位 → 单测覆盖 cols=2 / cols=3 / cols=5 等边界

**commit**：`feat(phase-7.5c-2): 装饰类组件 2 个种子（PetalFour / ProcessFlow） + 规范文档`

---

### Task 7.5C-3：抽公共内容块组件（Layer 2C，6 个）+ chart token rename

**目标**：建立 6 个内容块组件 + 2 个 chart token rename；只读 `--ld-*`。

**交付物**：

- 6 个内容块组件：

| 组件           | props/slots                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `<MetricCard>` | `value: string\|number` / `unit?: string` / `label: string` / `variant?: 'fill'\|'subtle'\|'outline'` |
| `<KVList>`     | `items: Array<{ label, value }>` / `columns?: number`                                                 |
| `<Quote>`      | default slot + `author?` / `cite?`                                                                    |
| `<Callout>`    | default slot + `type?: 'info'\|'warning'\|'success'` / `title?`                                       |
| `<BarChart>`   | rename token：`--ld-color-chart-primary-bg/border`                                                    |
| `<LineChart>`  | 同上                                                                                                  |

- COMPONENTS.md "## 内容块类组件" section
- 旧组件清退：删 `LBeitouMetricCard.vue`（layout 引用方在 7.5D 一并清）
- 单测 ≥ 12：
  - MetricCard × 3（fill / subtle / outline）
  - KVList × 2
  - Quote × 1
  - Callout × 2
  - BarChart / LineChart × 2（读 ld-token / fallback）+ 字体 fontFamily 读 `--ld-font-family-ui` 单测

**验证**：`pnpm -F @big-ppt/slidev test` 累计 ≥ 34（C-1 16 + C-2 6 + C-3 12）；`pnpm test` 全量回归

**风险**：chart.js `Chart.defaults.font.family` 是模块级单例 → 改用 chart-level option `options.font.family`

**commit**：`feat(phase-7.5c-3): 内容块组件 6 个 + chart token rename`

---

### Task 7.5D：layer-1 layouts 收敛 5 + section-title NEW + AI prompt 重写

**目标**：每模板 layer-1 layout 数从 7 砍到 5；新增 section-title；prompt 拼装扩展含三类公共组件 + 决策树。

**交付物**：

- 每模板 5 个 layer-1 layout：
  - 保留 + 增强：`*-content.vue`（**不 rename**）→ heading 容器（保留 layer-1 装饰：jingyeda LJydHeader / beitou 红色 heading）+ 默认 slot
  - 保留：cover / back-cover / toc 不动
  - **新增**：`*-section-title.vue`（实施期由用户拍板视觉；frontmatter `chapterNumber` + `chapterTitle`）
  - **删除**：`*-data.vue` / `*-two-col.vue` / `*-image-content.vue`（共 6 个）

- `packages/agent/src/prompts/commonComponentsCatalog.ts`：静态对象数组，每条 = `{ name, category: 'grid'|'decoration'|'block', description, propsOrSlots, example }`，共 16 条（8 + 2 + 6）

- `packages/agent/src/prompts/buildSystemPrompt.ts` 加 `renderCommonComponentsSection(manifest)` 拼出：

  ```
  ## 可用 Layouts（必选 1 个，frontmatter `layout:` 字段）
  - beitou-cover / toc / section-title / content / back-cover

  ## 可用 Components（在 layout slot 内按需用）

  ### 栅格类（决定页内多区域分布；通常作 content 默认 slot 的根元素）
  - <TwoCol> / <ThreeCol> / <OneLeftThreeRight> / <OneRightThreeLeft> / <OneTopThreeBottom> / <TwoColumnsTwoRows> / <NineGrid> / <ImageText>

  ### 装饰类（提供美化几何骨架；颜色随模板 token 自动适配）
  - <PetalFour> 花瓣 4 区
  - <ProcessFlow> 流程箭头

  ### 内容块类（决定单个区域内的渲染）
  - <MetricCard> / <KVList> / <Quote> / <Callout>
  - <BarChart> / <LineChart>

  ## 工作模式（5 档自由度）

  你的工作分 5 档，每档代价不同；优先用低档（预制），实在不够再升档：

  - **档 1（首选）**：自由 markdown 文字 / 列表 / 段落 —— 切模板字节级一致
  - **档 2**：自由 markdown + 内联 HTML（`<div>` / `<span>`）—— 颜色 / 字体**必须**用 `var(--ld-color-brand-primary)` 等 token，不要 hardcode `#ff0000`
  - **档 3**：内嵌公共组件（栅格 8 + 装饰 2 + 内容块 6 共 16 个）+ 自由 markdown —— 切模板时由系统走 deterministic 字符串替换路径，字节级一致
  - **档 4**：内嵌 chart.js / 第三方 lib 现场写自定义图表 —— ⚠️ 切模板时该页系统会 LLM 重写尝试适配，视觉一致但字节不保
  - **档 5**：`<script setup>` 完全原创 Vue 组件 —— ⚠️ 切模板视觉可能错乱

  决策原则：能用预制就用预制；公共组件 16 个覆盖不到 → 自由 markdown / 内联 HTML（用 token）；仍不够 → 升档 4-5（清楚代价的前提下）。

  ## 选 Layout 与 Component 的决策树

  - frontmatter `layout:` 字段：每页必填，且只能从 5 个 Slidev layout 中选
  - 整页要并列 / 主从 / 网格分块 → 必须用栅格类组件包整 body（不要在 content 默认 slot 用 div 硬拆）
  - 4 小节方阵 / 阶段流程等需要美化骨架 → 优先用装饰类组件
  - 数字 + 单位 + 标签标准结构 → 优先 <MetricCard>
  - 图表 → 必须 <BarChart> / <LineChart>（如足够；超出能力再走档 4 chart.js 现写）
  - 引文 / 关键摘要 → 优先 <Quote> / <Callout>
  - 段落自由叙述 / 简单列表 → 自由 markdown，不硬塞组件
  - 切模板任务时（system 调用）：仅替换 frontmatter `layout:` 前缀，不要重写公共组件 props 或 slot 内容
  ```

- 两套 manifest 更新：layouts[] 重列 5 个；commonComponents 列全 16 个

- A/B contract test 重写（`packages/agent/test/prompts-ab-contract.test.ts`）≥ 18 条断言：
  - 5 layer-1 layout 段标题
  - 3 sub-section 标题（栅格 / 装饰 / 内容块）
  - 16 组件出现在对应 sub-section
  - 决策树关键短语 5 条（必须栅格 / 优先装饰 / 必须 chart / 优先 metric / 切模板不重写公共层）

- `packages/agent/src/services/analyzeDeckPurity.ts`（NEW）：
  - 输入 deck 全部 versions 的 content
  - 扫每页判定 5 档自由度等级：
    - **档 1**：仅自由 markdown 文字 / 列表
    - **档 2**：含内联 HTML（`<div>` / `<span>` / 等），且 `style=` 中颜色 / 字体仅出现 `var(--ld-*)` / `var(--bt-*)` / `var(--jyd-*)` 形式
    - **档 3**：仅含公共组件（16 个名单）+ 自由 markdown
    - **档 4**：含 chart.js 字面量（`new Chart(` / `import.*chart.js`）/ 第三方 lib 现写
    - **档 5**：含 `<script setup>` / 自定义 Vue 组件标签（不在公共 16 + layer-1 名单内）/ inline style 含 hardcode 颜色（如 `#ff0000`）
  - 扫每页 frontmatter `layout:` 是否在 layer-1 5 个名单内（不在 = level 5 / 异常）
  - 扫每页 body 中遗留旧 layout (`*-data` / `*-two-col` / `*-image-content`) 或私有组件 (`<LBeitou*>`) = level 5 / 污染
  - 输出 `{ pure: boolean, level: 1|2|3|4|5, perPageLevels: number[], reasons: string[] }`
  - **pure = true 当且仅当所有页 level ≤ 3**（档 1-3 是 pure）；level 4-5 → not-pure → fallback LLM

- `packages/agent/src/services/template-switch-job.ts` 改造：
  - `migrating` stage 开头调 `analyzeDeckPurity(deckId)`
  - pure → 走 deterministic 路径：仅扫 frontmatter `layout:` 行，前缀字符串替换 `<oldId>-` → `<newId>-`，写新 version；**完全跳过 LLM**
  - 不 pure → fallback 原 LLM 重写路径
  - 单测 ≥ 6（pure → deterministic / 部分污染 → LLM / 跨用户 ownership 仍守护 / 切回 retry 等）

- `packages/agent/scripts/migrate-deprecated-layouts.ts`：dry-run 默认；幂等；改写每条落新 version；测试 ≥ 4

**验证**：

```bash
pnpm test          # 含 A/B contract + analyzeDeckPurity + deterministic 路径
pnpm e2e           # 全部 11 个 spec

pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts --dry-run
# 列出待改 deck 数 + 双份对比 log

pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts --apply
pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts --apply
# 第二次跑应 0 affected
```

**风险**：

- A/B contract 改动量大 → 结构性断言（关键 substring）
- 迁移脚本 frontmatter→组件 JSON 字面量转义（中文 + 数字 + unit 混合） → fixture 必须覆盖；先 dry-run + 人审
- prompt 加段后 token 长度膨胀（~1500 → ~2300）→ 监控 GLM 上下文用量
- AI 仍倾向旧惯性（不用栅格 / 装饰）→ 实施初期 smoke 紧观察 + 调措辞
- analyzeDeckPurity 误判把"含私有组件"deck 判为 pure → 测试覆盖 `<LBeitou*>` / `<jyd-metric>` / 旧 layout 字段三类污染信号
- deterministic 路径覆盖率 100% 但部分 deck 切模板后视觉错乱（layer-1 装饰差异较大） → 这是 layer-1 设计预期，验证手验环节

**commit**：`feat(phase-7.5d): layer-1 收敛 5 + section-title + 公共组件 prompt + deterministic 切模板路径 + 数据迁移`

---

### Task 7.5E：starter 改造 + 文档 + 全测试通过 + 手验

**目标**：starter 用 layer-1 + 三类公共组件示范用法；文档链入；全测试绿；用户手验。

**交付物**：

- `packages/slidev/templates/beitou-standard/starter.md`：5 页骨架，每个 layer-1 layout 各示一次 + 至少 1 个栅格 + 1 个装饰 + 1 个内容块组件示例

- `packages/slidev/templates/jingyeda-standard/starter.md`：同结构

- `packages/slidev/components/COMPONENTS.md` 补完整：每条 props/slots + 中文示例 + 决策树（与 prompt 一致）

- `pnpm test && pnpm e2e` 全绿（11 / 11 E2E）；coverage 维持

- AI prompt smoke：dev 模式手动让 AI 生成 5 页 deck（"Q1 业务汇报含工作内容方阵 / 数据指标 / 流程"），观察输出含至少 1 个栅格 + 1 个装饰 + 1 个内容块组件 + 适量自由 markdown

- **切模板手验（产品断言验证，由用户跑）**：
  - dev 模式建一个 beitou deck，AI 生成 5 页（含 PetalFour / TwoColumnsTwoRows / MetricCard 等）
  - 切到 jingyeda：观察 `template-switch-job` 走 deterministic 路径（log 应有"deck pure → deterministic"）
  - 肉眼对比切换前后两份 `deck_versions.content`：
    - frontmatter `layout:` 字段从 `beitou-*` 改 `jingyeda-*`（且仅在 5 个 layer-1 间映射）✅
    - body 里所有公共组件标签 / props / slot 内容**字面 100% 一致**（deterministic 路径保证）✅
    - 自由 markdown 段落字面相同 ✅
    - 仅 frontmatter `theme:` 等 slidev 全局字段差异
  - 视觉对比：装饰类组件（PetalFour）形状相同、颜色由红变蓝绿 ✅
  - 满足以上则验收通过

- `docs/requirements/roadmap.md`：Phase 7.5 状态行 → "✅ 已完成" + link 本 plan；变更记录追加一行

**验证**：

```bash
pnpm test && pnpm e2e
pnpm dev
# 浏览器：登录 → 新建 beitou deck → AI 生成 5 页 → 切到 jingyeda → deck_versions 比对 + 视觉验证
```

**风险**：

- starter 改造让现存 starter byte-content 测试（plan 12 / 13）红 → 同步更新断言
- AI 不积极用栅格 / 装饰 → 修 prompt 措辞
- jingyeda 切模板时 chart 字体从仿宋变雅黑 → 用户判断（理论改进）
- 切模板手验时 deterministic 路径未触发（deck 含遗留私有组件）→ 跑迁移脚本前置清理

**commit**：`feat(phase-7.5e): starter 改三类公共组件 + 文档 + Phase 7.5 关闭`

---

## 验收（与 roadmap.md Phase 7.5 清单映射）

- [ ] 设计 token 规范定稿（22 项 4 大类）→ TOKENS.md / validate-template-tokens
- [ ] 两套模板 layouts 数从 7 收敛到 5
- [ ] 全仓无模板私有 chart / 布局 / 媒体组件残留
- [ ] AI 用三类公共组件生成内容页的 prompt contract test 通过（A/B contract ≥ 18 条）
- [ ] 公共栅格组件单测 ≥ 16（7.5C-1）
- [ ] 公共装饰组件单测 ≥ 6（7.5C-2）
- [ ] 公共内容块组件单测 ≥ 12（7.5C-3）
- [ ] **deterministic 切模板路径单测 ≥ 6 + analyzeDeckPurity 单测覆盖**（7.5D 新增）
- [ ] 切模板手验：内容字节级一致性人工通过；装饰组件几何一致 + 配色随 token 切换
- [ ] 现有 E2E 全绿（11 / 11）
- [ ] 现存 starter 视觉手验无回归
- [ ] 总测试数 377 → ≥ 425（+34 公共组件 / +6 deterministic / +6 prompt contract / +4 迁移脚本 / +4 token validate ≈ +54；浮动 -5 因 layout 删除）

---

## 不做什么（范围围栏）

- ❌ **字节级自动化 E2E** — 用户改为手验
- ❌ **第三套模板新增** — 验证两套切换无损就够
- ❌ **更多装饰类组件**（CircleFour / HexThree / TimelineHorizontal / PyramidLevels / VennTwo / FlowCircular / RadialSix...）— 首版 2 个种子证明机制；其余 backlog 按需加
- ❌ **公共组件提 npm 公开包** / 模板创作者脚手架 / 模板市场 / 模板 override 机制 — Phase 16+
- ❌ **commonComponents 字段加细粒度禁用某 props** — 首版只 opt-in 白名单
- ❌ **新 LLM 工具** — 现有工具够
- ❌ **改两套模板既有的最终配色** — layer-1 装饰一律保留
- ❌ **删除 layer-1 `--bt-*` / `--jyd-*` 命名空间** — 模板内部细节
- ❌ **prompt 改"必须用组件"硬约束** — 自由段落给 AI markdown 自由度
- ❌ **layer-1 `*-content` rename** — 保持原名
- ❌ **deterministic 切模板路径覆盖所有 deck** — 仅 pure deck 走，含污染的 fallback LLM
- ❌ **schema 自动从 props 推导** — catalog 用静态对象 + 手维护

---

## 风险登记

| 风险                                                          | 影响                           | 缓解                                                                   |
| ------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| LLM 不积极用栅格 / 装饰 / 老惯性输出 markdown 长列表          | 失去公共层价值                 | 决策树 + smoke 紧观察 + 调措辞                                         |
| 数据迁移脚本 frontmatter→组件转换 bug 损坏 deck               | 用户体验灾难                   | dry-run 必跑 + 双份 log 给人审 + 落新 version 而非原地改               |
| `--ld-*` token 22 项偏多扩 schema 痛                          | 模板生态长期僵化               | TOKENS.md 顶部留"变更日志"段                                           |
| slidev 包首次配置 vitest 踩 vue plugin 坑                     | 阻塞 7.5C-1                    | 复用 creator vitest.config 模式                                        |
| jingyeda 仿宋 → 雅黑 chart 视觉变化                           | 视觉差异                       | 用户手验判断（理论改进）                                               |
| 删除老 layout 让现有 deck 渲染 404                            | 老 deck 打不开                 | migrate-deprecated-layouts.ts 一次性扫 dev / prod                      |
| section-title 视觉两套各自定义                                | 7.5D 设计期反复                | 7.5D 实施初期一次拍板，smoke 微调                                      |
| nine-grid 在 1080p 内每格 ~300×200 太挤                       | AI 在九宫格 slot 塞 chart 撑爆 | COMPONENTS.md 明示限制 + prompt 写"九宫格 slot 仅放短文字 / 单 metric" |
| analyzeDeckPurity 误判把含私有组件 deck 判 pure               | 切模板字节级一致失败           | 测试覆盖三类污染信号；保守判断（任一可疑 → not pure）                  |
| deterministic 路径仅适用 pure deck，含遗留 deck 仍走 LLM 重写 | 切模板字节级一致只保 pure      | 7.5D 一次性迁移脚本把存量遗留扫干净                                    |
| PetalFour SVG 在缩放下走形                                    | 装饰类视觉灾难                 | viewBox + preserveAspectRatio + 强方形容器                             |
| ProcessFlow cols=2 / cols≥6 边界视觉错位                      | 装饰类视觉灾难                 | 单测覆盖 cols 边界                                                     |
| chart.js Chart.defaults.font.family 单例覆盖                  | chart 字体随机                 | 改用 chart-level option                                                |

---

## 关键文件清单

| 用途                     | 文件                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| roadmap                  | `/Users/zhangxu/workspace/big-ppt/docs/requirements/roadmap.md`                              |
| token spec（NEW）        | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/TOKENS.md`                      |
| 公共组件目录文档（NEW）  | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/COMPONENTS.md`                  |
| token 校验脚本（NEW）    | `/Users/zhangxu/workspace/big-ppt/scripts/validate-template-tokens.ts`                       |
| 公共组件 catalog（NEW）  | `/Users/zhangxu/workspace/big-ppt/packages/agent/src/prompts/commonComponentsCatalog.ts`     |
| analyzeDeckPurity（NEW） | `/Users/zhangxu/workspace/big-ppt/packages/agent/src/services/analyzeDeckPurity.ts`          |
| switch-template-job 改造 | `/Users/zhangxu/workspace/big-ppt/packages/agent/src/services/template-switch-job.ts`        |
| prompt 拼装              | `/Users/zhangxu/workspace/big-ppt/packages/agent/src/prompts/buildSystemPrompt.ts`           |
| A/B contract test        | `/Users/zhangxu/workspace/big-ppt/packages/agent/test/prompts-ab-contract.test.ts`           |
| manifest schema          | `/Users/zhangxu/workspace/big-ppt/packages/shared/src/template-manifest.ts`                  |
| beitou tokens            | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/beitou-standard/tokens.css`      |
| jingyeda tokens          | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/jingyeda-standard/tokens.css`    |
| beitou manifest          | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/beitou-standard/manifest.json`   |
| jingyeda manifest        | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/jingyeda-standard/manifest.json` |
| beitou layouts           | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/beitou-standard/layouts/`        |
| jingyeda layouts         | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/jingyeda-standard/layouts/`      |
| 公共栅格组件目录（NEW）  | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/grid/`                          |
| 公共装饰组件目录（NEW）  | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/decoration/`                    |
| 公共内容块组件目录       | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/`                               |
| 现有 chart 组件          | `/Users/zhangxu/workspace/big-ppt/packages/slidev/components/BarChart.vue` / `LineChart.vue` |
| 数据迁移脚本（NEW）      | `/Users/zhangxu/workspace/big-ppt/packages/agent/scripts/migrate-deprecated-layouts.ts`      |
| starter                  | `/Users/zhangxu/workspace/big-ppt/packages/slidev/templates/<id>/starter.md`                 |
| 模板 registry            | `/Users/zhangxu/workspace/big-ppt/packages/agent/src/templates/registry.ts`                  |

---

## 后续技术债候选（7.5E 关闭时同步登记到 [99-tech-debt.md](../../workspace/big-ppt/docs/plans/99-tech-debt.md)）

> 本节记录 Phase 7.5 实施期间识别出的"将来可能需要做"事项；不在本 phase 范围内但已有触发条件。**7.5E 关闭报告时**把这些条目正式加进 99-tech-debt.md 并标定优先级。

| 候选项                                                                                                                      | 触发条件                                                                                                                                                 | 推荐优先级       |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Prompt 切分层（选项 C）**                                                                                                 | 公共组件库扩到 25+ 个时，system prompt token 占用过大；改为"决策树 + 组件名 + 一句职责"驻留 system prompt + 详情走 `get_component_doc(name)` tool 按需查 | P3：触发后再做   |
| **装饰类组件扩展**（CircleFour / HexThree / TimelineHorizontal / PyramidLevels / VennTwo / FlowCircular / RadialSix / ...） | 用户在使用中发现 PetalFour / ProcessFlow 不够覆盖某场景                                                                                                  | P3：按需加       |
| **栅格类组件扩展**（OneTopThreeBottom 倒装 / 主从更多比例 / 5 列 + / 2x3 等）                                               | 用户提需求                                                                                                                                               | P3               |
| **AI 工作模式 UI 提示**（在 ChatPanel 显示当前 deck 当前 level，让用户感知"这个 deck 是 deterministic 还是 LLM-fallback"）  | 用户报告"切模板视觉走样"                                                                                                                                 | P3               |
| **`commonComponents` 字段细粒度禁用某 props**                                                                               | 模板想 opt-out 某组件部分 variant                                                                                                                        | P4：暂无强需求   |
| **模板 override 机制**（templates/X/overrides/PetalFour.vue 自动覆盖公共版）                                                | Phase 16+ 模板生态系统启动；vision.md 已记录长期方向                                                                                                     | P4：留 Phase 16+ |
| **公共组件提 npm 公开包**（`@lumideck/template-components`）                                                                | 同上 Phase 16+                                                                                                                                           | P4               |
| **一次性迁移脚本归档**                                                                                                      | Phase 7.5 完毕后 `migrate-deprecated-layouts.ts` 跑完两个库；如 Phase 9 仓库卫生清理同步进行可一并归档                                                   | Phase 9          |
| **typography size + spacing token 业务消费方**                                                                              | 7.5A 立了 size-h1/h2/body 等 token 但当前模板里很多字号还是 hardcoded；扫一遍替换                                                                        | P3：未来重构     |

---

## 执行期偏离（关闭后追加）

> 实际跑下来与 plan 不一致的点。

---

## 踩坑与解决（实施期 / 关闭后追加）

> 跑过程中需要侦探一阵才搞定的 bug。

---

## 测试数量落地（关闭后追加）

| 阶段（commit）      | agent | creator | shared | slidev | E2E | 合计 |
| ------------------- | ----- | ------- | ------ | ------ | --- | ---- |
| 入口（Phase 7D 收） | 294   | 71      | 3      | 0      | 9   | 377  |
| 7.5A                |       |         |        |        |     |      |
| 7.5B                |       |         |        |        |     |      |
| 7.5C-1              |       |         |        |        |     |      |
| 7.5C-2              |       |         |        |        |     |      |
| 7.5C-3              |       |         |        |        |     |      |
| 7.5D                |       |         |        |        |     |      |
| 7.5E                |       |         |        |        |     |      |
