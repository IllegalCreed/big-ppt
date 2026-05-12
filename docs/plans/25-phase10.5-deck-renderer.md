# Phase 10.5 — DeckRenderer 落地（Slidev 编辑解耦 / 锁语义归位）实施文档

> **状态**：待启动
> **前置阶段**：[plan 24 — Phase 10.5 spike](24-phase10.5-spike.md) ✅
> **后续阶段**：plan 26（Phase 11 — 分享链接 + 容量 spike，范围已因本 Phase 大缩水）
> **路线图**：[roadmap.md Phase 10.5](../requirements/roadmap.md#phase-105slidev-解耦--deckrenderer-vue-组件自封装)
> **执行子技能**：`superpowers:executing-plans`
> **预估工作量**：6 个工作日
> **新分支**：`feat/phase10.5-deck-renderer`（off main）；spike 代码留在 `spike/phase10.5-deck-renderer` 分支 reference 用

**Goal**：把**编辑器**主视图的 Slidev iframe 换成 creator SPA 内的 `<DeckRenderer>` Vue 组件 — 根治 long session HMR 缓存错位（plan 23 踩坑 13）、消除 iframe 跨域复杂度、让编辑路径**多用户零排队**。Slidev 进程 + agent 反代 + 锁 + nginx 配置**全部保留**供「全屏放映」（`window.open('/api/slidev-preview/...', '_blank')` 新 tab 加载 Slidev SPA）使用，但**锁的归位点从「编辑器进入」挪到「全屏放映触发」** —— 编辑变成无锁多用户并发，放映仍然 slides.md 单文件串行。

**关键架构图**：

```
旧（Phase 10.5 前）：
  编辑器进入 → activate-deck → 抢 slidev-lock → 改写 slides.md → iframe 展示
  全屏放映 → window.open Slidev SPA tab → 反代 → 已持锁用户继续看
  → 编辑器互斥（只能 1 个用户编辑），其他用户卡在 OccupiedWaitingPage

新（Phase 10.5 后）：
  编辑器进入 → 直接 DeckRenderer 渲染（per-user Vue 内存）→ 零锁，多用户并发
  全屏放映 → POST /api/present 抢 slidev-lock → 改写 slides.md → window.open SPA tab
  → 编辑无排队；放映互斥（其他用户在放映时 OccupiedWaitingPage 才出现）
```

---

## 关键设计抉择（2026-05-12 与用户对齐 + spike 复盘）

> spike 已通过用户 L2/L3 双确认「完全一样」（[spike 报告](24-phase10.5-spike-report.md)），本 plan 是把 spike 成果工程化并把锁语义重新归位。

1. **Slidev runtime + agent 反代 + pm2 + nginx + lock + 重启路由全部保留**
   - **Why**：全屏放映（`window.open('/api/slidev-preview/...', '_blank')`）走的是真新 tab 加载 Slidev SPA。演讲模式 / progress / 黑屏 / 演讲者备注 / 录制等 Slidev 自带功能不重造。
   - **不删**：`packages/agent/src/index.ts` 的 http-proxy 反代、WebSocket upgrade、`slidev-proxy-auth.ts`、`slidev-lock.ts`、`routes/slidev-restart.ts`、lumideck-slidev pm2 app、nginx `/api/slidev-preview/` location。
   - **「重启 Slidev」按钮保留但 UI 归位**：原本贴在编辑器 iframe 旁，触发场景是「long session HMR 错位 → 编辑器看到错的渲染」。Phase 10.5 后编辑器不依赖 Slidev，但 dev Slidev 进程仍会偶发卡死 / Vite module state 坏掉 / 放映 tab 内容陈旧 — 仍需要不进终端就能重启的兜底。按钮**挪到「全屏放映」按钮旁**（更贴合实际触发场景：用户放映发现 Slidev 不对 → 重启 → 重试），文案改「重启 Slidev 演讲进程」。disabled 条件从「aiBusy」联动改为「无条件可点」（重启不影响编辑器了）。

2. **锁的语义从「编辑器进入」改成「全屏放映触发」**
   - **Why**：slides.md 是 Slidev 进程全局单文件，多用户同时改会撞 — 这是真实约束；但编辑器只有「访问 Slidev 才需要 slides.md 一致」时才有这约束。Phase 10.5 后编辑器不访问 Slidev，约束自动消失；只有 `window.open('/api/slidev-preview/...')` 时才需要。
   - **新接口**：`POST /api/present`（acquire present-lock + rewrite slides.md to current user's deck，成功后返回 OK，前端再 `window.open`；失败返回当前持锁用户 → 前端展示 OccupiedWaitingPage 类提示）
   - **删除**：`POST /api/activate-deck` 路由（编辑器进入流程不再抢锁；deck 元数据 GET 即可）
   - **锁实现复用**：`slidev-lock.ts` 模块内逻辑不动（持锁 → 心跳 30s → 5min 自动释放），只是 acquire / release 调用点从 activate-deck 挪到 present
   - **UX**：present-lock 失败时显示「XX 正在放映该 deck，是否等待 / 取消」；放映结束 tab close / 心跳失效自动释放（旧 5min 心跳逻辑保留）

3. **接 unplugin-vue-components + unplugin-auto-import**
   - **Why**：spike 报告 Gap 4。spike 阶段 `register-slidev-components.ts` 硬编码 19 个组件，跟 Slidev 自己的 `unplugin-vue-components` 不对齐。`dirs: ['../slidev/components/**', '../slidev/layouts/**']` 跨包扫描；`dts: true` + 路径设到 creator 包内。
   - **附带收益**：`defineProps / ref / computed` 也走 auto-import。

4. **body markdown + Vue 标签运行时编译用 `@vue/compile` + `marked`**
   - **Why**：spike Gap 1。`<TwoCol>` 等 Vue 组件标签必须运行时编译成 render 函数才能渲染。
   - **链路**：body string → `marked` → 含 Vue 标签的 HTML → `Vue.compile(html)` → render 函数 → 动态组件
   - **vite alias**：`vue: 'vue/dist/vue.esm-bundler.js'` 启用 runtime compiler（+50KB gzip 可接受）

5. **DeckRenderer 归属 `packages/creator/src/deck-renderer/`**（spike 在 `src/spike/`，落地挪正）

6. **`useSlideStore` 删 refreshToken / restart 相关字段；保留 aiBusy**

7. **不重写 spike parse-deck**：5 个 vitest case 含两套真实 starter.md 已验证够用，挪位置 + 增量加 deck-level frontmatter 抽出能力

8. **L4 visual regression 用 Playwright `toHaveScreenshot`**，CI Linux Chromium 跑；baseline 入 git（12 张 × ~100KB）

9. **OccupiedWaitingPage 触发路径调整**：只在 `present()` 撞锁时展示；编辑器进入不再展示

10. **不删 slidev_lock DB schema 字段**：保留供向后兼容；本 Phase 只动代码，schema migration 是单独工作

---

## ⚠️ Secrets 安全红线（HARD）

- 本 Phase **不引入新 env**；`SLIDEV_ORIGIN` 等保留不动
- nginx 配置不动
- 每次 `git commit` 前 `git status` 确认，**禁用 `git add -A`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/creator/src/deck-renderer/DeckRenderer.vue` | 主组件（spike 版工程化）：响应 markdown + templateId + currentPage prop |
| `packages/creator/src/deck-renderer/parse-deck.ts` | spike 拷过来 + 扩 deck-level frontmatter 抽出 |
| `packages/creator/src/deck-renderer/parse-deck.test.ts` | 单测（spike 5 + 新 deck-level fm case） |
| `packages/creator/src/deck-renderer/compile-body.ts` | body markdown → Vue render（marked + Vue.compile + cache） |
| `packages/creator/src/deck-renderer/compile-body.test.ts` | body 编译单测 |
| `packages/creator/src/deck-renderer/DeckRenderer.test.ts` | mount + 断言 layout 路由 + frontmatter v-bind + body slot |
| `packages/agent/src/routes/present.ts` | `POST /api/present`：acquire slidev-lock + rewrite slides.md，前端拿到 OK 后再 `window.open` |
| `packages/agent/src/routes/__tests__/present.test.ts` | present 路由单测：成功获取锁 / 已被占用返回 409 + 持锁用户 / 锁超时自动释放 |
| `packages/creator/components.d.ts` | unplugin-vue-components 生成的 dts（入 git） |
| `packages/creator/auto-imports.d.ts` | unplugin-auto-import 生成的 dts（入 git） |
| `packages/e2e/visual-baselines/` 目录 | 12 张 baseline PNG |
| `packages/e2e/tests/visual.spec.ts` | Playwright `toHaveScreenshot` 守门 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/creator/vite.config.ts` | 加 Components + AutoImport plugin；resolve.alias `vue` → `vue/dist/vue.esm-bundler.js` |
| `packages/creator/package.json` | 加 `unplugin-vue-components` / `unplugin-auto-import` / `marked` |
| `packages/creator/src/main.ts` | 删 `registerSlidevComponents` import |
| `packages/creator/src/components/SlidePreview.vue` | iframe 删；改 `<DeckRenderer>`；保留「全屏放映」按钮但改流程：先 `await fetch('/api/present', POST)` 成功再 `window.open`；保留「重启 Slidev」按钮挪到放映按钮旁，文案改「重启 Slidev 演讲进程」，disabled 简化为无条件可点 |
| `packages/creator/src/composables/useSlideStore.ts` | 删 `refreshToken`；`aiBusy` 保留（ChatPanel 仍用） |
| `packages/creator/src/composables/useAIChat.ts` | session-end 主动 refresh iframe 的逻辑删（DeckRenderer 响应式自动更新）；tool-completion 后的 refresh 保留 |
| `packages/creator/src/composables/useDeck.ts`（或类似） | 删 activate-deck 抢锁调用；改成纯 GET deck 元数据 + markdown |
| `packages/creator/src/components/OccupiedWaitingPage.vue` | 显示场景从「进入 deck 撞锁」改成「全屏放映撞锁」；文案调整 |
| `packages/creator/src/router/index.ts` | 删 `/_spike/deck-renderer` 临时路由；deck-editor 路由的 lock-check beforeEnter（如有）删 |
| `packages/agent/src/app.ts` | 注册 `present.ts` 路由；删 `slidevRestartRoute` |
| `packages/agent/src/routes/activate-deck.ts` | 整文件删，或保留路由但去掉抢锁逻辑（仅返回 deck 元数据） |
| `packages/agent/src/slidev-lock.ts` | **不动逻辑**；只是调用方从 activate-deck 改成 present.ts |
| `packages/agent/src/slidev-proxy-auth.ts` | **不动**（全屏放映 SPA 还要走这层鉴权）|
| `packages/e2e/tests/**.spec.ts` | iframe selector → `.deck-renderer .slide-canvas`；锁相关测试改成 present 路径 |
| `CLAUDE.md` | 关键模块章节更新：slidev-lock 描述改为「present-lock 只在全屏放映触发」；架构图改；删「重启 Slidev 进程」按钮相关说明 |
| `docs/requirements/roadmap.md` | Phase 10.5 状态翻 ✅；Phase 11 范围进一步缩水（编辑路径已无并发问题，只剩分享链接） |

### 删除

| 文件 | 原因 |
| ---- | ---- |
| `packages/creator/src/spike/` 整个目录 | spike 工程化版已在 `src/deck-renderer/` |
| `packages/creator/public/templates` 软链 | 公共组件走 `@big-ppt/slidev` workspace import |

### 保留不动（重点说明）

| 文件 | 为什么保留 |
| ---- | ---------- |
| `packages/agent/src/index.ts` http-proxy 整段 | 全屏放映新 tab 走这条反代 |
| `packages/agent/src/middleware/csp.ts` | 全屏放映 tab 仍需 CSP（虽然不是 iframe） |
| `packages/slidev` 整包 + dev 进程 | 全屏放映 SPA 由 Slidev 提供 |
| `deploy/ecosystem.config.cjs` lumideck-slidev app | 生产部署仍需 Slidev 进程 |
| `deploy/nginx/lumideck.conf.template` `/api/slidev-preview/` location | 同上 |
| `packages/agent/src/db/schema.ts` slidev_lock 字段 | 锁逻辑没废，字段仍有用（虽然该字段在内存而非 DB，schema 注释里保留） |

---

## 数据模型变更

无（slidev-lock 是 agent 进程内存对象，不是 DB 表）。

---

## 阶段拆分

每个 Task 一个 commit。**注意 Task D 顺序**：present 路由先建好（D1），前端 SlidePreview 才能切换调用方（D2 在 C1 里顺手）；activate-deck 抢锁删除（D3）放在最后，避免中间状态破坏现有用户路径。

### Task 25-A-1：接 unplugin-vue-components + unplugin-auto-import

**目的**：用 plugin 自动发现替代 spike 的手工注册。

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
         fileURLToPath(new URL('../slidev/components', import.meta.url)),
         fileURLToPath(new URL('../slidev/layouts', import.meta.url)),
         'src/components',
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
3. 同文件 resolve.alias 加：
   ```ts
   alias: {
     '@': fileURLToPath(new URL('./src', import.meta.url)),
     // 启用 runtime template compiler（body markdown 编译需要）
     vue: 'vue/dist/vue.esm-bundler.js',
   }
   ```
4. 跑 `pnpm -F @big-ppt/creator dev` 让 plugin 生成 dts，**两份 dts 入 git**
5. 访问 spike 入口 `/_spike/deck-renderer` 确认渲染仍正常（plugin 接管 LBeitouCoverLogo 等）
6. 删 `packages/creator/src/spike/register-slidev-components.ts`（Task 25-B-2 把 spike 整体删时会一并清，本步骤可暂留）

**验证方法**：
- `pnpm -F @big-ppt/creator type-check` + `pnpm -F @big-ppt/creator build-only` 全绿
- 浏览器访问 `/_spike/deck-renderer` 渲染跟 spike 一致

**风险**：unplugin 跨 monorepo 包扫描路径错。**缓解**：用绝对路径 `fileURLToPath(new URL(...))` 试。

**Commit**：`feat(phase10.5-A1): 接 unplugin-vue-components + auto-import 替代 spike 手工注册`

---

### Task 25-A-2：body markdown + Vue 标签运行时编译

**目的**：实现 spike Gap 1。

**操作**：
1. `pnpm -F @big-ppt/creator add marked`
2. 新建 `packages/creator/src/deck-renderer/compile-body.ts`：
   ```ts
   import { compile, defineComponent, type Component } from 'vue'
   import { marked } from 'marked'

   const cache = new Map<string, Component>()

   export function compileBody(body: string): Component {
     const cached = cache.get(body)
     if (cached) return cached
     const html = marked.parse(body, { async: false, breaks: false }) as string
     const render = compile(html)
     const comp = defineComponent({ render })
     cache.set(body, comp)
     return comp
   }

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
     it('纯 markdown：heading + list 编译成 HTML', () => {
       const comp = compileBody('## 标题\n\n- a\n- b')
       const w = mount(comp)
       expect(w.find('h2').text()).toBe('标题')
       expect(w.findAll('li')).toHaveLength(2)
     })

     it('内嵌 Vue 标签运行时解析', () => {
       const comp = compileBody('<Quote text="hi" />')
       const w = mount(comp, {
         global: {
           stubs: { Quote: { template: '<div class="q">{{ text }}</div>', props: ['text'] } },
         },
       })
       expect(w.find('.q').text()).toBe('hi')
     })

     it('同 body 字符串复用缓存', () => {
       expect(compileBody('# x')).toBe(compileBody('# x'))
     })
   })
   ```
4. `pnpm -F @big-ppt/creator exec vitest run src/deck-renderer/compile-body.test.ts` 全绿

**验证方法**：3 个 vitest case 全绿 + type-check 绿

**风险**：marked 5+ 对大写自定义标签的处理 — 验证手段：用真实 starter.md slide 4 的 `<TwoCol>` body 跑一遍，肉眼看标签仍在 HTML。

**Commit**：`feat(phase10.5-A2): body markdown + Vue 标签运行时编译（marked + Vue.compile）`

---

### Task 25-B-1：parse-deck 落正式位置 + deck-level fm 抽出

**目的**：spike 的 parse-deck 工程化 + 增量加 deck-level frontmatter 单独抽出能力。

**操作**：
1. `mkdir -p packages/creator/src/deck-renderer`
2. `cp packages/creator/src/spike/parse-deck.ts packages/creator/src/deck-renderer/parse-deck.ts`
3. `cp packages/creator/src/spike/parse-deck.test.ts packages/creator/src/deck-renderer/parse-deck.test.ts`
4. 改 parse-deck.ts 签名：返回 `ParsedDeck` 而非 `Slide[]`
   ```ts
   export interface ParsedDeck {
     deckFrontmatter: Record<string, unknown>
     slides: Slide[]
   }

   const DECK_LEVEL_KEYS = new Set([
     'theme', 'title', 'transition', 'routerMode',
     'highlighter', 'lineNumbers', 'colorSchema', 'fonts',
     'info', 'author', 'download', 'exportFilename',
     'aspectRatio', 'canvasWidth', 'mdc', 'persist',
   ])

   export function parseDeck(markdown: string): ParsedDeck {
     // ...原 slides 解析算法不动...
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
5. 旧 5 个 test 改成访问 `parseDeck(md).slides`
6. 加新 test：
   ```ts
   it('deck-level frontmatter 抽出', () => {
     const md = fixture('../../../slidev/templates/beitou-standard/starter.md')
     const { deckFrontmatter, slides } = parseDeck(md)
     expect(deckFrontmatter.theme).toBe('seriph')
     expect(deckFrontmatter.title).toBe('新建幻灯片')
     expect(slides[0]?.frontmatter).not.toHaveProperty('theme')
     expect(slides[0]?.frontmatter.mainTitle).toBe('请填写标题')
   })
   ```

**验证方法**：6 个 case（旧 5 + 新 1）全绿

**风险**：DECK_LEVEL_KEYS 漏写真实在用的字段。**缓解**：浏览器实测时 Vue devtools 看 slide-1 props 异常。

**Commit**：`feat(phase10.5-B1): parse-deck 正式归属 + deck-level fm 抽出`

---

### Task 25-B-2：DeckRenderer 工程化 + 单测

**目的**：把 spike 版工程化，加完整单测，删 spike 残留。

**操作**：
1. 新建 `packages/creator/src/deck-renderer/DeckRenderer.vue`：
   ```vue
   <script setup lang="ts">
   import { computed } from 'vue'
   import { parseDeck } from './parse-deck'
   import { compileBody } from './compile-body'

   const props = withDefaults(
     defineProps<{
       markdown: string
       templateId: string
       /** 1-indexed；undefined = 渲染全部页（多页平铺） */
       currentPage?: number
     }>(),
     { currentPage: undefined },
   )

   const parsed = computed(() => parseDeck(props.markdown))

   const visibleSlides = computed(() => {
     if (props.currentPage === undefined) return parsed.value.slides
     const idx = props.currentPage - 1
     const s = parsed.value.slides[idx]
     return s ? [s] : []
   })
   </script>

   <template>
     <div class="deck-renderer" :class="`template-${templateId}`">
       <div
         v-for="(slide, idx) in visibleSlides"
         :key="idx"
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
   .deck-renderer { display: flex; flex-direction: column; gap: 24px; }
   .slide-canvas {
     position: relative;
     width: 960px;
     height: 540px;
     overflow: hidden;
     background: #fff;
     box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
   }
   .slide-canvas :deep(.slidev-layout) {
     width: 100%; height: 100%; position: relative; overflow: hidden;
   }
   </style>
   ```
2. 新建 `packages/creator/src/deck-renderer/DeckRenderer.test.ts`：
   ```ts
   import { describe, it, expect } from 'vitest'
   import { mount } from '@vue/test-utils'
   import { readFileSync } from 'node:fs'
   import { fileURLToPath } from 'node:url'
   import DeckRenderer from './DeckRenderer.vue'

   const stubs = {
     'beitou-cover': { template: '<div class="stub-cover"><slot /></div>', props: ['mainTitle'] },
     'beitou-toc': { template: '<div class="stub-toc"><slot /></div>' },
     'beitou-section-title': { template: '<div class="stub-section"><slot /></div>' },
     'beitou-content': { template: '<div class="stub-content"><slot /></div>' },
     'beitou-back-cover': { template: '<div class="stub-back"><slot /></div>' },
   }

   function loadStarter() {
     return readFileSync(
       fileURLToPath(new URL('../../../slidev/templates/beitou-standard/starter.md', import.meta.url)),
       'utf8',
     )
   }

   describe('DeckRenderer', () => {
     it('渲染北投 starter 全部 5 页', () => {
       const w = mount(DeckRenderer, {
         props: { markdown: loadStarter(), templateId: 'beitou-standard' },
         global: { stubs },
       })
       expect(w.findAll('.slide-canvas')).toHaveLength(5)
       expect(w.find('.stub-cover').exists()).toBe(true)
       expect(w.find('.stub-back').exists()).toBe(true)
     })

     it('currentPage=2 只渲染第二页', () => {
       const w = mount(DeckRenderer, {
         props: { markdown: loadStarter(), templateId: 'beitou-standard', currentPage: 2 },
         global: { stubs },
       })
       expect(w.findAll('.slide-canvas')).toHaveLength(1)
       expect(w.find('.stub-toc').exists()).toBe(true)
     })

     it('frontmatter 字段通过 v-bind 透传到 layout', () => {
       const w = mount(DeckRenderer, {
         props: {
           markdown: '---\nlayout: beitou-cover\nmainTitle: HelloT\n---',
           templateId: 'beitou-standard',
         },
         global: {
           stubs: {
             'beitou-cover': { template: '<div class="cap">{{ mainTitle }}</div>', props: ['mainTitle'] },
           },
         },
       })
       expect(w.find('.cap').text()).toBe('HelloT')
     })
   })
   ```
3. **最后**删 `packages/creator/src/spike/` 整个目录 + `packages/creator/public/templates` 软链 + `packages/creator/src/router/index.ts` 的 `/_spike/deck-renderer` 路由 + `main.ts` 的 `registerSlidevComponents` import
4. 跑测试 + type-check + build-only 全绿

**验证方法**：
- 9 个 vitest case（parse-deck 6 + DeckRenderer 3）+ compile-body 3 = 12 case 全绿
- spike 目录消失，main.ts / router / vite.config 内无 spike 引用
- type-check + build-only 全绿

**风险**：删 spike 时漏改某处依赖。**缓解**：
```bash
grep -rn "spike\|register-slidev-components" packages/creator/src
```
确认 0 命中。

**Commit**：`feat(phase10.5-B2): DeckRenderer 工程化 + 单测 + 删 spike 残留`

---

### Task 25-C-1：SlidePreview 换 DeckRenderer + 编辑器进入流程去抢锁

**目的**：本 Phase 的主链路切换。完成后编辑器多用户并发零排队。

**操作**：
1. 改 `packages/creator/src/components/SlidePreview.vue`：
   - 删 iframe + iframeRef + iframeSrc + Phase 9-C sandbox 段
   - 删 effectiveToken / refreshToken 同步
   - 新增 `<DeckRenderer :markdown="slideStore.content.value" :template-id="templateId" :current-page="slideStore.currentPage.value" />`
   - 保留「全屏放映」按钮 + presentSrc，但 `present()` 改流程（见步骤 3）
   - 保留「重启 Slidev 演讲进程」按钮 — UI 挪到「全屏放映」按钮旁；文案 + tooltip 改成放映场景；`disabled` 条件简化（删跟 aiBusy 的联动 — 重启 Slidev 不影响编辑器，可一直可点）；保留 confirm 弹窗（避免误点）
   - 保留「刷新」按钮但语义改为「重新从 server 拉 slides.md」（DeckRenderer 自动重渲，不需要 token bump）

2. 改 `packages/creator/src/composables/useSlideStore.ts` 删 `refreshToken`（编辑器无 iframe，不需要 src bump）；`aiBusy` 保留

3. 改 SlidePreview.vue 的 `present()`：
   ```ts
   const presenting = ref(false)
   const presentError = ref<string | null>(null)

   async function present() {
     presenting.value = true
     presentError.value = null
     try {
       const res = await fetch('/api/present', {
         method: 'POST',
         credentials: 'include',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ deckId: deckId.value }),
       })
       if (res.status === 409) {
         const { holderName } = await res.json()
         presentError.value = `${holderName} 正在放映该 deck，请稍后再试`
         return
       }
       if (!res.ok) {
         presentError.value = `获取放映锁失败：${res.status}`
         return
       }
       // 锁拿到 + slides.md 已 rewrite，开新 tab 加载 Slidev SPA
       window.open(`/api/slidev-preview/#/${slideStore.currentPage.value}`, '_blank')
     } finally {
       presenting.value = false
     }
   }
   ```
   错误展示在 toolbar 下方一条 banner。

4. 改 `packages/creator/src/composables/useAIChat.ts`：删 session-end 主动调 `slideStore.refresh()` 的代码段；保留 tool-completion 后的 explicit refresh（server-side slides.md 实际改了需要 pull）

5. 找到编辑器进入流程的抢锁调用（grep `activate-deck`），删调用 + 路由 beforeEnter 的 lock check。**保留** GET deck 元数据 + GET deck markdown 的逻辑。
   ```bash
   grep -rn "activate-deck\|activateDeck" packages/creator/src
   ```
   每处命中：
   - composable / page enter 钩子的 `await activateDeck(id)` 改成 `await fetchDeck(id)`（纯 GET）
   - router beforeEach 的 lock-check 删

6. `packages/creator/src/components/OccupiedWaitingPage.vue` 文案改：
   - 旧：「{user} 正在编辑该 deck，请等待解锁」
   - 新：「{user} 正在放映该 deck，请稍后再试」
   - 触发路径从 router enter 改成 SlidePreview `present()` 失败时

**验证方法**：
- `pnpm -F @big-ppt/creator type-check` + `build-only` 全绿
- 浏览器手验：
  1. 用户 A 登录 → 进 deck X 编辑（**应该秒进，无 OccupiedWaitingPage**）
  2. 用户 B 同时登录 → 进同一个 deck X（**也应该秒进**）
  3. 用户 A 点「全屏放映」→ 新 tab 打开 Slidev SPA
  4. 用户 B 点「全屏放映」→ 应该看到「A 正在放映」的 banner，不开新 tab
  5. 用户 A 关闭放映 tab → 5min 后 B 再试 OK（或 A 主动通过某机制释放，本 Phase 不实现主动释放，靠心跳超时）

**风险**：
- DeckRenderer 渲染依赖的 `slideStore.content.value` 在 deck 切换时可能慢一拍。**缓解**：DeckEditorPage onMounted 先 await fetchMarkdown(deckId) 再 mount SlidePreview。
- present-lock acquire 比之前的 activate-deck 多一次 RTT。**缓解**：放映触发频率低，多 200ms 可接受。

**Commit**：`feat(phase10.5-C1): SlidePreview 换 DeckRenderer + 编辑器进入流程去抢锁`

---

### Task 25-C-2：下游 composable 清理 iframe / refreshToken 残留

**目的**：扫尾 C1 主组件层改动到 composable 层。

**操作**：
1. ```bash
   grep -rn "refreshToken\|iframeRef\|slidev-restart\|slidev-iframe\|probeSlidevReady" packages/creator/src
   ```
   每个命中都修。
2. `useSwitchTemplateJob.ts`：切模板成功后原来 `slideStore.refresh()` + 等 iframe reload，改成只 `slideStore.refresh()`（DeckRenderer 自己重渲）。删 probeSlidevReady。
3. `useGenerateImageJob.ts`：完成后 `slideStore.refresh()` 保留（拉新 markdown，DeckRenderer 看到 imageSrc 自动加载新图）。
4. 既有 composable 单测同步更新（删 `refreshToken` 相关 assertion）

**验证方法**：
- grep 命中 0
- `pnpm -F @big-ppt/creator test` 全绿
- 浏览器手验：切模板 + 生图全链路跑通

**Commit**：`refactor(phase10.5-C2): 下游 composable 清理 iframe / refreshToken 残留`

---

### Task 25-D-1：新建 `POST /api/present` 路由 + 单测

**目的**：把 slidev-lock 的 acquire 点从 activate-deck 挪过来。

**操作**：
1. 新建 `packages/agent/src/routes/present.ts`：
   ```ts
   import { Hono } from 'hono'
   import { requireAuth } from '../middleware/auth.js'
   import { tryAcquireLock, getLockHolder, type LockHolder } from '../slidev-lock.js'
   import { getDeckById } from '../db/decks.js'
   import { rewriteSlidesMd } from '../slides-store.js'
   import { logServerEvent } from '../logger/server-log.js'

   export const presentRoute = new Hono()

   presentRoute.use('/present', requireAuth)
   presentRoute.post('/present', async (c) => {
     const { user } = c.var
     const { deckId } = await c.req.json<{ deckId: number }>()
     const deck = await getDeckById(deckId)
     if (!deck || deck.userId !== user.id) {
       return c.json({ error: 'not found' }, 404)
     }
     const acquired = tryAcquireLock(user.id, user.username, deckId)
     if (!acquired) {
       const holder = getLockHolder()
       logServerEvent({ category: 'present', event: 'lock-conflict', userId: user.id, deckId, holderId: holder?.userId })
       return c.json({ error: 'lock_held', holderName: holder?.username ?? 'unknown' }, 409)
     }
     await rewriteSlidesMd(deck.markdown ?? '')
     logServerEvent({ category: 'present', event: 'lock-acquired', userId: user.id, deckId })
     return c.json({ ok: true })
   })
   ```
   > 注：`tryAcquireLock` / `getLockHolder` / `rewriteSlidesMd` 等具体签名按当前 slidev-lock.ts / slides-store.ts 真实接口对齐；本 plan 给思路，实施时按真实接口微调。

2. 新建 `packages/agent/src/routes/__tests__/present.test.ts`：
   ```ts
   import { describe, it, expect, beforeEach } from 'vitest'
   import { app } from '../../app.js'
   import { resetLock } from '../../slidev-lock.js'
   // ...truncate DB + create users A/B + create deck X owned by A...

   beforeEach(() => resetLock())

   describe('POST /api/present', () => {
     it('owner 抢锁成功，slides.md 被改写', async () => {
       const res = await app.fetch(new Request('http://t/api/present', {
         method: 'POST',
         headers: { cookie: cookieA, 'content-type': 'application/json' },
         body: JSON.stringify({ deckId: deckX.id }),
       }))
       expect(res.status).toBe(200)
       // 断言 slides.md 内容已 sync
     })

     it('B 抢已被 A 持有的锁返回 409 + holderName', async () => {
       // A 先抢
       await app.fetch(...)
       // B 再抢
       const res = await app.fetch(...)
       expect(res.status).toBe(409)
       const body = await res.json()
       expect(body.holderName).toBe('userA')
     })

     it('非 owner 返回 404', async () => {
       const res = await app.fetch(new Request('http://t/api/present', {
         method: 'POST',
         headers: { cookie: cookieB, 'content-type': 'application/json' },
         body: JSON.stringify({ deckId: deckX.id }),
       }))
       expect(res.status).toBe(404)
     })
   })
   ```

3. 改 `packages/agent/src/app.ts`：`app.route('/api', presentRoute)`（或按现有路由组织风格挂载）。**保留 `slidevRestartRoute`**（前端按钮还在用）。

**验证方法**：
- `pnpm -F @big-ppt/agent test` 全绿（含 present 路由 3 case）
- `pnpm -F @big-ppt/agent test:coverage` 不降覆盖率门槛

**风险**：
- present 路由跟 slides-store 写文件配合 — 写完时机晚于响应可能 race。**缓解**：`await rewriteSlidesMd` 在 return 200 之前，确保前端看到 200 时文件已就位。
- 既有锁实现的 acquire 调用方还有 activate-deck，本 Task 不删 activate-deck，两条路径并存到 D-2。**缓解**：T-2 删 activate-deck 完成才算 D 阶段闭环。

**Commit**：`feat(phase10.5-D1): 新增 POST /api/present 路由 — 锁 acquire 点归位`

---

### Task 25-D-2：删 activate-deck 路由

**目的**：编辑器进入不再抢锁。slidev-restart 路由保留。

**操作**：
1. ```bash
   grep -rn "activate-deck\|activateDeck\|/api/activate" packages/agent
   ```
   每处命中：
   - 删 `packages/agent/src/routes/activate-deck.ts`（如果整文件只为这个）
   - 删 `app.ts` 内 activate-deck 注册
   - 删相关单测
2. `packages/agent/src/middleware/request-context.ts`：删 `activeDeck` 字段（如有），保留其他 user/session
3. 改 `packages/agent/src/db/schema.ts` 注释：原说明「activate-deck 抢锁」改成「present 抢锁」
4. 改 `packages/agent/.env.example`：无需变更（SLIDEV_ORIGIN 等保留）

**验证方法**：
- grep `activate-deck` 全仓 0 命中（packages/creator 应该在 C-1 已清干净；本 Task 是 agent 侧）
- `pnpm -F @big-ppt/agent test` 全绿

**风险**：误删共享辅助函数。**缓解**：grep 仔细看每个命中是真删还是要保留。

**Commit**：`refactor(phase10.5-D2): 删 activate-deck 路由 + agent slidev-restart`

---

### Task 25-E-1：Playwright visual regression baseline

**目的**：spike 报告承诺的 L4 视觉守门。

**操作**：
1. 改 `packages/e2e/playwright.config.ts`：
   ```ts
   expect: {
     toHaveScreenshot: {
       maxDiffPixelRatio: 0.01,
       threshold: 0.2,
       animations: 'disabled',
       caret: 'hide',
     },
   },
   ```
2. 在 creator 加临时路由 `/_visual/:template/:layout`：
   ```ts
   // src/router/index.ts，加在 catch-all 之前
   ...(import.meta.env.MODE === 'test' ? [{
     path: '/_visual/:template/:layout',
     name: 'visual-baseline',
     component: () => import('../pages/VisualBaselinePage.vue'),
   }] : []),
   ```
3. 新建 `packages/creator/src/pages/VisualBaselinePage.vue`：
   ```vue
   <script setup lang="ts">
   import { useRoute } from 'vue-router'
   import DeckRenderer from '../deck-renderer/DeckRenderer.vue'
   import { computed } from 'vue'

   const route = useRoute()
   const template = computed(() => String(route.params.template))
   const layout = computed(() => String(route.params.layout))

   // 每个 layout 的最小可渲染 markdown，按 manifest required 字段填
   const fixtures: Record<string, string> = {
     cover: 'layout: ${tpl}-cover\nmainTitle: 测试标题\nsubtitle: 副标题',
     toc: 'layout: ${tpl}-toc\nitems: ["A", "B", "C"]',
     'section-title': 'layout: ${tpl}-section-title\nchapterNumber: 1\nchapterTitle: 数据',
     content: 'layout: ${tpl}-content\nheading: 标题\n---\n\n正文内容',
     'image-content': 'layout: ${tpl}-image-content\nheading: 图标题\nimageSrc: /templates/${tpl}/thumbnail.png',
     'back-cover': 'layout: ${tpl}-back-cover\nmessage: 谢谢观看',
   }

   const markdown = computed(() => {
     const tpl = template.value.replace('-standard', '')
     const raw = fixtures[layout.value] ?? ''
     return `---\n${raw.replace(/\$\{tpl\}/g, tpl)}\n---`
   })
   </script>

   <template>
     <DeckRenderer :markdown="markdown" :template-id="template" />
   </template>
   ```
4. 新建 `packages/e2e/tests/visual.spec.ts`：
   ```ts
   import { test, expect } from '@playwright/test'

   const TEMPLATES = ['beitou-standard', 'jingyeda-standard'] as const
   const LAYOUTS = ['cover', 'toc', 'section-title', 'content', 'image-content', 'back-cover'] as const

   for (const t of TEMPLATES) {
     for (const l of LAYOUTS) {
       test(`${t} - ${l}`, async ({ page }) => {
         await page.goto(`/_visual/${t}/${l}`)
         await page.waitForSelector('.slide-canvas')
         await expect(page.locator('.slide-canvas')).toHaveScreenshot(`${t}-${l}.png`)
       })
     }
   }
   ```
5. 首次跑生成基线：`pnpm -F @big-ppt/e2e test visual.spec.ts --update-snapshots`
6. baseline 入 git：`git add packages/e2e/visual-baselines/`
7. 故意改一个 layout 的 CSS（如 cover 字号 +4px），跑 → 红，diff PNG 在 `test-results/`，回滚 CSS

**验证方法**：
- 12 个 visual spec 全绿（首次）+ 故意改 CSS 后红可重现
- baseline PNG 入 git（< 2MB 总）

**风险**：本地 macOS / CI Linux Chromium AA 差异。**缓解**：本地用 `--ignore-snapshots`，CI 用真 baseline。

**Commit**：`test(phase10.5-E1): Playwright visual regression 12 baseline`

---

### Task 25-E-2：E2E spec selector iframe → DeckRenderer DOM

**目的**：现有 E2E 通过 `iframe[src*="slidev-preview"]` 定位编辑器预览内容，全部改成 DeckRenderer DOM。

**操作**：
1. ```bash
   grep -rn "slidev-preview\|slidev-iframe\|iframe\[" packages/e2e/tests
   ```
2. 每个 spec 改：
   - `frame.locator('.cover-root')` → `page.locator('.deck-renderer .slide-canvas .cover-root')`
   - 无需 frame switch
3. 锁相关 E2E（如有）改：原「访问 deck 触发锁竞争」→「点全屏放映触发锁竞争」
4. playwright.config 内 webServer env 不动（保留 slidev 进程，全屏 / visual spec 都可能用到）
5. **不删** `BIG_PPT_TEST_REWRITE_MODE=skeleton`（switch_template 工具仍可能在 E2E 跑到）
6. **不删** `/_test/reset-lock` 路由（slidev-lock 还在，测试间清锁仍需要）

**验证方法**：
- `pnpm -F @big-ppt/e2e test`（全量）全绿

**风险**：E2E 里 `waitForTimeout(2000)` 等延迟可能多余。**缓解**：本 Task 不优化等待时间，留 unchanged 避免引入新失败。

**Commit**：`test(phase10.5-E2): E2E selector iframe → DeckRenderer DOM + 锁 case 改 present`

---

### Task 25-F-1：CLAUDE.md / roadmap 收尾

**目的**：把 CLAUDE.md 已知坑 / 架构图 / roadmap 状态同步。

**操作**：
1. 改 `CLAUDE.md`：
   - 「关键模块」段 `slidev-lock` 描述更新：「Phase 10.5 起锁的 acquire 点是 `POST /api/present`，编辑器进入不抢锁；持锁含义改为『当前全屏放映用户』」
   - 「请求流向」架构图更新：编辑器路径不走 `/api/slidev-preview/`；全屏放映新 tab 仍走
   - 「已知坑 / Slidev 反代 + HMR」段评估：long session HMR 错位（plan 23 踩坑 13）触发面已消失 → 提示该坑现实意义降低，但条目保留供历史参考
   - 加新章节「架构 / DeckRenderer」简述工作原理（parseDeck + 动态 layout + body 编译 + cache）
2. 改 `docs/requirements/roadmap.md`：
   - Phase 10.5 状态从「spike ✅ 通过 / 待 plan 25」改为「✅ 已完成 (yyyy-mm-dd 关闭)」
   - Phase 11 章节范围进一步收紧：删进程池 / LRU；编辑路径已解决；剩「分享链接 + 容量 spike」

**验证方法**：
- CLAUDE.md diff 用户 review 确认无错
- roadmap 状态行准确

**Commit**：`docs(phase10.5-F1): CLAUDE.md 锁语义归位 + 架构图 + roadmap 状态 ✅`

---

### Task 25-F-2：plan 25 关闭报告 + 真实部署

**目的**：写关闭报告 + 真生产部署验证。

**操作**：
1. 本 plan 末尾「执行期偏离」+「踩坑与解决」+「测试数量落地」三段回填
2. 用户批准后 `FORCE=1 pnpm deploy:all` 跑生产部署
3. `pnpm deploy:healthz` 确认线上 OK
4. 浏览器实测 lumideck.illegalscreed.cn：登录 → 进 deck → DeckRenderer 渲染 → 编辑 → 全屏放映新 tab 跑通 Slidev SPA
5. 监控 1 周 dogfood

**验证方法**：关闭报告完整 + 生产 healthz 200 + 1 周无回退

**Commit**：`chore(phase10.5-F2): plan 25 关闭报告 + 生产部署验证`

---

## 验收条件

- [ ] Phase 25-A：unplugin-vue-components + body markdown 编译能力（A1+A2）
- [ ] Phase 25-B：DeckRenderer 正式归属 + spike 删 + 12 单测全绿（B1+B2）
- [ ] Phase 25-C：SlidePreview 换 DeckRenderer + 编辑器去抢锁 + composable 清理（C1+C2）
- [ ] Phase 25-D：POST /api/present 路由 + 删 activate-deck（D1+D2）；slidev-restart 路由保留
- [ ] Phase 25-E：Playwright 12 visual baseline + E2E selector 改造（E1+E2）
- [ ] Phase 25-F：CLAUDE.md / roadmap 收敛 + 真实部署（F1+F2）
- [ ] **编辑路径多用户实测无 OccupiedWaitingPage**（用户 A、B 同时进同一 deck 都秒进）
- [ ] **全屏放映互斥正常**（A 在放映时 B 触发 present 返回 409 + holderName）
- [ ] 全量回归：`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿
- [ ] coverage 门槛维持（agent 90/85，creator 75/65）
- [ ] 生产 healthz 200，1 周 dogfood 无回退

---

## 不做什么（范围围栏）

- ❌ 删 Slidev runtime / agent 反代 / pm2 / nginx / slidev-lock（全屏放映仍需）
- ❌ 自写 `<PresentationMode>` Vue 组件（演讲模式继续走 Slidev SPA）
- ❌ `<v-clicks>` / 演讲者备注 / 录制（用户在 Slidev SPA tab 里玩这些）
- ❌ 实时协同编辑（CRDT / OT）— roadmap Phase 16+
- ❌ 删 slidev_lock DB schema 字段 — 单独 migration
- ❌ Phase 11 多用户并发整套方案（编辑已解决，剩分享链接 + 容量 spike）
- ❌ present 锁的主动释放接口（靠心跳 5min 超时；后续 Phase 11 可加 `DELETE /api/present`）
- ❌ 优化 E2E 内 `waitForTimeout` 延迟（保持现有 wait，避免引入失败）

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
