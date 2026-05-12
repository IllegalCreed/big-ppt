# Phase 10.5 — DeckRenderer 落地（Slidev 解耦）实施文档

> **状态**：待启动
> **前置阶段**：[plan 24 — Phase 10.5 spike](24-phase10.5-spike.md) ✅（spike 报告见 [24-phase10.5-spike-report.md](24-phase10.5-spike-report.md)）
> **后续阶段**：plan 26（Phase 11 — 多用户并发 + 分享链接，范围已因本 Phase 缩水到「deck-level 锁 + 分享链接 + 容量 spike」）
> **路线图**：[roadmap.md Phase 10.5](../requirements/roadmap.md#phase-105slidev-解耦--deckrenderer-vue-组件自封装)
> **执行子技能**：`superpowers:executing-plans`（中等体量，单 session 可推完 Task 25-A/B；Task C/D 涉及主链路与部署，每 Task 单独 commit 后用户验收）
> **预估工作量**：8 个工作日（spike 报告重估 7.5d + 部署收敛真实开销略大）
> **新分支**：`feat/phase10.5-deck-renderer`（off main）；spike 代码留在 `spike/phase10.5-deck-renderer` 分支 reference 用

**Goal**：把 Slidev iframe 形态的预览器换成 creator SPA 内的 `<DeckRenderer markdown templateId>` Vue 组件，从根本上消除 long session HMR 缓存错位（plan 23 踩坑 13）、iframe 跨域复杂度、agent 内 http-proxy 反代、Slidev 进程独立部署等架构债。完成后 Phase 11 进程池方案自动作废，多用户并发简化为「deck-level 锁 + 分享链接」。

---

## 关键设计抉择（2026-05-12 与用户对齐 + spike 复盘）

> spike 已通过用户 L2/L3 双确认「完全一样」（[spike 报告](24-phase10.5-spike-report.md)），本 plan 是把 spike 成果工程化。

1. **`packages/slidev` 包保留，但仅供 `slidev build` 静态托管使用**（Phase 11 分享链接场景）
   - **Why**：编辑路径走 DeckRenderer 完全替代，**dev mode + Slidev 进程拆掉**；但分享链接需要静态产物托管，Slidev 的 `slidev build` 一条命令出 SPA 仍然好用，不重造。
   - **影响**：`packages/slidev` 不删，但 `pnpm dev` 不再起 slidev 进程；package scripts 保留 `build` / `gen-thumbnails`，删 `dev` / `dev-open` / `preview`。

2. **接 unplugin-vue-components + unplugin-auto-import，跟 Slidev 内部栈对齐**
   - **Why**：spike 阶段用 `register-slidev-components.ts` 硬编码 19 个组件名（spike 报告 Gap 4），加新组件改两处，跟 Slidev 自己的 `unplugin-vue-components` 自动发现机制不对齐。落地必须改。
   - **monorepo 跨包**：`dirs: ['../slidev/components/**', '../slidev/layouts/**']` 显式跨包扫描；`dts: true` + 路径设到 creator 包内。
   - **附带收益**：`defineProps / ref / computed` 等 Vue API 也走 auto-import，省掉显式 import。

3. **body markdown + Vue 标签运行时编译用 `@vue/compiler-sfc` + `marked`**
   - **Why**：spike Gap 1。`<TwoCol>` / `<MetricCard>` 等 Vue 组件标签出现在 markdown body 内，必须运行时编译成 render 函数才能正常渲染（不能用 `v-html`，那只走 DOM 解析，不触发 Vue runtime）。
   - **链路**：`body string` → `marked` 转标准 markdown 为 HTML → 保留 Vue tag 原样穿透 → `Vue.compile(html)` 出 render → 动态组件渲染。
   - **不用 Slidev 自己的 parser**（@slidev/parser）：那一套捆绑了一堆 deck-level 抽象，独立用 marked + Vue compile 链路更轻。
   - **bundle 影响**：`vue/dist/vue.esm-bundler` 取代 `vue/dist/vue.runtime.esm-bundler`（启用 runtime compiler），打包大小 +~50KB gzip。可接受。

4. **DeckRenderer 正式归属 `packages/creator/src/deck-renderer/`**（spike 在 `src/spike/`，落地挪正）
   - **Why**：spike 时是临时位置 `src/spike/`，落地要进主链路必须挪到 `src/deck-renderer/` 与其他主链路目录平级。

5. **`useSlideStore` 不动其余字段，只改 `refresh` 语义**
   - **Why**：当前 `refresh()` 读 `/api/read-slides` → `update(content)`。新架构下 LLM session 结束 / 切模板 job done 等场景**继续走这条**，差别仅在「不再期望 Slidev iframe 跟着重 load」—— DeckRenderer 是 `content` 的下游 computed 渲染，content 变了它自己就重渲。
   - 删除 `refreshToken`（iframe src bump 用的）+ `aiBusy` 跟「重启 Slidev 按钮」相关的逻辑。

6. **HMR 缓存错位的根治路径**
   - **Why**：spike 报告已确认。DeckRenderer 是 Vue 响应式 prop 驱动，markdown 内容变了 → parseDeck computed 重算 → 对应 slide 重渲，毫秒级，**无 vite module graph 累积**。Phase 11.6 dogfood 踩坑 13 的 long session 问题彻底消失，`SlidePreview` 的「重启 Slidev」按钮整条链路废弃。

7. **不重写 spike 已经写出来的 parse-deck.ts**
   - **Why**：spike 5 个 vitest case 含两套真实 starter.md，已经验证够用。落地把它从 `src/spike/parse-deck.ts` 挪到 `src/deck-renderer/parse-deck.ts` 即可，**功能不动**；新增的功能（deck-level frontmatter 抽出）当增量加。

8. **L4 visual regression 用 Playwright `toHaveScreenshot`，**只在 CI Linux Chromium 跑**
   - **Why**：跨机器字体 antialiasing 差异；本地 macOS 跑会假阳性。playwright config 加 `expect.toHaveScreenshot.maxDiffPixelRatio: 0.01`，threshold 留余量。
   - **基线归属**：`packages/e2e/visual-baselines/` 进 git（PNG 二进制，预估 12 张 × ~100KB = 1.2MB，不上 LFS）。

9. **E2E 改造范围**
   - 原 E2E 通过 `iframe[src*="slidev-preview"]` 定位 → 改成 `.deck-renderer .slide-canvas:nth-child(n)`
   - `BIG_PPT_TEST_REWRITE_MODE=skeleton` 仍保留（switch_template 工具走 starter 不烧 LLM）
   - `/_test/reset-lock` 路由删除（Slidev 进程废弃，无锁可解）

---

## ⚠️ Secrets 安全红线（HARD）

- 本 Phase **删除** `SLIDEV_ORIGIN` env 变量（agent 反代不再使用）；旧 `.env.example` / `.env.production.local` 模板需同步移除该行
- nginx 模板内 `/api/slidev-preview/` location block 整段删除
- 不引入任何新 secret；每次 `git commit` 前 `git status` 确认，**禁用 `git add -A`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/creator/src/deck-renderer/DeckRenderer.vue` | 主组件（spike 版的工程化版本）：响应 markdown + templateId prop，渲染整个 deck |
| `packages/creator/src/deck-renderer/parse-deck.ts` | markdown → Slide[]（spike 拷过来 + 增量扩 deck-level fm 抽出） |
| `packages/creator/src/deck-renderer/parse-deck.test.ts` | parse-deck 单测（spike 5 case + 新增的 deck-level fm case） |
| `packages/creator/src/deck-renderer/compile-body.ts` | body markdown → Vue render 函数（marked + Vue.compile） |
| `packages/creator/src/deck-renderer/compile-body.test.ts` | body 编译单测（纯 markdown / 含 Vue 标签 / 嵌套 slot 各场景） |
| `packages/creator/src/deck-renderer/DeckRenderer.test.ts` | mount DeckRenderer + 断言 layout 路由 + frontmatter v-bind + body slot 渲染 |
| `packages/creator/components.d.ts` | unplugin-vue-components 自动生成的 dts（首次跑后入 git，避免每次 dev 启动重新生成） |
| `packages/creator/auto-imports.d.ts` | unplugin-auto-import 自动生成的 dts |
| `packages/e2e/visual-baselines/` 目录 | 12 张 layout 截图基线 PNG（两套模板 × 6 layout） |
| `packages/e2e/tests/visual.spec.ts` | Playwright `toHaveScreenshot` 守门 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/creator/vite.config.ts` | 加 `Components()` + `AutoImport()` 插件；resolve.alias 把 `vue` 指向 `vue/dist/vue.esm-bundler.js` 启用 runtime compiler |
| `packages/creator/package.json` | 加 `unplugin-vue-components` / `unplugin-auto-import` / `marked` 依赖；删 spike 的 `register-slidev-components.ts` 已不需要的依赖（保留 js-yaml） |
| `packages/creator/src/main.ts` | 删 `import { registerSlidevComponents }`；保留 `@big-ppt/slidev/global.css` 引入 |
| `packages/creator/src/components/SlidePreview.vue` | 删 iframe + restart button 整段；改为 `<DeckRenderer :markdown="content" :template-id="templateId" :current-page="currentPage" />` |
| `packages/creator/src/composables/useSlideStore.ts` | 删 `refreshToken` / `aiBusy`-with-restart 相关字段 |
| `packages/creator/src/composables/useAIChat.ts` | 删 session-end 主动 refresh iframe 的逻辑（DeckRenderer 自己响应 content 变化） |
| `packages/creator/src/router/index.ts` | 删 `/_spike/deck-renderer` 路由（spike 入口废弃） |
| `packages/agent/src/app.ts` | 删 `slidevRestartRoute` import + use；保留其余 |
| `packages/agent/src/index.ts` | 删 http-proxy 整段 + SLIDEV_ORIGIN env + WebSocket upgrade handler |
| `packages/agent/src/middleware/csp.ts` | 删 iframe-related CSP（不再有 Slidev iframe） |
| `packages/agent/src/db/schema.ts` | 注释 `slidev_lock` 字段说明改为「Phase 10.5 起 DeckRenderer 无 lock 概念，字段保留供版本兼容」 |
| `packages/slidev/package.json` | scripts 删 `dev` / `dev-open` / `preview`；保留 `build` / `gen-thumbnails` / `test` |
| `package.json`（根） | `pnpm dev` 改成只起 creator + agent（删 slidev 并发项） |
| `deploy/ecosystem.config.cjs` | 删 `lumideck-slidev` pm2 app |
| `deploy/nginx/lumideck.conf.template` | 删 `/api/slidev-preview/` location block；删 SLIDEV_ORIGIN 变量 |
| `deploy/scripts/install-server.sh` | 删 slidev 相关安装步骤 |
| `scripts/deploy.sh` | 删 backend deploy 时同步 slidev 包的步骤（保留：分享链接需要时再做 build） |
| `packages/e2e/playwright.config.ts` | 删 BIG_PPT_TEST_REWRITE_MODE 与 slidev iframe 相关 webServer env |
| `packages/e2e/tests/**.spec.ts` | iframe selector → `.deck-renderer .slide-canvas` selector |
| `CLAUDE.md` | 删 Slidev 反代 / HMR / 锁相关已知坑（Phase 10.5 完结这些都不存在了）；新增 DeckRenderer 架构章节 + 部署架构图同步 |
| `docs/requirements/roadmap.md` | Phase 10.5 状态翻 ✅；Phase 11 范围缩水更新 |

### 删除

| 文件 | 原因 |
| ---- | ---- |
| `packages/creator/src/spike/` 整个目录 | spike 代码工程化版已在 `src/deck-renderer/`；spike 临时路由已无意义 |
| `packages/creator/public/templates` 软链 | 公共组件 import 走 `@big-ppt/slidev` workspace，资源路径走 unplugin-vue-components 解析 |
| `packages/agent/src/slidev-lock.ts` | DeckRenderer 无锁 |
| `packages/agent/src/slidev-proxy-auth.ts` | 无反代无鉴权 |
| `packages/agent/src/routes/slidev-restart.ts` | 无进程可重启 |
| `packages/agent/src/middleware/request-context.ts` 内 slidev-lock 相关字段 | 同上 |
| `packages/agent/src/__tests__/slidev-lock.test.ts` | 测试目标已删 |
| `deploy/scripts/start-slidev.sh`（如存在） | 进程已删 |

---

## 数据模型变更

无（DB schema 不动；agent 内存里的 slidev-lock 不是 DB 表，删代码即可）。

---

## 阶段拆分

每个 Task 一个 commit。Phase 25-A/B 是基础设施，Phase 25-C 改主链路，Phase 25-D 拆 Slidev 进程，Phase 25-E 防线，Phase 25-F 收尾。

### Task 25-A-1：接 unplugin-vue-components + unplugin-auto-import

**目的**：用 plugin 自动发现替代 spike 的 `register-slidev-components.ts` 手工注册。

**操作**：
1. `pnpm -F @big-ppt/creator add -D unplugin-vue-components unplugin-auto-import`
2. 改 `packages/creator/vite.config.ts`：
   ```ts
   import Components from 'unplugin-vue-components/vite'
   import AutoImport from 'unplugin-auto-import/vite'

   plugins: [
     vue(),
     vueDevTools(),
     Components({
       dirs: [
         '../slidev/components',
         '../slidev/layouts',
         'src/components',  // creator 自己的组件保持原有显式 import 习惯
       ],
       dts: 'components.d.ts',
       directoryAsNamespace: false,
       deep: true,
     }),
     AutoImport({
       imports: ['vue', 'vue-router'],
       dts: 'auto-imports.d.ts',
       dirs: [],
     }),
   ]
   ```
3. 改 `packages/creator/vite.config.ts` resolve.alias：
   ```ts
   resolve: {
     alias: {
       '@': fileURLToPath(new URL('./src', import.meta.url)),
       // 启用 runtime template compiler，让 body markdown 编译出来的 template
       // 能在浏览器里 Vue.compile()。
       vue: 'vue/dist/vue.esm-bundler.js',
     },
   }
   ```
4. 跑一次 `pnpm -F @big-ppt/creator dev` 让 plugin 生成 `components.d.ts` + `auto-imports.d.ts`，然后**把这两份 dts 入 git**（避免 CI 每次重新生成）。
5. 删 `packages/creator/src/spike/register-slidev-components.ts`（**等 25-B 整体迁移完再删**，本 Task 只确认 plugin 工作）。
6. 验证 plugin 工作：访问 `/_spike/deck-renderer`（spike 入口还在），确认 layout 仍然渲染（auto-import 接管 `<LBeitouCoverLogo />` 等）。

**验证方法**：
- `pnpm -F @big-ppt/creator type-check` 绿
- `pnpm -F @big-ppt/creator build-only` 绿
- 浏览器 `/_spike/deck-renderer` 渲染跟 spike 完成时一致

**风险**：unplugin-vue-components 跨 monorepo 包扫描的 dirs 路径 + dts 路径生成跨包时的相对路径。**缓解**：先在 `dirs` 用绝对路径 `path.resolve(__dirname, '../slidev/components')` 试，确认 plugin 能找到再优化。

**Commit**：`feat(phase10.5-A1): 接 unplugin-vue-components + auto-import，替代 spike 手工注册`

---

### Task 25-A-2：body markdown + Vue 标签运行时编译

**目的**：实现 spike Gap 1。

**操作**：
1. `pnpm -F @big-ppt/creator add marked`
2. 新建 `packages/creator/src/deck-renderer/compile-body.ts`：
   ```ts
   /**
    * body markdown + Vue 标签 → render 函数。
    *
    * 链路：
    *   marked 把标准 markdown 转 HTML（标题/列表/段落/inline 代码等）
    *   → 保留嵌入的 Vue 自定义标签（marked 默认不处理大写开头的标签，原样穿透）
    *   → Vue.compile(html) 出 render 函数
    *   → 用 defineComponent({ render }) 包成动态组件
    *
    * 缓存：相同 body 文本 → 同一个组件实例，避免每次重渲都重编译（O(n²) 性能坑）
    */
   import { compile, defineComponent, type Component } from 'vue'
   import { marked } from 'marked'

   const cache = new Map<string, Component>()

   export function compileBody(body: string): Component {
     const cached = cache.get(body)
     if (cached) return cached
     // marked 配置：禁 sanitize（默认就是禁）；breaks 跟随 Slidev 默认（false）
     const html = marked.parse(body, { async: false, breaks: false }) as string
     const render = compile(html)
     const comp = defineComponent({ render })
     cache.set(body, comp)
     return comp
   }

   /** 测试场景重置缓存 */
   export function _resetBodyCache(): void {
     cache.clear()
   }
   ```
3. 新建 `packages/creator/src/deck-renderer/compile-body.test.ts`：
   ```ts
   import { describe, it, expect, beforeEach } from 'vitest'
   import { mount } from '@vue/test-utils'
   import { compileBody, _resetBodyCache } from './compile-body'

   beforeEach(() => _resetBodyCache())

   describe('compileBody', () => {
     it('纯 markdown：heading + list 编译成对应 HTML', () => {
       const comp = compileBody('## 标题\n\n- a\n- b')
       const wrapper = mount(comp)
       expect(wrapper.find('h2').text()).toBe('标题')
       expect(wrapper.findAll('li')).toHaveLength(2)
     })

     it('内嵌 Vue 标签：<Quote text="hi" /> 运行时解析为组件实例', () => {
       const comp = compileBody('<Quote text="hi" />')
       // 注：测试时 Quote 未注册到 app；mount 给一个 stub
       const wrapper = mount(comp, {
         global: {
           stubs: { Quote: { template: '<div class="quote-stub">{{ text }}</div>', props: ['text'] } },
         },
       })
       expect(wrapper.find('.quote-stub').text()).toBe('hi')
     })

     it('同 body 字符串复用缓存（identity equality）', () => {
       const a = compileBody('# same')
       const b = compileBody('# same')
       expect(a).toBe(b)
     })
   })
   ```
4. 跑 `pnpm -F @big-ppt/creator exec vitest run src/deck-renderer/compile-body.test.ts`，红 → 绿。

**验证方法**：
- 3 个 vitest case 全绿
- `pnpm -F @big-ppt/creator type-check` 绿

**风险**：
- Vue runtime compiler 包大小膨胀（+50KB gzip）；可接受。
- marked 对 `<TwoCol>` 等大写自定义标签的处理：marked 5+ 默认 inline-html 走 raw 模式不破坏。**验证手段**：用真实 starter.md slide 4 的 body 跑一遍，肉眼看 `<TwoCol>` 标签仍在 HTML 字符串里。

**Commit**：`feat(phase10.5-A2): body markdown + Vue 标签运行时编译（marked + Vue.compile）`

---

### Task 25-B-1：parse-deck 从 spike 挪到正式位置 + 加 deck-level fm 抽出

**目的**：把 spike 的 `parse-deck.ts` 落到正式目录，并增量加 deck-level frontmatter 单独抽出能力（spike 时把 deck-level fm 混在 slide-1 fm 里）。

**操作**：
1. `mkdir -p packages/creator/src/deck-renderer`
2. 把 `packages/creator/src/spike/parse-deck.ts` 拷到 `packages/creator/src/deck-renderer/parse-deck.ts`
3. 把 `packages/creator/src/spike/parse-deck.test.ts` 拷到 `packages/creator/src/deck-renderer/parse-deck.test.ts`，修改 fixture 路径：
   ```ts
   const p = fileURLToPath(new URL(rel, import.meta.url))
   // rel 从 '../../../slidev/templates/...' 改为 '../../../slidev/templates/...'
   // (深度相同，文件路径不变)
   ```
   （路径深度相同，可能无需改；测试报路径错时再调）
4. 扩展 `parseDeck` 返回 `ParsedDeck` 而非 `Slide[]`：
   ```ts
   export interface ParsedDeck {
     /** Slidev 的 deck-level frontmatter，theme/title/transition/routerMode 等。
      *  注意：跟 slide-1 frontmatter 是「同一个 ---...--- 块」拆出来的，按 key 黑名单划分。 */
     deckFrontmatter: Record<string, unknown>
     slides: Slide[]
   }

   // deck-level 字段白名单（其余字段视作 slide-1 frontmatter）
   const DECK_LEVEL_KEYS = new Set([
     'theme', 'title', 'transition', 'routerMode',
     'highlighter', 'lineNumbers', 'colorSchema', 'fonts',
     'info', 'author', 'download', 'exportFilename',
     'aspectRatio', 'canvasWidth', 'mdc', 'persist',
   ])

   export function parseDeck(markdown: string): ParsedDeck {
     // ...原逻辑产出 slides...
     // 取 slides[0].frontmatter 按 DECK_LEVEL_KEYS 拆分
     const slides = ...  // 原算法
     const deckFrontmatter: Record<string, unknown> = {}
     if (slides[0]) {
       const fm = slides[0].frontmatter
       for (const k of Object.keys(fm)) {
         if (DECK_LEVEL_KEYS.has(k)) {
           deckFrontmatter[k] = fm[k]
           delete fm[k]
         }
       }
     }
     return { deckFrontmatter, slides }
   }
   ```
5. 加新 vitest case：
   ```ts
   it('deck-level frontmatter 抽出：theme/title 不污染 slide-1 frontmatter', () => {
     const md = fixture('../../../slidev/templates/beitou-standard/starter.md')
     const { deckFrontmatter, slides } = parseDeck(md)
     expect(deckFrontmatter.theme).toBe('seriph')
     expect(deckFrontmatter.title).toBe('新建幻灯片')
     expect(slides[0].frontmatter).not.toHaveProperty('theme')
     expect(slides[0].frontmatter).not.toHaveProperty('title')
     expect(slides[0].frontmatter.mainTitle).toBe('请填写标题')  // 真正的 slide fm 留下
   })
   ```
6. 更新原 5 个 case 的 `parseDeck()` 返回类型断言（`slides` 字段）。

**验证方法**：
- `pnpm -F @big-ppt/creator exec vitest run src/deck-renderer/parse-deck.test.ts` 6 cases 全绿

**风险**：DECK_LEVEL_KEYS 漏写某个真实在用的字段，导致它泄漏进 slide-1 frontmatter 触发 layout v-bind 报 Vue warning。**缓解**：浏览器实测时 Vue devtools 看 slide-1 props 是否多余字段。

**Commit**：`feat(phase10.5-B1): parse-deck 正式归属 src/deck-renderer/ + deck-level fm 抽出`

---

### Task 25-B-2：DeckRenderer 工程化 + 单测

**目的**：把 spike 版 DeckRenderer.vue 工程化，加完整单测。

**操作**：
1. 把 `packages/creator/src/spike/DeckRenderer.vue` 拷到 `packages/creator/src/deck-renderer/DeckRenderer.vue`，改造：
   - 删除 `layoutMap` 静态映射（unplugin-vue-components 接管）→ 改用 `<component :is="slide.layout">`
   - 加 `currentPage` prop，单页模式只渲染当前页（替代旧 SlidePreview 的「显示当前页」语义）
   - body slot 接 `compileBody(slide.body)` 出的动态组件
   - 整理 props / emits / 暴露 ref（让父组件能调用 `scrollToPage(n)`）

   完整代码：
   ```vue
   <script setup lang="ts">
   import { computed } from 'vue'
   import { parseDeck } from './parse-deck'
   import { compileBody } from './compile-body'

   const props = withDefaults(
     defineProps<{
       markdown: string
       templateId: string
       /** 单页预览模式当前页（1-indexed）；不传则展示全部页（横向编辑/检视场景） */
       currentPage?: number
     }>(),
     { currentPage: undefined },
   )

   const parsed = computed(() => parseDeck(props.markdown))

   const visibleSlides = computed(() => {
     if (props.currentPage === undefined) return parsed.value.slides
     const idx = props.currentPage - 1
     const slide = parsed.value.slides[idx]
     return slide ? [{ ...slide, _originalIndex: idx }] : []
   })
   </script>

   <template>
     <div class="deck-renderer" :class="`template-${templateId}`">
       <div
         v-for="(slide, idx) in visibleSlides"
         :key="(slide as any)._originalIndex ?? idx"
         class="slide-canvas"
         :class="
           templateId === 'beitou-standard' ? 'beitou-template' : 'jingyeda-template'
         "
       >
         <component :is="slide.layout" v-bind="slide.frontmatter">
           <component v-if="slide.body" :is="compileBody(slide.body)" />
         </component>
       </div>
     </div>
   </template>

   <style scoped>
   .deck-renderer {
     display: flex;
     flex-direction: column;
     gap: 24px;
   }
   .slide-canvas {
     position: relative;
     width: 960px;
     height: 540px;
     overflow: hidden;
     background: #fff;
     box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
   }
   .slide-canvas :deep(.slidev-layout) {
     width: 100%;
     height: 100%;
     position: relative;
     overflow: hidden;
   }
   </style>
   ```
2. 新建 `packages/creator/src/deck-renderer/DeckRenderer.test.ts`：
   ```ts
   import { describe, it, expect } from 'vitest'
   import { mount } from '@vue/test-utils'
   import DeckRenderer from './DeckRenderer.vue'
   import { readFileSync } from 'node:fs'
   import { fileURLToPath } from 'node:url'

   function loadStarter(): string {
     return readFileSync(
       fileURLToPath(new URL('../../../slidev/templates/beitou-standard/starter.md', import.meta.url)),
       'utf8',
     )
   }

   describe('DeckRenderer', () => {
     it('renders all 5 slides from beitou starter (no currentPage prop)', () => {
       const wrapper = mount(DeckRenderer, {
         props: { markdown: loadStarter(), templateId: 'beitou-standard' },
         global: {
           stubs: {
             'beitou-cover': { template: '<div class="stub-cover"><slot /></div>' },
             'beitou-toc': { template: '<div class="stub-toc"><slot /></div>' },
             'beitou-section-title': { template: '<div class="stub-section"><slot /></div>' },
             'beitou-content': { template: '<div class="stub-content"><slot /></div>' },
             'beitou-back-cover': { template: '<div class="stub-back"><slot /></div>' },
           },
         },
       })
       expect(wrapper.findAll('.slide-canvas')).toHaveLength(5)
       expect(wrapper.find('.stub-cover').exists()).toBe(true)
       expect(wrapper.find('.stub-back').exists()).toBe(true)
     })

     it('currentPage=2 只渲染第二页', () => {
       const wrapper = mount(DeckRenderer, {
         props: { markdown: loadStarter(), templateId: 'beitou-standard', currentPage: 2 },
         global: {
           stubs: {
             'beitou-cover': { template: '<div class="stub-cover" />' },
             'beitou-toc': { template: '<div class="stub-toc" />' },
             'beitou-section-title': { template: '<div class="stub-section" />' },
             'beitou-content': { template: '<div class="stub-content" />' },
             'beitou-back-cover': { template: '<div class="stub-back" />' },
           },
         },
       })
       expect(wrapper.findAll('.slide-canvas')).toHaveLength(1)
       expect(wrapper.find('.stub-toc').exists()).toBe(true)
     })

     it('frontmatter 字段通过 v-bind 透传到 layout props', () => {
       const stub = { template: '<div class="captured">{{ mainTitle }}</div>', props: ['mainTitle'] }
       const wrapper = mount(DeckRenderer, {
         props: {
           markdown: '---\nlayout: beitou-cover\nmainTitle: HelloT\n---',
           templateId: 'beitou-standard',
         },
         global: { stubs: { 'beitou-cover': stub } },
       })
       expect(wrapper.find('.captured').text()).toBe('HelloT')
     })
   })
   ```
3. 跑测试，迭代到全绿。

**验证方法**：
- 3 个新 vitest case + Task 25-B-1 的 6 个 parse-deck case 全绿（合计 9 个）
- 浏览器 `/_spike/deck-renderer` 仍可访问（spike 入口暂未删，作为肉眼回归）

**风险**：unplugin-vue-components 在 vitest 环境下不工作（默认只在 vite build/dev pipeline 生效）。**缓解**：单测用 `stubs` 显式 stub 掉 layout 组件，绕开 plugin 解析。这是行业标准做法。

**Commit**：`feat(phase10.5-B2): DeckRenderer 正式落地 + 单测覆盖`

---

### Task 25-C-1：改造 SlidePreview.vue 用 DeckRenderer 替代 iframe

**目的**：把主链路的 iframe 换掉。这是本 Phase 的"破坏性"变更，必须配合 25-D 一起切换才能完整工作；单独 25-C-1 完成后 dev 跑起来 SlidePreview 会显示 DeckRenderer，但 Slidev 进程还在跑（浪费资源但不影响功能）。

**操作**：
1. 改 `packages/creator/src/components/SlidePreview.vue`：
   - 删 iframe + iframeRef + iframeSrc + Phase 9-C sandbox 段
   - 删「重启 Slidev 进程」按钮 + restartError / restarting 状态
   - 删 `effectiveToken` / `refreshToken` 同步逻辑
   - 新增 `<DeckRenderer :markdown="content" :template-id="templateId" :current-page="currentPage" />`
   - 「刷新」按钮改成 `slideStore.refresh()` 唯一作用：重新读 `/api/read-slides`（HMR 不再相关，但用户手动同步 server-side 改动时仍有用）
   - 模板 currentPage 切换通过 prop 即可，删 contentWindow.location.hash 写入
2. 改 `packages/creator/src/composables/useSlideStore.ts`：
   ```ts
   // 删 refreshToken 字段 + 相关 export
   // aiBusy 保留（其他地方仍用）
   ```
3. 改 `packages/creator/src/composables/useAIChat.ts` —— 删 session-end 主动 `slideStore.refresh()` 的代码段：DeckRenderer 已经 reactive，content 改了自动重渲，主动 refresh 反而触发额外 HTTP。**例外**：tool 调用后 server-side `slides.md` 改动需要 client 重新拉，这种 refresh 保留。
4. 改 `packages/creator/src/router/index.ts` 删 `/_spike/deck-renderer` 临时路由。
5. 删 `packages/creator/src/spike/` 整个目录 + `packages/creator/public/templates` 软链。
6. `pnpm dev` 起来，编辑器主视图应该看到 DeckRenderer 渲染 deck（lumideck-slidev 进程仍然在跑没影响）。

**验证方法**：
- `pnpm -F @big-ppt/creator type-check` + `pnpm -F @big-ppt/creator build-only` 全绿
- `pnpm -F @big-ppt/creator test` 既有单测不挂（SlidePreview 没专项单测，覆盖在 E2E 里）
- 浏览器手验：登录 → 进 deck 编辑页 → 看到 DeckRenderer 渲染对应模板的 deck → ChatPanel 发指令 → DeckRenderer 反应式更新

**风险**：
- iframe 删了之后某些 layout 内部用了 `position: absolute` + `transform: scale()` 之类的 Slidev viewport 适配，可能在 DeckRenderer 的 960×540 frame 里展示溢出。**缓解**：Task 25-B-2 测试时已用真实 starter.md 跑过，spike 用户已确认「完全一样」。
- `useAIChat` 删 refresh 后某些场景 LLM 改 `slides.md` 但 client `content` 不同步。**缓解**：保留 tool-completion 后 explicit `slideStore.refresh()` 调用（看实际 useAIChat 代码确定切点）。

**Commit**：`feat(phase10.5-C1): SlidePreview 换 DeckRenderer，删 iframe + 重启按钮 + refreshToken`

---

### Task 25-C-2：useAIChat / useSwitchTemplateJob 等下游 composable 收尾

**目的**：把 25-C-1 在主组件层的改动扫尾到 composable 层。

**操作**：
1. 扫描 grep：
   ```bash
   grep -rn "refreshToken\|iframeRef\|slidev-restart\|slidev-iframe\|probeSlidevReady" packages/creator/src
   ```
   每个命中都修干净。
2. `useSwitchTemplateJob.ts`：切模板成功后原来调 `slideStore.refresh()` + 等 iframe reload，改成只 `slideStore.refresh()` 拉新 markdown（DeckRenderer 自己重渲，无 iframe race）。删 probeSlidevReady 类等待。
3. `useGenerateImageJob.ts`：完成后 `slideStore.refresh()` 保留（拉新 markdown，DeckRenderer 看到 imageSrc 自动加载新图）。

**验证方法**：
- grep 命中 0
- `pnpm -F @big-ppt/creator test` 既有 composable 单测全绿
- 浏览器手验：切模板 + 生图全流程跑通

**风险**：composable 单测里如果 mock 了 `refreshToken` 字段会编译失败。**缓解**：测试同步更新。

**Commit**：`refactor(phase10.5-C2): 下游 composable 清理 iframe / refreshToken 残留`

---

### Task 25-D-1：删 agent 侧 Slidev 反代 + 锁 + 重启 route

**目的**：拆 agent 内的 Slidev 相关代码。这是部署相关的"破坏性"变更前置 —— 这步完成后 dev 跑起来 lumideck-slidev 进程没人会去访问，但进程本身还在跑（25-D-2 删）。

**操作**：
1. 改 `packages/agent/src/index.ts`：
   - 删 `import httpProxy from 'http-proxy'`
   - 删 SLIDEV_ORIGIN / SLIDEV_PROXY_PREFIX / SLIDEV_EXTRA_PREFIXES 常量
   - 删 createProxyServer 创建块 + onProxyReq / onProxyRes / onError 监听
   - 删 server.on('upgrade', ...) 的 WebSocket 转发
   - 删 server.on('request', ...) 的 if-path-match-slidev-prefix 分支
2. 改 `packages/agent/src/app.ts`：删 `slidevRestartRoute` import + use
3. 删文件：
   - `packages/agent/src/slidev-lock.ts`
   - `packages/agent/src/slidev-proxy-auth.ts`
   - `packages/agent/src/routes/slidev-restart.ts`
   - `packages/agent/src/__tests__/slidev-lock.test.ts`（如有）
   - `packages/agent/src/routes/__tests__/slidev-restart.test.ts`（如有）
4. 改 `packages/agent/src/middleware/request-context.ts`：删 activeDeck / slidevLockHolder 等 lock 相关字段
5. 改 `packages/agent/src/middleware/csp.ts`：iframe 相关 CSP 整段删除（不再有 iframe）
6. 改 `packages/agent/src/db/schema.ts`：删/改 `slidev_lock` 字段说明的注释（schema 字段本身保留以免破坏 prod 数据库；但代码不再用）
7. 改 `packages/agent/src/routes/healthz.ts`：删 slidev 探活
8. 改 `packages/agent/.env.example` / `.env.production.example` / `.env.test.example`：删 SLIDEV_ORIGIN 行

**验证方法**：
- `pnpm -F @big-ppt/agent type-check` + `pnpm -F @big-ppt/agent test` 全绿（test 库 lumideck_test 必须先 db:push:test 没动）
- `pnpm dev` 起来，agent 启动日志无 "slidev proxy →" 行；creator 工作正常（DeckRenderer 不依赖 agent 反代）

**风险**：
- 某些 agent 集成测可能依赖 slidev 相关的 setup（比如锁状态）。**缓解**：删测试相关字段时一并改对应 spec。
- 误删 `slidev_lock` 字段本身导致生产部署时 drizzle-kit push 试图 DROP COLUMN。**缓解**：本 Task **只动代码不动 schema**；schema 字段保留供向后兼容（删字段是单独的 db migration，不在本 Phase 范围）。

**Commit**：`refactor(phase10.5-D1): 删 agent 侧 slidev 反代 + 锁 + 重启 route`

---

### Task 25-D-2：删 Slidev dev 进程（package scripts + turbo）

**目的**：本地 `pnpm dev` 不再起 slidev:3031 进程。

**操作**：
1. 改 `packages/slidev/package.json`：
   ```json
   "scripts": {
     "ensure-slides": "...",  // 保留供 build 用
     "build:catalog": "...",
     "build": "pnpm ensure-slides && slidev build",
     "test": "vitest run",
     "gen-thumbnails": "..."  // 保留
     // 删: dev / dev-open / export / preview
   }
   ```
2. 改 `package.json`（根）：
   ```json
   "scripts": {
     "dev": "turbo run dev --parallel --filter @big-ppt/creator --filter @big-ppt/agent"
     // 原本含 slidev 的 filter 拿掉
   }
   ```
3. 改 `turbo.json`：删 slidev 的 dev pipeline 入口（如有）

**验证方法**：
- `pnpm dev` 只起 2 个进程，无 :3031
- `curl localhost:3031` 拒绝连接（确认 Slidev 真不起了）
- creator 编辑流程仍正常工作

**风险**：`pnpm -F @big-ppt/slidev build`（分享链接路径预留）仍然能跑。**缓解**：本 Task 末尾跑一次 `pnpm -F @big-ppt/slidev build` 确认不破。

**Commit**：`refactor(phase10.5-D2): 删 slidev dev 进程，pnpm dev 只起 creator + agent`

---

### Task 25-D-3：部署架构收敛 — pm2 / nginx / deploy script

**目的**：生产部署不再有 lumideck-slidev 进程。

**操作**：
1. 改 `deploy/ecosystem.config.cjs`：删 `lumideck-slidev` app 定义；保留 `lumideck-agent`
2. 改 `deploy/nginx/lumideck.conf.template`：
   - 删 `location /api/slidev-preview/` block
   - 删 `proxy_set_header X-Slidev-*` 相关
   - 删 SLIDEV_ORIGIN 变量
3. 改 `deploy/scripts/start-agent.sh`（如有 SLIDEV_ORIGIN 注入）：删该行
4. 删 `deploy/scripts/start-slidev.sh`（如存在）
5. 改 `scripts/deploy.sh`：
   - `deploy:backend` 中 rsync 同步 `packages/slidev` 的步骤可保留（分享链接 build 需要），但删 `pm2 reload lumideck-slidev`
6. 改 `docs/runbooks/deploy.md`：架构图同步，删 slidev 进程相关条目

**验证方法**：
- `pnpm deploy:ecosystem` dry-run（手工 ssh 看 ecosystem.config.cjs 已无 lumideck-slidev）
- 生产部署在 25-F 末尾真做一次 `pnpm deploy:all`

**风险**：误删 nginx 模板的其他 location block。**缓解**：本 Task 改完用 `git diff deploy/nginx/lumideck.conf.template` 仔细 review。

**Commit**：`refactor(phase10.5-D3): 部署架构收敛 — 删 pm2 lumideck-slidev + nginx slidev 反代`

---

### Task 25-E-1：Playwright visual regression baseline

**目的**：补 spike 报告里说的 L4 截图自动对比。

**操作**：
1. `pnpm -F @big-ppt/e2e add -D @playwright/test`（如未装；通常已经在）
2. 改 `packages/e2e/playwright.config.ts`：
   ```ts
   expect: {
     toHaveScreenshot: {
       maxDiffPixelRatio: 0.01,  // 1% 像素容差（字体 AA 差异余量）
       threshold: 0.2,           // 单像素颜色容差
       animations: 'disabled',
       caret: 'hide',
     },
   },
   ```
3. 新建 `packages/e2e/tests/visual.spec.ts`：
   ```ts
   import { test, expect } from '@playwright/test'

   // 12 个 layout：两套模板 × 6 layout
   // 每个 spec 准备一份 minimal markdown，渲染到 DeckRenderer，截屏比对
   const TEMPLATES = ['beitou-standard', 'jingyeda-standard'] as const
   const LAYOUTS = ['cover', 'toc', 'section-title', 'content', 'image-content', 'back-cover'] as const

   for (const template of TEMPLATES) {
     for (const layout of LAYOUTS) {
       test(`${template} - ${layout}`, async ({ page }) => {
         // /_visual/<template>/<layout> 临时路由由 25-E-1 顺手在 creator 加
         await page.goto(`/_visual/${template}/${layout}`)
         await page.waitForSelector('.slide-canvas')
         const canvas = page.locator('.slide-canvas')
         await expect(canvas).toHaveScreenshot(`${template}-${layout}.png`)
       })
     }
   }
   ```
4. 在 creator 加临时路由 `/_visual/:template/:layout`，渲染对应 layout 的一份固定 markdown（用各 manifest.json 的 required 字段最小值填）。
5. 首次跑：`pnpm -F @big-ppt/e2e test visual.spec.ts --update-snapshots` 生成 baseline
6. baselines 入 git：`git add packages/e2e/visual-baselines/`
7. CI 跑：`pnpm -F @big-ppt/e2e test visual.spec.ts`（不带 `--update-snapshots`）应该全绿
8. 故意改一个 layout 的 CSS（比如 cover 字号 +2px），再跑 → 应该红，diff 图存到 `test-results/`

**验证方法**：
- 12 个 visual spec 全绿
- 故意改 CSS 后红测试可重现
- baseline PNG 入 git（12 个文件，总大小 < 2MB）

**风险**：
- macOS dev 跟 Linux CI 字体 AA 差异即使 1% 容差也红。**缓解**：baseline 只在 CI 生成入 git，本地跑 `--ignore-snapshots`（也可一律 docker 化跑，但本 Phase 不做）。
- `/_visual/*` 临时路由不该上 production。**缓解**：路由组件用 `if (import.meta.env.PROD) return` 或 `if (import.meta.env.MODE !== 'test')` 跳过挂载。

**Commit**：`test(phase10.5-E1): Playwright visual regression — 两套模板 × 6 layout baseline`

---

### Task 25-E-2：E2E spec selector 改造（iframe → DeckRenderer DOM）

**目的**：现有 E2E 通过 `iframe[src*="slidev-preview"]` 定位预览内容，要全部改成 DeckRenderer 内部 selector。

**操作**：
1. grep：
   ```bash
   grep -rn "slidev-preview\|slidev-iframe\|iframe\[" packages/e2e/tests
   ```
2. 逐个 spec 改：原来 `frame.locator('.cover-root')` 改成 `page.locator('.deck-renderer .slide-canvas .cover-root')`（无需 frame 切换）
3. 删 `BIG_PPT_TEST_REWRITE_MODE=skeleton` 之外的 slidev 相关 webServer env
4. playwright.config 内 webServer 命令改：原本起 creator+agent+slidev，改成只起 creator+agent
5. 删 `/_test/reset-lock` 路由相关测试 setup（lock 不存在了）

**验证方法**：
- `pnpm -F @big-ppt/e2e test`（全量）全绿
- E2E 跑完不留任何 slidev:3031 引用

**风险**：某些 E2E 依赖 iframe full-reload 等待时间，删 iframe 后变成同步 reactive 更新；test 里的 `waitForTimeout(2000)` 等可能多余但不影响绿测。**缓解**：保留 waits 不动，后续优化时再砍。

**Commit**：`test(phase10.5-E2): E2E selector iframe → DeckRenderer DOM`

---

### Task 25-F-1：CLAUDE.md / roadmap 收尾

**目的**：把 CLAUDE.md「已知坑」内 Slidev 相关条目清理；roadmap 状态翻 ✅。

**操作**：
1. 改 `CLAUDE.md`：
   - 删「已知坑 / Slidev 反代 + HMR」整段（5 条，本 Phase 全消化）
   - 删「单实例占用锁是 agent 进程内存对象」段（无锁了）
   - 删 `slidev-proxy-auth` / `slidev-lock` / Slidev `slides.md` 锁相关描述
   - 新增「架构 / DeckRenderer」一段：解释 DeckRenderer 取代 Slidev iframe 的工作原理，body markdown 编译链路简述
   - 更新「架构全景」请求流向图：删 `/api/slidev-preview/*` 反代路径
   - 「常用命令」段：`pnpm dev` 备注从「三进程」改成「两进程」
2. 改 `docs/requirements/roadmap.md`：
   - Phase 10.5 状态从「spike ✅ 通过 / 待 plan 25」改为「✅ 已完成 (yyyy-mm-dd 关闭)」
   - Phase 11 章节范围更新：删进程池相关，剩 deck-level 锁 + 分享链接 + 容量 spike
3. 改 `docs/runbooks/deploy.md`：架构图同步（已在 25-D-3 做了一半，本 Task 收尾）

**验证方法**：
- 用户 review CLAUDE.md diff，确认描述无错
- roadmap 状态行准确

**Commit**：`docs(phase10.5-F1): CLAUDE.md 收敛 slidev 反代/锁/HMR 已知坑 + roadmap 状态 ✅`

---

### Task 25-F-2：plan 25 关闭报告 + 真实部署

**目的**：写关闭报告 + 真生产部署一次验证全链路。

**操作**：
1. 在本 plan 末尾「执行期偏离」+「踩坑与解决」+「测试数量落地」三段回填
2. （仅在用户批准后）`FORCE=1 pnpm deploy:all` 跑生产部署
3. `pnpm deploy:healthz` 确认线上 OK
4. 浏览器实测 lumideck.illegalscreed.cn：登录 → 进 deck → DeckRenderer 渲染 + 编辑全流程
5. 监控 1 周：dogfood 期看有无 long session 卡顿 / 资源问题

**验证方法**：
- 关闭报告完整
- 生产部署 healthz 200
- 1 周 dogfood 无回退

**Commit**：`chore(phase10.5-F2): plan 25 关闭报告 + 生产部署验证`

---

## 验收条件

- [ ] Phase 25-A：unplugin-vue-components 接入 + body markdown 编译能力（A1+A2）
- [ ] Phase 25-B：DeckRenderer 正式归属 + parse-deck 扩 deck-level fm + 9 单测全绿（B1+B2）
- [ ] Phase 25-C：SlidePreview 切换到 DeckRenderer + 下游 composable 清理（C1+C2）
- [ ] Phase 25-D：agent slidev 反代 / 锁 / 重启 route 删除 + dev 进程废弃 + 部署收敛（D1+D2+D3）
- [ ] Phase 25-E：Playwright visual regression 12 baseline + E2E selector 改造（E1+E2）
- [ ] Phase 25-F：CLAUDE.md / roadmap 收敛 + 真实部署验证（F1+F2）
- [ ] 全量回归：`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿
- [ ] coverage 门槛维持（agent 90/85，creator 75/65）
- [ ] 生产部署 healthz 200，1 周 dogfood 无回退

---

## 不做什么（范围围栏）

- ❌ 实现 Slidev 演讲者模式 / 录制 / 黑板 / 全屏（roadmap 已写明不做）
- ❌ `<v-clicks>` / `<v-click>` 渐进点击动画（Gap 3 可放弃；遇到需求时再花 30 行自写）
- ❌ 全部 deck 自动迁移（旧 deck markdown 不需要改动，DeckRenderer 直接渲染当前格式）
- ❌ 删 `slidev_lock` DB schema 字段（保留供向后兼容；单独 migration 才能动）
- ❌ Phase 11 多用户并发的进程池 / LRU / 崩溃重拉（本 Phase 完成后这些自动作废，Phase 11 范围缩水重写）
- ❌ 实时协同编辑（CRDT / OT）—— roadmap Phase 16+ 范围
- ❌ 把 `packages/slidev` 包整个删掉（保留 `pnpm build` 路径供 Phase 11 分享链接静态托管）

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
| agent unit       |      |      |      |
| creator unit     |      |      |      |
| slidev unit      |      |      |      |
| E2E              |      |      |      |
| visual baselines | 0    | 12   | +12  |
| coverage lines   |      |      |      |
| coverage branch  |      |      |      |
