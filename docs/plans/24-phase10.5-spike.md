# Phase 10.5 Spike — DeckRenderer Vue 组件可行性验证

> **状态**：待启动
> **前置阶段**：[plan 23 — Phase 11.6 dogfood followup](23-phase11.6-dogfood-followup.md)（HMR 缓存错位的短期兜底已完成；本 spike 为根治路径打基础）
> **后续阶段**：本 spike 通过 → 正式立 plan 25 落地 Phase 10.5；spike 失败 → roadmap Phase 11 沿用进程池方案
> **路线图**：[roadmap.md Phase 10.5](../requirements/roadmap.md#phase-105候选待-spikeslidev-解耦--deckrenderer-vue-组件自封装)
> **执行子技能**：`superpowers:executing-plans`（spike 体量小，单 session 跑完）

**Goal**：用 1-2 天写一个最小 `<DeckRenderer markdown templateId>` Vue 组件，渲染一个真实 deck（cover + content + back-cover 至少 3 页），验证「在 creator SPA 内直接复用 layouts + 公共组件，把 Slidev iframe 整体拆掉」在工程上可行。**不**追求 Slidev 全功能等价，只验证渲染管线 + UnoCSS token 体系迁移 + markdown 解析三件事的可行性。

---

## 关键设计抉择（2026-05-12 与用户对齐）

> spike 前的硬数据 + 设计预判，落地中如发现假设错就直接改本文件。

1. **Slidev runtime API 依赖已 grep 验证为 0**：全仓 `rg '\$slidev|\$nav|@slidev/client|useNav|useSlideContext' -g '*.vue' -g '*.ts'` 零命中。
   - **Why**：这是 roadmap Phase 10.5 标识的「真正硬骨头」，spike 前先量化。结果为 0 → DeckRenderer 不需要 mock 任何 Slidev runtime 注入，layouts 拿过来直接 import 即可用。**这条单独证据已足以判定 spike 极大概率会通过**。
2. **markdown 解析用 `unified` + `remark-parse` + `gray-matter`**：成熟、不重复造轮子。
   - **Why**：候选还有 `mdast-util-from-markdown` 直拼，但 unified 生态有现成 frontmatter 插件 + `---` thematic break 切页好处理。VitePress / Nuxt Content 同款栈，未来扩展余地大。
3. **spike 不接 LLM / 不接 DB / 不接 Vue Router**：写一个独立 spike 页 `creator/src/spike/DeckRendererPlayground.vue`，hardcode 一段 markdown + templateId，挂到临时路由 `/_spike/deck-renderer`，单测 + 浏览器目测即验收。
   - **Why**：spike 只验证「Vue 组件能不能渲染出跟 Slidev iframe 视觉一致的 deck」。把 markdown 数据源、模板切换、LLM、HMR 全砍掉，剩下的就是真问题。
4. **UnoCSS 接 creator**：creator 当前没有 UnoCSS（vite.config 只有 vue + devtools），需要新增 `unocss` 包 + `uno.config.ts`，preset 跟 slidev 包对齐（mini + icons + attributify 按 slidev 现状）。tokens.css 通过 `@import` 复用 slidev 包的两套 tokens.css。
   - **Why**：layouts 大量用 `class="..."` UnoCSS utilities，没有 UnoCSS 渲染出来就是裸 HTML。这是 spike 的基础设施前提，绕不开。
5. **layouts + 公共组件直接从 `@big-ppt/slidev` workspace import**，不重复维护。
   - **Why**：spike 通过后 Phase 10.5 落地时 slidev 包大概率仍保留供「演讲者模式 / 录制」类 fallback 用，组件源单一归属在 slidev 包是稳妥的。spike 只是把渲染入口换成 creator 内的 Vue 组件。
6. **不实现 `<v-clicks>` / `<v-click>` 渐进动画**：roadmap 已写明可放弃或自写 30 行。
   - **Why**：spike 不在范围。
7. **失败判据**（任一命中 → spike 失败，回到 Phase 11 进程池方案）：
   - markdown 解析需要超过 200 行额外代码绕开 Slidev 特殊指令
   - UnoCSS preset 迁移触发 hard incompatibility（rule 行为不一致 / icons 加载链路差异大）
   - 渲染结果跟 Slidev iframe 像素级 / 字号 / 间距差距大到不像同一个 deck（容忍 5px 内偏差）

---

## 测试策略（spike 阶段刻意减配）

> spike 的目标是「快速拿到 go/no-go 决策」，不是建完整 visual regression 守门。截图对比是对的方向，但成本不该在 spike 阶段付。分层如下：

| 层级 | 工具 | 验证什么 | spike 阶段做不做 |
| --- | --- | --- | --- |
| L1 单测 | vitest + `@vue/test-utils` mount `DeckRenderer` | 渲染不报错 / `layout` 字段路由到对应组件 / `frontmatter` 透传 v-bind 命中 | ✅ Task D |
| L2 spot check | 浏览器 devtools 抠 `getComputedStyle()` 3-5 个关键元素 | mainTitle fontSize / 主色色值（`--ld-color-brand-primary` 实算值）/ logo 宽度 — 跟 Slidev iframe 同元素数值对照 | ✅ Task E（数值表落 spike 报告） |
| L3 肉眼并排 | 浏览器开两 tab：DeckRenderer + Slidev iframe 喂同一份 starter | 整体「像不像同一个 deck」的主观判断 | ✅ Task E（决定 go/no-go 的最终裁判） |
| L4 截图自动对比 | Playwright `toHaveScreenshot` × 两套模板 × 6 layout = 12 baseline + CI 跑 Linux Chromium | 跨提交防 visual regression | ❌ **延到 plan 25** |

**为什么 L4 不进 spike**：
- 字体渲染跨机器非确定性（macOS antialiasing ≠ Linux CI），baseline 漂移要调 `maxDiffPixels` / `threshold`
- Slidev iframe 用 `transform: scale()` 缩放，跟 DeckRenderer 1:1 像素对齐前要归一化 viewport
- 截图二进制进 git + LFS 配套
- spike 失败也要丢掉这套基线，沉没成本不划算

**plan 25 落地时**必须补 L4：那时 DeckRenderer 要替换主链路 SlidePreview，没 visual regression 守门会出事故。

---

## ⚠️ Secrets 安全红线（HARD）

- 本 spike 不引入任何环境变量
- 不动 `.gitignore` 现有规则
- 每次 `git commit` 前 `git status` 确认，**禁用 `git add -A`**

---

## 文件结构变更对照表

### 新增（spike 期，验收后大部分会移到 plan 25 正式实现，spike 这一版可能整体推翻重写）

| 文件 | 职责 |
| ---- | ---- |
| `packages/creator/src/spike/DeckRenderer.vue` | 主组件：接 `markdown: string` + `templateId: string` prop，内部解析 + 分页 + 动态渲染 |
| `packages/creator/src/spike/parse-deck.ts` | 把 markdown 文本切成 `Array<{ layout: string; frontmatter: Record<string,any>; body: string }>`，含 cover frontmatter 提取 |
| `packages/creator/src/spike/parse-deck.test.ts` | parse 单测：分页数 / frontmatter 字段 / body 透传 |
| `packages/creator/src/spike/DeckRendererPlayground.vue` | spike 页：hardcode 一段真实 beitou starter 文本喂给 DeckRenderer，鼠标可切 templateId 看 jingyeda |
| `packages/creator/uno.config.ts` | UnoCSS 配置，preset 与 `packages/slidev` 对齐 |
| `packages/creator/src/spike/spike-tokens.css` | `@import '@big-ppt/slidev/templates/beitou-standard/tokens.css'` 两条，把 token 拉进 creator 构建 |
| `docs/plans/24-phase10.5-spike.md` | 本 plan（已存在） |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/creator/package.json` | 加 `unocss` / `@unocss/preset-mini` / `@unocss/preset-icons` / `unified` / `remark-parse` / `remark-frontmatter` / `gray-matter` dev/prod 依赖；加 `@big-ppt/slidev: workspace:*` 引 layout/component |
| `packages/creator/vite.config.ts` | 加 UnoCSS Vite 插件 |
| `packages/creator/src/main.ts` | import `virtual:uno.css` + spike-tokens.css；注册临时 `/_spike/deck-renderer` 路由 |
| `packages/slidev/package.json` | 加 exports 字段把 layouts + components 暴露给 workspace 其他包（如果当前未暴露） |

### 删除

| 文件 | 原因 |
| ---- | ---- |
| —    | spike 不删任何现有文件 |

---

## 数据模型变更

无（spike 不动 DB）。

---

## 阶段拆分

每个 Task 一个 commit。spike 性质偏「调研」，每 Task 验收都偏「手验 + 单测」。

### Task A：量化 Slidev runtime API 依赖，回填本文档

**目的**：把已经在设计期跑过的 grep 结果落到代码 + 测试里，未来回归用。

**操作**：
1. 在仓库根跑：
   ```bash
   rg '\$slidev|\$nav|@slidev/client|useNav|useSlideContext|useDarkMode|useFixedClicks|\$clicks' -g '*.vue' -g '*.ts' --stats
   ```
2. 把命中数写进本文档「关键设计抉择 #1」尾部（应为 0；非 0 时把命中文件列表写到「执行期偏离」）。
3. 在 `packages/slidev/test/no-slidev-runtime-api.test.ts` 加 prevent-regression 单测，断言两套模板 layouts + 所有 `components/{block,grid,decoration,private}/*.vue` 不出现上述任一 pattern（用 `node:fs` 扫描）。

**验证方法**：
- `pnpm -F @big-ppt/slidev vitest run test/no-slidev-runtime-api.test.ts` 绿
- grep 命中数与本文档「关键设计抉择 #1」一致

**风险**：grep 漏覆盖某种 Slidev 注入（例如全局 mixin）。缓解：spike 任务 D 渲染真实 deck 时如果发现 layout 渲染时报 `Cannot read property X of undefined`，回头补 pattern。

**Commit**：`spike(phase10.5): 量化 slidev runtime api 依赖 0 命中 + 防回归测试`

---

### Task B：creator 接 UnoCSS + 复用 slidev tokens

**目的**：让 creator SPA 内的 Vue 组件能用 UnoCSS utility class + `--ld-*` / `--bt-*` / `--jyd-*` token。这是渲染管线的基础设施前提。

**操作**：
1. `cd packages/creator && pnpm add -D unocss @unocss/preset-mini @unocss/preset-icons @unocss/preset-attributify`（版本跟 `packages/slidev` 对齐，可 `cat packages/slidev/package.json | grep unocss` 查）。
2. 新建 `packages/creator/uno.config.ts`：从 `packages/slidev/uno.config.ts`（如不存在，看 slidev 包内 UnoCSS 配置在哪）拷贝 preset 列表 + safelist + theme，去掉 slidev-only 项。
3. 修改 `packages/creator/vite.config.ts`：
   ```ts
   import UnoCSS from 'unocss/vite'
   export default defineConfig({
     plugins: [UnoCSS(), vue(), vueDevTools()],
     // ...
   })
   ```
4. 在 `packages/creator/src/main.ts` 顶部加 `import 'virtual:uno.css'`。
5. 新建 `packages/creator/src/spike/spike-tokens.css`：
   ```css
   @import '@big-ppt/slidev/templates/beitou-standard/tokens.css';
   @import '@big-ppt/slidev/templates/jingyeda-standard/tokens.css';
   ```
6. `packages/slidev/package.json` 加 exports（如果还没）：
   ```json
   "exports": {
     "./templates/*": "./templates/*",
     "./components/*": "./components/*",
     "./layouts/*": "./layouts/*"
   }
   ```
7. `creator/src/main.ts` import spike-tokens.css。
8. 起 `pnpm -F @big-ppt/creator dev`，在 App.vue 临时塞一个 `<div class="text-2xl text-[var(--bt-brand)]">test</div>`，确认显示北投红色 + 大号字。

**验证方法**：
- 浏览器手验：localhost:3030 看到红色大字
- `pnpm -F @big-ppt/creator type-check` 绿
- `pnpm -F @big-ppt/creator build-only` 成功（确认 UnoCSS 在生产构建也生效）

**风险**：UnoCSS preset 跟 slidev 不完全一致时 utility class 渲染差异。缓解：spike 期不追求 100% 像素一致，文档化差异。

**Commit**：`spike(phase10.5): creator 接入 unocss + 复用 slidev tokens.css`

---

### Task C：写 markdown → slide 数组解析器

**目的**：把 Slidev 风格的 markdown（多个 `---` 切片，每片可选 `---\n<yaml>\n---\n<body>`）解析成 `Slide[]`。

**操作**：
1. `cd packages/creator && pnpm add unified remark-parse remark-frontmatter gray-matter`
2. 新建 `packages/creator/src/spike/parse-deck.ts`：
   ```ts
   import matter from 'gray-matter'

   export interface Slide {
     layout: string
     frontmatter: Record<string, unknown>
     body: string
   }

   export function parseDeck(markdown: string): Slide[] {
     // Slidev: 第一个 --- 之前是 deck-level frontmatter（含 theme 等），
     // 之后每个 --- 切一页；每页可选自己的 --- yaml --- 头。
     // spike 简化：忽略 deck-level frontmatter；按顶格 ^---$ 切。
     const blocks = markdown.split(/^---\s*$/m).map((s) => s.trim()).filter(Boolean)
     return blocks.map((block) => {
       const parsed = matter('---\n' + block.replace(/^---\n/, '').replace(/^([^-])/, '---\n$1') + '\n---\n', { delimiters: '---' })
       // 简化版：尝试用 gray-matter 解析；失败则视为纯 body + layout=default
       try {
         const m = matter(`---\n${extractFrontmatter(block)}\n---\n${extractBody(block)}`)
         return {
           layout: String(m.data.layout ?? 'default'),
           frontmatter: m.data,
           body: m.content.trim(),
         }
       } catch {
         return { layout: 'default', frontmatter: {}, body: block }
       }
     })
   }

   function extractFrontmatter(block: string): string {
     // 块内若以 yaml 行开头（无包裹 ---），直接取连续的 key: value 行
     const lines = block.split('\n')
     const fmLines: string[] = []
     let i = 0
     for (; i < lines.length; i++) {
       if (/^\s*$/.test(lines[i])) break
       if (!/^[a-zA-Z_][\w-]*\s*:/.test(lines[i])) break
       fmLines.push(lines[i])
     }
     return fmLines.join('\n')
   }

   function extractBody(block: string): string {
     const fm = extractFrontmatter(block)
     return block.slice(fm.length).trim()
   }
   ```
   > 注：上述实现是 spike 草稿；实际跑测试时按 `slides.example.md` / `starter.md` 真实格式调整。**重点**是产出 `Slide[]`，不追求 Slidev 解析的 100% 兼容。
3. 新建 `packages/creator/src/spike/parse-deck.test.ts`：
   ```ts
   import { describe, it, expect } from 'vitest'
   import { parseDeck } from './parse-deck'

   describe('parseDeck', () => {
     it('单页无 frontmatter → layout default', () => {
       const slides = parseDeck('# Hello\n\nworld')
       expect(slides).toHaveLength(1)
       expect(slides[0].layout).toBe('default')
       expect(slides[0].body).toContain('# Hello')
     })

     it('多页用 --- 切', () => {
       const md = `layout: beitou-cover\nmainTitle: T1\n\n---\n\nlayout: beitou-content\nheading: H2\n\nbody2`
       const slides = parseDeck(md)
       expect(slides).toHaveLength(2)
       expect(slides[0].layout).toBe('beitou-cover')
       expect(slides[0].frontmatter.mainTitle).toBe('T1')
       expect(slides[1].layout).toBe('beitou-content')
     })

     it('真实 starter.md 北投：cover + content + section + back-cover 全识别', () => {
       const md = readFileSync('packages/slidev/templates/beitou-standard/starter.md', 'utf8')
       const slides = parseDeck(md)
       expect(slides.length).toBeGreaterThanOrEqual(3)
       expect(slides.map((s) => s.layout)).toContain('beitou-cover')
       expect(slides.map((s) => s.layout)).toContain('beitou-back-cover')
     })
   })
   ```
4. 跑测试，迭代 `parseDeck` 实现直到全绿。

**验证方法**：
- `pnpm -F @big-ppt/creator vitest run src/spike/parse-deck.test.ts` 全绿
- 至少 3 个 case：单页、多页、真实 starter

**风险**：Slidev frontmatter 还有 `clicks` / `transition` 等特殊字段；spike 范围只透传到 `frontmatter` 字典里不解释。

**Commit**：`spike(phase10.5): markdown → slide[] 解析器 + 真实 starter 兼容测试`

---

### Task D：写 `<DeckRenderer>` 主组件 + spike 页

**目的**：把 parseDeck 输出喂给动态 `<component :is>` 渲染对应 layout，把所有 layouts + 公共组件按需 import 进来。

**操作**：
1. 新建 `packages/creator/src/spike/DeckRenderer.vue`：
   ```vue
   <script setup lang="ts">
   import { computed, defineAsyncComponent } from 'vue'
   import { parseDeck } from './parse-deck'

   const props = defineProps<{ markdown: string; templateId: 'beitou-standard' | 'jingyeda-standard' }>()

   const slides = computed(() => parseDeck(props.markdown))

   // 全部 layouts 静态 import（spike 期 10 个），避免 dynamic import race
   const layoutMap = {
     'beitou-cover': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-cover.vue')),
     'beitou-content': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-content.vue')),
     'beitou-toc': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-toc.vue')),
     'beitou-section-title': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-section-title.vue')),
     'beitou-back-cover': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-back-cover.vue')),
     'beitou-image-content': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/beitou/beitou-image-content.vue')),
     'jingyeda-cover': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-cover.vue')),
     'jingyeda-content': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-content.vue')),
     'jingyeda-toc': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-toc.vue')),
     'jingyeda-section-title': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-section-title.vue')),
     'jingyeda-back-cover': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-back-cover.vue')),
     'jingyeda-image-content': defineAsyncComponent(() => import('@big-ppt/slidev/layouts/jingyeda/jingyeda-image-content.vue')),
   } as const
   </script>

   <template>
     <div class="deck-renderer flex flex-col gap-4">
       <div
         v-for="(slide, idx) in slides"
         :key="idx"
         class="slide-frame w-[960px] h-[540px] border shadow"
         :class="templateId === 'beitou-standard' ? 'beitou-template' : 'jingyeda-template'"
       >
         <component
           :is="layoutMap[slide.layout as keyof typeof layoutMap] ?? 'div'"
           v-bind="slide.frontmatter"
         >
           <div v-html="renderMarkdownBody(slide.body)" />
         </component>
       </div>
     </div>
   </template>
   ```
   > 注：`renderMarkdownBody` spike 期可先 `marked` 或直接 `v-html="slide.body"`（layouts 大多只用 frontmatter，body 渲染需要二次评估，task E 探索）。
2. 新建 `packages/creator/src/spike/DeckRendererPlayground.vue`：
   ```vue
   <script setup lang="ts">
   import { ref } from 'vue'
   import DeckRenderer from './DeckRenderer.vue'
   import beitouStarter from '@big-ppt/slidev/templates/beitou-standard/starter.md?raw'

   const templateId = ref<'beitou-standard' | 'jingyeda-standard'>('beitou-standard')
   </script>

   <template>
     <div class="p-4">
       <div class="mb-4">
         <button @click="templateId = 'beitou-standard'">北投</button>
         <button @click="templateId = 'jingyeda-standard'">竞业达</button>
       </div>
       <DeckRenderer :markdown="beitouStarter" :template-id="templateId" />
     </div>
   </template>
   ```
3. 在 `packages/creator/src/router/index.ts`（如存在）加一条 `/_spike/deck-renderer` 临时路由指向 Playground。若 router 尚未在 spike 阶段引入，直接在 `App.vue` 内 ` <DeckRendererPlayground v-if="$route.path === '/_spike/deck-renderer'" />` 兜底，**不**侵入主路由。
4. `pnpm -F @big-ppt/creator dev` → 访问 `localhost:3030/_spike/deck-renderer`，目测每页是否渲染出正确背景 / logo / 标题字号。

**验证方法**：
- 浏览器手验：beitou starter 至少能看到 cover + content 两页结构（不要求像素完美）
- 切「竞业达」按钮：layouts 全部换成 jingyeda（**Note**：starter 文本是北投格式，layout 字段会找不到对应 jingyeda layout —— 这是预期，此 case 验证的是 `layoutMap` 切换逻辑能识别 unknown layout 走 fallback `<div>` 不崩）
- 控制台无 Vue warning（`Failed to resolve component` 之类）

**风险**：
- 一些 layout 用到组件 import 内部又 import 了 slidev 全局样式 → 没引入会丢字体。缓解：手动 import `@big-ppt/slidev/global.css` 试试。
- markdown body 渲染（layout 内 `<slot />` 接 markdown）需要 markdown→HTML 编译；layout 大量改用 frontmatter 字段所以 body 可能不重要。Spike 期发现 layout 强依赖 slot 内容时再决定加 marked 还是 remark-rehype。

**Commit**：`spike(phase10.5): DeckRenderer 组件 + playground 页跑通北投 starter`

---

### Task E：跟 Slidev iframe 渲染对比 + 写 spike 报告

**目的**：spike 的「go/no-go」结论。

**操作**：
1. 同时开两个 tab：
   - `localhost:3030/_spike/deck-renderer`（DeckRenderer）
   - 编辑器主视图（Slidev iframe）—— 加载同一份 starter
2. **L3 肉眼并排**：逐页对比：
   - 封面 cover：logo / 标题字号 / 背景色块
   - 内容页 content：heading / body 排版
   - 封底 back-cover
3. **L2 spot check** — 每页选 3-5 个关键元素，devtools Console 跑 `getComputedStyle(el)`，把数值列成表（同元素 DeckRenderer vs Slidev）：
   ```js
   // 示例：mainTitle 字号
   getComputedStyle(document.querySelector('.beitou-cover-title')).fontSize
   // 示例：主色实算值
   getComputedStyle(document.querySelector('.slidev-layout')).getPropertyValue('--ld-color-brand-primary')
   ```
   建议覆盖：mainTitle fontSize、主色 hex、logo 宽度、heading lineHeight、背景色。
4. 差异判定（综合 L2 数值 + L3 肉眼）：
   - **可接受**：5px / 5% 内偏差、字体 antialiasing 细节
   - **不可接受**：UnoCSS rule 行为不一致（如 `text-2xl` 字号差距 > 4px）、token 路径解析错误（`--ld-*` 实算值跟 Slidev 不一致）、layout 整个不显示
5. 新建 `docs/plans/24-phase10.5-spike-report.md`（关闭时回填本 plan，不单独入路线图），段落结构：
   - **L2 数值对照表**（必含）— 每页 3-5 个 computed style 数值，DeckRenderer vs Slidev 两列
   - **L3 肉眼并排对比** — 文字描述每页差异点（也可附截图，但非必需）
   - markdown 解析 LOC 实测
   - UnoCSS 迁移踩到的坑
   - **结论：go / no-go**（带 3 个不可接受差异点 + plan 25 工作量重估）
   - go → 立 plan 25 时的工作量重估、需要补 L4 截图自动对比
   - no-go → 回到 Phase 11 进程池方案
6. 把结论同步回 `docs/requirements/roadmap.md` Phase 10.5 章节首行（状态从「候选 / 未启动 spike」改成「spike 已通过，待落地 plan 25」或「spike 未通过，废弃」）。

**验证方法**：
- spike 报告文件存在且结论明确
- roadmap.md Phase 10.5 状态已更新
- 跟用户对齐 go/no-go 后再合并

**风险**：spike 报告写得太草率没法支撑后续决策。缓解：必带「3 个具体不可接受的差异点（如有）」+「重估工作量数字」两个硬指标。

**Commit**：`spike(phase10.5): 渲染对比 + spike 报告 + roadmap 状态回填`

---

## 验收条件

- [ ] Task A：`rg` 量化结果落到本文档 + 防回归测试绿
- [ ] Task B：creator 接 UnoCSS 后 `pnpm -F @big-ppt/creator build-only` 绿
- [ ] Task C：parse-deck 单测 3 case 全绿（含真实 starter）
- [ ] Task D：DeckRenderer 在浏览器渲染出北投 starter 至少 3 页结构
- [ ] Task E：spike 报告 + roadmap 状态回填，跟用户对齐 go/no-go
- [ ] 全量回归：`pnpm test` + `pnpm -F @big-ppt/creator type-check` 绿
- [ ] 未引入新 secrets / 未改 `.gitignore`

---

## 不做什么（范围围栏）

- ❌ 实现完整 Slidev 兼容（`<v-clicks>` / 演讲者模式 / 录制 / 标注 / 黑板）
- ❌ 接 Vue Router 主路由 / 接编辑器 ChatPanel（spike 只挂临时 `/_spike/*` 路由）
- ❌ 接 LLM / 接 DB / 接生图（喂 hardcode markdown 即可）
- ❌ 接 HMR / 多用户并发（这是 plan 25 的事）
- ❌ 解决 long session HMR 缓存错位（这是 plan 25 的事，spike 只验证它有解）
- ❌ 替换主视图 SlidePreview（spike 是 side-by-side 验证，不动现有链路）
- ❌ 把 spike 代码合并到主分支：除非用户明确批 go，否则 spike 代码留在 spike 分支上 archive

---

## 执行期偏离（关闭后追加）

> 跑过程中跟 plan 不一致的点回填这里。

---

## 踩坑与解决（实施期 / 关闭后追加）

> 提炼到 CLAUDE.md「已知坑」的标准：换个 Phase 还会撞的工具链 / 测试基建 / 构建系统坑。

---

## 测试数量落地（关闭后追加）

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| creator unit     |      |      |      |
| slidev unit      |      |      |      |
