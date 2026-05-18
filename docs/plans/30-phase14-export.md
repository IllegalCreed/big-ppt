# Phase 14 — 导出(PDF / PNG 序列 / PPTX) 实施文档

> **状态**:待启动
> **前置阶段**:[plan 25 Phase 10.5 DeckRenderer 解耦](25-phase10.5-deck-renderer.md) / [plan 29 Phase 13 文件上传](29-phase13-file-upload-assets.md)
> **后续阶段**:Phase 15 导入 / Phase 17+ 导出历史 + 异步任务队列
> **路线图**:[roadmap.md Phase 14](../requirements/roadmap.md#phase-14导出)
> **执行子技能**:`superpowers:subagent-driven-development`(Task 多数独立,可并行起 2 agent)

**Goal**:让用户把 deck 一键带离 Lumideck — 同步 modal 内 20s 内拿到 PDF / PNG 序列 zip / PPTX 三种格式之一。**完全在浏览器内** 用 html2canvas 截图 + jsPDF / pptxgenjs / jszip 转产物 → blob 触发 download。**后端零改动**(不加 route,不装 chromium,不占服务器内存)。**显式规避** Slidev 自带 `slidev export` 的图片 onload race bug(截图前 await 5 条 stable 条件)。

---

## 关键设计抉择(2026-05-18 与用户对齐)

> 几个核心决策已与用户对齐,本节记录"Why"。任务执行期发现 plan bug 直接修这里 + 补 prevent-regression 测试。

1. **三种格式都做,modal 内单选**:PDF / PNG 序列 zip / PPTX 全做,modal 内**单选** radio(不多选)。
   - Why:多选意味着同步链路里跑三遍渲染 + 三份产物拼 zip,稳定突破 20s 门槛;单选保持每次操作时长可预测。用户三种需求(打印 / 二次设计 / 嵌入演讲)互不冲突,场景天然分离。
   - 不做多选:future Phase 17+ 异步队列出来时再加。

2. **客户端导出 — 完全在用户浏览器内跑,后端零改动**:
   - **Why**:用户浏览器已经在跑 DeckRenderer,所见即所得。在 server 端 spin up 一个 puppeteer chromium 重新渲染一遍,既占服务器内存(150-200MB chromium),又引入字体差异 / 部署复杂度(装 chromium + 字体 + libs)/ session cookie 透传 / mutex / 进程隔离一堆坑。
   - DeckRenderer 实测用到的 CSS(linear-gradient / box-shadow / transform / mix-blend-mode / filter sepia/hue-rotate / chart.js canvas)html2canvas 100% 覆盖,**没用** backdrop-filter / clip-path / @container 这些 html2canvas 弱项,客户端方案成立。
   - **不选 server-side puppeteer**:用户(2026-05-18)直接质疑"你这些导出工作客户端做不了吗?",ECS 内存有限 + 部署复杂度高,client-side 严格更优。

3. **触发 UX = 同步 modal 20s 内**:点编辑器顶栏「导出」→ modal 让选格式 → 点确认 → loading spinner(带"PDF ≈ 12s / PNG ≈ 10s / PPTX ≈ 15s · 同步导出请保持页面打开")→ 客户端 loop 截图 + 转换 → trigger download。
   - Why:同步模型最简单,无需 jobs 表、polling、断点续传。20s 是用户体感临界值,本 phase 严格守住。
   - 不做:任务队列 / 历史记录表 / 历史重下载 / 进程隔离。这三点 roadmap 已删,留 Phase 17+。

4. **截图 = html2canvas + 隐藏 ExportRenderer 实例(modal 内独立 mount)**:
   - 在 ExportModal 内 mount 一个 `<ExportRenderer>` 组件 — 简化版 DeckRenderer wrapper,只渲染一页全屏 1920×1080,**`position: fixed; left: -10000px`** 移出可视区域(但仍正常 reflow / ResizeObserver / 字体度量)
   - iterate `currentPage = 1..N`,每页等 `waitForRenderStable()` → `html2canvas(el)` → push PNG buffer
   - **不选** in-place 截编辑器 DeckRenderer:编辑器外面有 toolbar / chat / banner,切 currentPage 会触发 reflow 影响用户视觉,且 mobile 视口下 DeckRenderer 缩放到非 1080,截图清晰度低
   - **不选** iframe 加载 `/_export/...` route:跨 document 截图复杂,且额外 SPA 路由 / cookie / 加载时间叠加

5. **PPTX 用 pptxgenjs,每页全幅 PNG 嵌入**:不做 layout-aware 元素转换(那是 Phase 17+ 「可编辑导出」的事)。
   - Why:html2canvas 截图已经拿到完美 PNG,pptxgenjs 把每页 PNG 作 background 嵌入 `slide.background = {data: 'data:image/png;base64,...'}`,产物 PPT 打开可"放映"但 PPT 内点击文本不可编辑。用户 PPTX 场景诉求是"嵌入公司演讲模板替换"或"分发"而非"PPT 内二次编辑"。
   - 选 pptxgenjs:**同时支持 node + browser bundle**(`pptxgenjs/dist/pptxgen.min.js`),client-side 直接用;且已被 @slidev/cli 间接依赖在 lockfile。
   - 不选 nodejs-pptx / officegen:前者 8 年没更新且无 TS types;后者 API 偏 docx 不擅 ppt 模板;且都是 node-only。

6. **image-onload race fix = 浏览器内 5 条 stable 条件**:截图前 await
   - 所有 `<img>` `.complete && .naturalWidth > 0`(防 OSS 大图加载到一半);
   - `document.fonts.ready`(防字体未应用导致行高 reflow);
   - CSS animation / transition 全结束(`Element.getAnimations({subtree:true}).every(a => a.playState === 'finished' || a.playState === 'idle')`);
   - 关键 DeckRenderer 内部 `requestAnimationFrame` × 2(让 ResizeObserver 完成至少一次 scale 计算 → CSS variable `--slide-scale` 写入);
   - 兜底 `setTimeout 500ms` settle(防上述四条都满足但还有未捕获的 micro-task)。
   - 单个 helper 函数 `waitForRenderStable(el)` 集中维护,可单测。

7. **图片同源 fetch,无跨域问题**:Phase 11.5 落地时 AI 生成图存在 **MySQL MEDIUMBLOB**(`deck_assets` 表 data 列),通过 `GET /api/assets/:id` 鉴权返字节;`<img src="/api/assets/...">` 跟 creator SPA 同源(都走 agent),html2canvas 直接 `toBlob()` 不会 tainted。**Lumideck 项目根本没用 OSS / S3 / CDN**,无需任何 CORS 配置 / 中转 proxy。

8. **大 deck 性能 — setTimeout 切片不卡 UI**:
   - 客户端 loop 截图时,每页之间 `await new Promise(r => setTimeout(r, 0))` 让出主线程
   - 配合 modal 内 progress bar(`第 i/N 页`)给用户感知
   - N=20 页测算:截图 ~500ms/页 + waitForStable ~500ms/页 → 20 页 ~20s,边缘 case;N>20 提示用户"deck 较大,预计 30s+"

9. **CSP / 浏览器兼容**:html2canvas 用 `foreignObject` SVG 渲染需要浏览器支持 SVG `<foreignObject>` + `serializeToString`,现代浏览器(2020+)全支持。Lumideck 用户群体本来就是现代浏览器,无兼容性顾虑。

---

## ⚠️ Secrets 安全红线(HARD)

- `.gitignore` 现有规则不动
- 本 Phase **无新环境变量**(全 client-side,无 server 配置)
- 每次 `git commit` 前必 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/creator/src/export/wait-stable.ts` | `waitForRenderStable(el: HTMLElement)` — 等 img + fonts + animations + 2×rAF + 500ms settle |
| `packages/creator/src/export/capture-pages.ts` | `capturePages(deckId, options)` — mount 隐藏 ExportRenderer + iterate currentPage + html2canvas 截图 + 返 PNG Buffer[] |
| `packages/creator/src/export/to-pdf.ts` | `pngsToPdf(pngs)` — jsPDF 拼页;每页 960×540 pt(对齐 DeckRenderer DESIGN_*) |
| `packages/creator/src/export/to-pptx.ts` | `pngsToPptx(pngs)` — pptxgenjs 16:9 / 10in×5.625in,每页 PNG 全幅嵌入 |
| `packages/creator/src/export/to-png-zip.ts` | `pngsToZip(pngs)` — jszip 打包 `slide-01.png ... slide-NN.png` |
| `packages/creator/src/export/download.ts` | `triggerDownload(blob, filename)` — createObjectURL + `<a>` click + revoke |
| `packages/creator/src/components/ExportRenderer.vue` | 简化版 DeckRenderer wrapper,absolute 移出可视区域,只为截图存在 |
| `packages/creator/src/components/ExportModal.vue` | 导出 modal:格式 radio + 时间预估 + 进度条(`第 i/N 页`)+ 错误兜底 + retry |
| `packages/creator/src/composables/useExport.ts` | `useExport().exportDeck(deckId, format, onProgress)` — orchestrate capture + convert + download + 错误 surface |
| `packages/creator/src/export/__tests__/wait-stable.test.ts` | 单测:wait-stable 各分支(img/font/animation 各 mock)按预期 resolve |
| `packages/creator/src/export/__tests__/to-pdf.test.ts` | 单测:PNG buffer 数组 → PDF blob;断 `%PDF-` magic + 页数 |
| `packages/creator/src/export/__tests__/to-pptx.test.ts` | 单测:断 zip header `PK` + jszip 解压确认含 `ppt/slides/slide1.xml` |
| `packages/creator/src/export/__tests__/to-png-zip.test.ts` | 单测:断 zip 内含 N 个 `slide-{i}.png` |
| `packages/creator/src/components/__tests__/ExportModal.test.ts` | 单测:radio 切换 / loading 态 / 错误 retry |
| `packages/creator/src/composables/__tests__/useExport.test.ts` | 单测:happy path / 错误 / 取消(mock capture-pages + converter) |
| `packages/e2e/tests/export-pdf.spec.ts` | E2E:登录 → 打开 deck → 点导出 → 选 PDF → 等下载 → 断文件 size > 10KB + content-type |
| `packages/e2e/tests/export-pptx.spec.ts` | E2E:同上 PPTX(size > 100KB,PPT zip 含图片大) |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/creator/package.json` | 加 `html2canvas`(`^1.4.x`)、`jspdf`(`^3.x`)、`pptxgenjs`(`^4.0.x`)、`jszip`(`^3.x`)。**前端**包,所有库都 ESM 现代 |
| `packages/creator/src/components/DeckEditorCanvas.vue` | 顶栏加「导出」按钮(`Download` icon,放「设置」按钮左侧),点击 `showExport = true` 打开 ExportModal |
| `packages/creator/src/components/SlidePreview.vue` | 已有「导出 .md」按钮的 title 改为「导出 markdown」明确区分;**不**删(MD 导出仍保留作为开发者快路径) |
| `docs/requirements/roadmap.md` Phase 14 段落 | 验收条件改:删「导出页可查看历史导出记录」+「导出进程隔离」,加「AI 出图页截图必须等 img onload 完整」+ 改"客户端导出 / 后端零改动" |
| `CLAUDE.md` 已知坑 | 实施期发现的工具链坑提炼到此(关闭后追加) |

### 删除

| 文件 | 原因 |
| ---- | ---- |
| —    | 本 Phase 纯增量,无删除 |

### **不**改动(关键澄清)

- ❌ **backend agent 零改动**:不加 `/api/decks/:id/export` route,不装 puppeteer-core,不装 chromium,不改 `deploy/scripts/install-server.sh`,不改 `ecosystem.config.cjs` max_memory_restart
- ❌ **db schema 零改动**:不引入 jobs 表 / exports 表(留 Phase 17+)
- ❌ **不**移动 `packages/creator/src/deck-renderer/parse-deck.ts` 到 shared(client-side 已经在 creator 包内,不需要跨包)

---

## 数据模型变更

**无**。本 Phase 不引入新表 / 字段。导出历史 / job 状态全部放 Phase 17+。

---

## 阶段拆分

每个 Task 一个 commit;每步绿测试 + 当步独立可回退。建议 **3 个 Task**,总工时 **4d**。Task A / B 可并行起 2 agent(共享 worktree,文件互不冲突,**必须用 git worktree** 见预案 6),C 串行依赖。

### Task 30-A:`waitForRenderStable` + `ExportRenderer` + `capturePages`(1.5d)

**目的**:有了能稳定截一张干净 PNG 的能力,屏蔽 Slidev 原 export 的 image race bug。

**操作**:
1. 新建 `packages/creator/src/export/wait-stable.ts`:
   ```ts
   export async function waitForRenderStable(el: HTMLElement): Promise<void> {
     // 1. 等所有图片 complete
     const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'))
     await Promise.all(imgs.map(img =>
       img.complete && img.naturalWidth > 0
         ? null
         : new Promise<void>((res) => {
             img.addEventListener('load', () => res(), { once: true })
             img.addEventListener('error', () => res(), { once: true }) // 失败也放行
             setTimeout(() => res(), 10_000) // 单图 10s 兜底
           })
     ))
     // 2. 等字体
     await document.fonts.ready
     // 3. 等 animation
     const anims = el.getAnimations ? el.getAnimations({ subtree: true }) : []
     await Promise.all(anims.map(a => a.finished.catch(() => null)))
     // 4. 2 × rAF(让 ResizeObserver 跑一轮 + scale 写 CSS var)
     await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))
     // 5. 兜底 settle
     await new Promise(res => setTimeout(res, 500))
   }
   ```
2. 新建 `packages/creator/src/components/ExportRenderer.vue`:
   - 简化 wrapper,只渲染一页全屏 1920×1080
   - Props: `deckId / pageIndex / markdown / templateId`
   - 内部:`<DeckRenderer :markdown :template-id :current-page="pageIndex" />`
   - 容器 CSS:
     ```css
     .export-renderer {
       position: fixed; left: -10000px; top: 0;
       width: 1920px; height: 1080px;
       background: #fff;
       z-index: -9999;
       pointer-events: none;
     }
     .export-renderer :deep(.slide-frame) {
       max-width: none; width: 1920px; height: 1080px; box-shadow: none;
       aspect-ratio: 16/9;
     }
     ```
   - 暴露 `defineExpose({ rootRef })` 让 capturePages 拿到根 DOM 元素截图
3. 新建 `packages/creator/src/export/capture-pages.ts`:
   - `capturePages({ deckId, markdown, templateId, totalPages, onProgress }): Promise<Buffer[]>`
   - 流程:
     ```ts
     // mount 一个 ExportRenderer 实例(用 createApp + mount + unmount,或在 ExportModal 内 v-if 控制)
     const app = createApp(ExportRenderer, { deckId, markdown, templateId, pageIndex: 1 })
     const container = document.createElement('div')
     document.body.appendChild(container)
     const instance = app.mount(container)
     const pngs: Buffer[] = []
     try {
       for (let i = 1; i <= totalPages; i++) {
         instance.pageIndex = i // ref 更新 Vue 重新渲染
         await waitForRenderStable(instance.rootRef)
         const canvas = await html2canvas(instance.rootRef, {
           useCORS: true,
           scale: 2, // 2× DPR 出 3840×2160 PNG
           backgroundColor: '#fff',
           width: 1920,
           height: 1080,
           logging: false,
         })
         const blob = await new Promise<Blob>((res, rej) =>
           canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob 返 null')), 'image/png')
         )
         pngs.push(Buffer.from(await blob.arrayBuffer()))
         onProgress?.(i, totalPages)
         await new Promise(r => setTimeout(r, 0)) // 让出主线程防卡 UI
       }
     } finally {
       app.unmount()
       container.remove()
     }
     return pngs
     ```
   - **注意**:`instance.pageIndex = i` 要走 Vue 响应式 — ExportRenderer 把 pageIndex 声明为 `defineModel<number>('pageIndex')` 或 reactive prop,确保赋值后 next tick 触发 re-render
4. 加单测 `packages/creator/src/export/__tests__/wait-stable.test.ts`:
   - jsdom 环境 mock document.fonts / images / getAnimations
   - 5 个 case 各覆盖一条逻辑
5. 加单测 `packages/creator/src/export/__tests__/capture-pages.test.ts`:
   - mock html2canvas 返 fake canvas(`toBlob` 返 1×1 PNG)
   - mock createApp / mount / unmount
   - 测 N=5 页 loop + onProgress 调用次数 + 异常时 unmount 仍被调

**验证方法**:
- `pnpm -F @big-ppt/creator vitest run src/export/__tests__/wait-stable.test.ts src/export/__tests__/capture-pages.test.ts`
- 手测:dev mode 打开 console,临时 import `capturePages` 跑一个 deck,看返的 Buffer[] 长度 = totalPages

**风险**:
- **OSS CORS** 见抉择 #7。先确认 Phase 11.5 落地时 OSS bucket 是否配 `Access-Control-Allow-Origin: *`(去 aliyun OSS 控制台看 bucket CORS 规则,或 curl 一张 image url 看响应 header)。若没配,Task B 内加 agent proxy `GET /api/oss-proxy?url=...`(纯 stream pipe,服务端零计算 ~10 行代码)
- html2canvas 不支持某些 CSS 特性(实测 DeckRenderer 用的都 cover,但若 layouts 内有 `<canvas>` 或 `<video>` 元素 html2canvas 默认不截内容 — 我们当前 chart.js BarChart 是 canvas,要确认 html2canvas `foreignObjectRendering: true` 或 chart.js render 完成后 canvas 内容能被 capture)
- Vue createApp + mount 在 SSR 环境 / vitest 下要小心 — 单测只 mock 流程,不真 mount

**工时**:1.5d

---

### Task 30-B:三种格式 converter(PDF / PPTX / PNG-zip)+ download trigger(1.5d)

**目的**:N 张 PNG buffer → 单个 format 产物 blob,触发浏览器 download。三个 converter 互不依赖,**可并行 3 agent 各 0.5d**。

**操作**:
1. 新建 `packages/creator/src/export/to-pdf.ts`:
   ```ts
   import jsPDF from 'jspdf'
   export async function pngsToPdf(pngs: Buffer[]): Promise<Blob> {
     const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [960, 540] })
     for (let i = 0; i < pngs.length; i++) {
       if (i > 0) pdf.addPage([960, 540], 'landscape')
       const dataUrl = `data:image/png;base64,${pngs[i].toString('base64')}`
       pdf.addImage(dataUrl, 'PNG', 0, 0, 960, 540, undefined, 'FAST')
     }
     return pdf.output('blob')
   }
   ```
   - 单测:断 PDF magic bytes `%PDF-` + jsPDF 内部 doc.getNumberOfPages() = pngs.length
2. 新建 `packages/creator/src/export/to-pptx.ts`:
   ```ts
   import pptxgen from 'pptxgenjs'
   export async function pngsToPptx(pngs: Buffer[]): Promise<Blob> {
     const pres = new pptxgen()
     pres.defineLayout({ name: '16x9-960', width: 10, height: 5.625 })
     pres.layout = '16x9-960'
     for (const png of pngs) {
       const slide = pres.addSlide()
       slide.background = { data: `data:image/png;base64,${png.toString('base64')}` }
     }
     return pres.write({ outputType: 'blob' }) as Promise<Blob>
   }
   ```
   - 单测:用 jszip 解压 blob,断含 `ppt/slides/slide1.xml` + N 个图片资源
3. 新建 `packages/creator/src/export/to-png-zip.ts`:
   ```ts
   import JSZip from 'jszip'
   export async function pngsToZip(pngs: Buffer[]): Promise<Blob> {
     const zip = new JSZip()
     pngs.forEach((png, i) => {
       const name = `slide-${String(i + 1).padStart(2, '0')}.png`
       zip.file(name, png, { compression: 'STORE' }) // PNG 已压缩,跳二次 deflate
     })
     return zip.generateAsync({ type: 'blob' })
   }
   ```
   - 单测:断 zip header + 内含 `slide-01.png ... slide-NN.png`
4. 新建 `packages/creator/src/export/download.ts`:
   ```ts
   export function triggerDownload(blob: Blob, filename: string): void {
     const url = URL.createObjectURL(blob)
     const a = document.createElement('a')
     a.href = url; a.download = filename
     document.body.appendChild(a)
     a.click()
     a.remove()
     setTimeout(() => URL.revokeObjectURL(url), 0)
   }
   ```
   - 单测:mock createObjectURL + click,断 a.download = filename + revoke 被调

**验证方法**:
- `pnpm -F @big-ppt/creator vitest run src/export/__tests__/to-pdf.test.ts src/export/__tests__/to-pptx.test.ts src/export/__tests__/to-png-zip.test.ts`
- 手测:dev mode console 跑 `pngsToPdf([fakePng])` + 自动 download → open 看视觉

**风险**:
- jsPDF 3.x API 跟 2.x 有差异(`output('blob')` 行为),写代码时实测当前安装版本
- pptxgenjs `write({outputType: 'blob'})` 浏览器内返 Blob,**node 单测**用 `outputType: 'nodebuffer'` 或在 jsdom 下显式 mock — 单测策略选 jsdom env 用浏览器 API
- jszip generateAsync 返的 blob type 是 `application/zip`,FYI;**不需要**显式设
- pptxgenjs 文件大:每页 PNG base64 + xml 内联,N=20 页可能产物 30MB+,FYI(预案 5)

**工时**:1.5d(并行 3 agent 各 0.5d)

---

### Task 30-C:`useExport` orchestration + ExportModal + 顶栏按钮 + E2E + roadmap 校准(1d)

**目的**:用户视角的同步导出 UX 全闭环 + 端到端验真 + roadmap 同步。

**操作**:
1. 新建 `packages/creator/src/composables/useExport.ts`:
   ```ts
   export function useExport() {
     const exporting = ref(false)
     const error = ref<string | null>(null)
     const progress = ref<{ done: number; total: number } | null>(null)

     async function exportDeck(
       deck: { id: number; title: string; markdown: string; templateId: string; totalPages: number },
       format: 'pdf' | 'png-zip' | 'pptx',
     ) {
       exporting.value = true; error.value = null; progress.value = { done: 0, total: deck.totalPages }
       try {
         const pngs = await capturePages({
           deckId: deck.id,
           markdown: deck.markdown,
           templateId: deck.templateId,
           totalPages: deck.totalPages,
           onProgress: (done, total) => { progress.value = { done, total } },
         })
         let blob: Blob; let ext: string; let mime: string
         if (format === 'pdf') { blob = await pngsToPdf(pngs); ext = 'pdf'; mime = 'application/pdf' }
         else if (format === 'pptx') { blob = await pngsToPptx(pngs); ext = 'pptx'; mime = '...' }
         else { blob = await pngsToZip(pngs); ext = 'zip'; mime = 'application/zip' }
         const filename = `${deck.title.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.${ext}`
         triggerDownload(blob, filename)
       } catch (e) {
         error.value = e instanceof Error ? e.message : String(e)
         throw e
       } finally {
         exporting.value = false
         progress.value = null
       }
     }
     return { exporting, error, progress, exportDeck }
   }
   ```
2. 新建 `packages/creator/src/components/ExportModal.vue`:
   - Props `open: boolean` / `deck: { id, title, markdown, templateId, totalPages }` / emit `update:open`
   - antdv-next `<Modal>` 包 radio group(PDF / PNG 序列 zip / PPTX)+ 时间预估提示 "PDF ≈ 12s / PNG ≈ 10s / PPTX ≈ 15s · 同步导出请保持页面打开"
   - confirm 按钮:调 `useExport().exportDeck(deck, format)`,loading 期间禁用按钮 + spinner + 进度文本 `第 ${progress.done}/${progress.total} 页`
   - 错误态:modal 内显示红色 error 文本 + retry 按钮(再调一次 exportDeck)
   - 关闭按钮:loading 期间 disable(防中断 + 用户认知混乱)
   - 成功后 200ms 内自动关 modal
3. 改 `packages/creator/src/components/DeckEditorCanvas.vue`:
   - script 加 `const showExport = ref(false)`
   - 顶栏「设置」按钮左加:
     ```vue
     <button class="icon-btn" title="导出" aria-label="导出"
             @click="showExport = true">
       <Download :size="18" :stroke-width="1.8" />
     </button>
     ```
   - 模板末尾加 `<ExportModal v-model:open="showExport" :deck="exportDeckPayload" />`
   - 计算 `exportDeckPayload`:从当前 deck 组装 `{ id, title, markdown: slideStore.content, templateId: deck.templateId, totalPages: slideStore.totalPages }`
4. 加单测 `packages/creator/src/composables/__tests__/useExport.test.ts`:
   - mock capture-pages + 三个 converter
   - 断 happy path 调用顺序 + filename 清理(`/` → `_`)+ triggerDownload 被调
   - 错误 case(capture-pages 抛 / converter 抛)断 error.value 设值
5. 加单测 `packages/creator/src/components/__tests__/ExportModal.test.ts`:
   - mount + 切 radio + 点 confirm,断 useExport.exportDeck 被调 with format
   - progress 更新时显示对应文本
   - loading 态下 close 按钮 disabled
6. 加 E2E `packages/e2e/tests/export-pdf.spec.ts`:
   - 复用 helpers/login.ts → 拉一份固定 fixture deck(playwright 全局 setup 建或本测内现造)
   - 点导出 → 选 PDF → confirm → `page.waitForEvent('download', { timeout: 30_000 })` → `download.saveAs(...)` → `fs.statSync().size > 10_000`
7. 加 E2E `packages/e2e/tests/export-pptx.spec.ts`:同上 PPTX(size > 100_000)
8. 改 `docs/requirements/roadmap.md` Phase 14:
   - 验收条件已在本 commit 同步(见 roadmap 段落)

**验证方法**:
- `pnpm -F @big-ppt/creator vitest run src/composables/__tests__/useExport.test.ts src/components/__tests__/ExportModal.test.ts`
- `pnpm -F @big-ppt/e2e test --grep export`
- 手测:`pnpm dev` → 登录 → 打开 deck → 点顶栏「导出」 → 选 PDF → confirm → 浏览器下载条出现 PDF → 打开看视觉一致 + 含 AI 出图页(`image-content` layout / OSS 大图)看图完整无裂

**风险**:
- E2E `page.waitForEvent('download')` 在 CI headless 环境跟 headed 不同,playwright config 必须 `acceptDownloads: true`(默认就是 true 但确认)
- 用户关闭 modal 期间 capture-pages 仍在跑 — 本设计禁用 close 按钮防中断;若用户硬刷新页面,client 进程被杀,无副作用(无 backend state)
- Modal 与 antdv-next Teleport 边界:VueTestUtils 不跨 Teleport(CLAUDE.md 已知坑),单测加 `attachTo: document.body` + `disableTeleport` 兜底

**工时**:1d

---

## 验收条件(roadmap.md Phase 14 清单映射)

- [ ] **PDF 导出耗时 < 20 秒,视觉与预览一致**:E2E `export-pdf.spec.ts` 跑绿;视觉一致靠人眼对比 + 关键 deck 4 个 layout 全覆盖手测
- [ ] **AI 出图页截图必须等 img onload 完整**:Task A `wait-stable.ts` 单测 + 手测一张 `*-image-content` 页(OSS 大图 ≥ 1MB)导出 PDF,放大查看图片完整无裂缝
- [ ] 三种格式(PDF / PNG 序列 / PPTX)均能产生 blob 触发 download,本地手测一遍
- [ ] 编辑器顶栏「导出」按钮存在,modal 内三选一 radio + 时间预估提示 + 进度条
- [ ] 全量回归(`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿)
- [ ] creator coverage 门槛维持(lines 75 / branches 65)

---

## 不做什么(范围围栏)

- ❌ 导出历史记录表 + 重新下载(留 Phase 17+)
- ❌ 异步任务队列 / jobId polling(同步 modal 已满足 20s 内场景)
- ❌ **server-side puppeteer / chromium**(不装 / 不部署 / 不占服务器内存)
- ❌ PPTX 内文本可编辑 / layout-aware 转换(PNG 全幅嵌入版即可)
- ❌ 像素级视觉 diff E2E(本 Phase 靠人眼 + size 兜底,未来视稳定性引入)
- ❌ 自定义导出比例 / 单页导出 / 范围导出(全 deck 一刀切)
- ❌ 删除 `SlidePreview.vue` 已有「导出 .md」按钮(开发者快路径保留)
- ❌ backend 加新 route / db schema 变更(本 Phase 完全 client-side)

---

## 踩坑预案(实施前预告;实施期发现新坑回写"踩坑与解决")

> 跨 Phase 还会再撞的工具链 / 浏览器 API 坑,精炼版预告。详见对应 CLAUDE.md「已知坑」格式。

### 预案 1:跨域 tainted canvas(已确认不存在风险)

- **结论**:Lumideck **不用 OSS**,AI 生成图存 MySQL MEDIUMBLOB,通过 `GET /api/assets/:id` 同源返字节。html2canvas 截图无跨域问题,直接 `toBlob()` 安全。
- 留这条预案是因 plan 起初误判,提醒未来若**真的引入 CDN / OSS**(如 Phase 17+ 性能优化)再重新评估

### 预案 2:html2canvas 截 chart.js canvas 元素白屏

- **预期症状**:导出 PDF 含 `<BarChart>` / `<LineChart>` 的页面,chart 部分白屏 / 缺失
- **根因**:html2canvas 默认不深入 `<canvas>` 元素内容 — chart.js render 在 canvas pixel buffer,html2canvas 只能 capture canvas 的 toDataURL(若 chart.js 没 export 完 = 截到空)
- **预防**:html2canvas options `canvas: ..., onclone: (doc) => { /* 在 clone DOM 里手动重画 chart */ }` 比较麻烦;**更稳**走 `foreignObjectRendering: true`(慢但兼容好);或 capture-pages 内截图前 await `chart.update()` 完成(检查 chart.js 是否 export render-done event)。Task A 实施时 spike,若 chart 截不到改用 chart.js 的 `toBase64Image()` 替换 chart canvas

### 预案 3:Vue 响应式 props 不触发 ExportRenderer re-render

- **预期症状**:capture-pages loop 内 `instance.pageIndex = i` 设值但 DeckRenderer 仍显示第一页
- **根因**:`instance.xxx = i` 不一定走 Vue 响应式 — 要么 props 不是 reactive,要么 ExportRenderer 没把 pageIndex 当 prop 暴露
- **预防**:ExportRenderer 用 `defineProps<{pageIndex: number}>()` 标准 props,capture-pages 内**重新 mount**(`app.unmount()` + 新 app 用新 pageIndex)而不是改 instance state;或用 reactive object pass-by-reference 确保 Vue 监听到

### 预案 4:Modal 在 loading 期 capture-pages 隐藏 ExportRenderer 被卸载

- **预期症状**:导出过程中 modal 内 ExportRenderer 被 v-if 卸载,capture-pages loop 抛 `el is null`
- **根因**:ExportModal 内 `v-if="open"` 控制 modal,close 时所有子组件卸载;但 capture-pages 应该用 createApp + 独立 mount 到 document.body,**不**走 modal 的 v-if 树
- **预防**:capture-pages 内部走 `createApp` + `document.body.appendChild`,完全脱离 modal 组件树;modal 只控制 UX 显示,生命周期解耦

### 预案 5:pptxgenjs 大 deck 产物 > 20MB 导致 download 卡

- **预期症状**:PPTX 文件下载到 20MB 时浏览器内存占用飙升,某些用户 IE/老 Chrome 卡死
- **根因**:pptxgenjs 把每张 PNG base64 inline 进 XML,N=20 页 × 1.5MB PNG × 1.33 base64 ≈ 40MB
- **预防**:capture-pages scale 2× → 检查产物 size,若 PPTX > 20MB 把 scale 降到 1.5 重测;dogfood 期不修,等大 deck 复现再优化(Phase 14 close 时观察)

### 预案 6:subagent-driven 并行 Task A/B 共享 worktree 撞 git index

- **关联 CLAUDE.md 已知坑**:Phase 13 踩坑 2 commit `0c4bb8a` 道歉文
- **预防**:本 Phase Task A / B 标记可并行,但**必须用 git worktree**(`superpowers:using-git-worktrees` skill);Task C 串行无此风险

### 预案 7:html2canvas 字体 race(`document.fonts.ready` 不够)

- **预期症状**:导出 PDF 内字体 fallback 到系统默认,跟编辑器内显示不一致
- **根因**:`document.fonts.ready` resolve 后,某些异步 font face 仍可能在 reflow 阶段加载(Chrome 罕见)
- **预防**:wait-stable 第 5 条 500ms settle 兜底;若复现,延长 settle 到 1000ms,或加 `await Promise.all([...document.fonts].map(f => f.loaded))`

### 预案 8:Aliyun RDS prepared-statement stale plan 不影响本 Phase

- **关联 CLAUDE.md 已知坑**:test setup `TRUNCATE` → `DELETE FROM`(Phase 13 已落地)
- **预防**:本 Phase 不动 DB / 后端,无此风险

---

## 执行期偏离(2026-05-18 close)

> 实施跟 plan 草案的差异,记录"为什么不照 plan 写"。

### 偏离 #1:Plan 写"antdv-next `<Modal>`",实施改用项目自有 `.modal-overlay` Teleport 模式

- Why:grep `packages/creator/src/components/` 发现 **零** 个文件用 antdv `a-modal` / `<Modal>`;SettingsModal / AssetManagerPanel / TemplatePickerModal 全部走 `.modal-overlay` + Teleport 自定义结构。ExportModal 沿用同款保证视觉一致 + token 命名统一(`--color-bg-elevated` / `--color-accent-soft`)+ 单测套路一致(`attachTo: document.body` + `document.querySelector`)
- 影响:无功能差;新增 modal 跟现有 3 个 modal 一致

### 偏离 #2:Plan 写 capture-pages 用 `createApp + propsObj` 设 pageIndex,实施改用 **reactive ref + render-host wrapper**

- Why:Plan 直接 `createApp(Component, propsObj)` 后 `propsObj.pageIndex = i` 不触发 Vue 响应式 re-render(predict 3 已警告);实施引入小 host 组件 `defineComponent({ setup: () => () => h(ExportRenderer, { pageIndex: pageIndexRef.value }) })`,内部读 reactive ref → 改 ref 触发 host re-render → ExportRenderer pageIndex prop 跟着切
- 影响:正向 — 比"每页 unmount + 新 mount"省 N-1 次 mount 开销(N=20 累计可达 ~10s);响应式语义跟 Vue 框架对齐(不依赖 createApp 第二参的传 props 语义)

### 偏离 #3:Task A 装了 `buffer` polyfill 包(plan 没明说)

- Why:creator 是 DOM-only tsconfig(无 `@types/node`),`capture-pages.ts` 返 `Buffer[]` 接口需要 Buffer constructor + 把 PNG 字节包出来;`Task B` 的 converter `.toString('base64')` 也依赖。Task A 提前装 dep。**测试约定**:断言用 `instanceof Uint8Array` 而**不**是 `Buffer.isBuffer()`(node 原生 Buffer 跟 polyfill Buffer 是不同 class,`isBuffer()` 互不识别,踩了一次)
- 影响:+1 dep(`buffer@^6.0.3` 小体积 ESM 包);Task B/C 沿用一致

### 偏离 #4:Task C **跨范围**修了 Task A 的 capture-pages.ts(critical bug 解除)

- Why:Task C E2E PDF 跑完用 `pdftoppm` 转 PNG 验视觉,发现所有 layouts 全白 — 根因是 `createApp(Host)` 起的 Vue app **不继承** main app 的 component 注册(unplugin-vue-components 注册的 layouts / 公共组件全找不到)。Task A 当初测试 mock 掉 ExportRenderer 没暴露这个真路径偏离。
- controller 决定 pragmatic > strict scope:跨范围加 `registerDeckRendererComponents(app)` 1 行 + 单测 case verify register 被调,在 Task C fix commit(`6634a7c`)内一并修。**production 全白 bug 解除**(verify:pdftoppm 看 5 layouts 真渲染对)

### 偏离 #5:0 页边界 guard 放 useExport 不放 converter layer

- Why:Plan 写 to-pdf/to-pptx/to-png-zip layer 默认静默返空 blob(defensive),但 UI 入口 useExport 必须 throw `new Error('deck 无可导出页面')`让用户看到 error。converter layer 保留 silent defensive 是合理 layered architecture(底层不知道 UI 想怎么 surface),guard 放 UI 入口

---

## 踩坑与解决(2026-05-18 close)

### 坑 1:Slidev export 图片 onload race → 我们用 `waitForRenderStable` 5 条 settle

- **症状**:用户直接 dogfood Slidev 自带 `slidev export` 经常截到加载一半的 OSS 大图,导出 PDF 内 AI 出图页有半截图 / 裂缝
- **根因**:Slidev export 走 puppeteer + 简单 `wait-for-network-idle`,但 img onload 不发新流量(decode 完成才触发 load event,这段时间 network idle)
- **修复**:client-side 截图前 `waitForRenderStable(el)` 5 条同步等:`img.complete && naturalWidth > 0`(单图 10s 兜底 + clearTimeout) + `document.fonts.ready` + `el.getAnimations({subtree:true}).finished` + 2×`requestAnimationFrame`(让 ResizeObserver 写 CSS var) + 500ms settle
- **防再犯**:把 `waitForRenderStable` 提到 `packages/creator/src/export/wait-stable.ts` 独立 helper,所有截图前必调;6 单测+1 回归覆盖各 stable 条件;CLAUDE.md 已写「`setTimeout`/`setInterval` 必清理」,实施中曾漏 clearTimeout 被 code reviewer catch + fix

### 坑 2:`createApp(Host)` 不继承 main app 的全局组件注册 → 截图全白 layouts

- **症状**:Task C E2E PDF / PPTX 产物 size > 阈值但 `pdftoppm` 看到所有页全白(starter deck 5 个 layouts 一个都没渲染出)
- **根因**:Vue 3 `createApp(Component)` 每次创建**完全独立**的 app instance,**不继承** main app 调过的 `app.component(name, def)` 全局注册。`DeckRenderer` 用 `<component :is="slide.layout">` 动态查找 `beitou-cover` / `jingyeda-content` 等 layouts,compileBody 的 body markdown 还含 `<TwoCol>` / `<BarChart>` 等公共组件 — 全靠 `main.ts` 调 `registerDeckRendererComponents(app)` 注册。新 app 没调 → 全 unresolved → 渲染空
- **修复**:`capture-pages.ts` 起 app 后立刻调 `registerDeckRendererComponents(app)`,镜像 `main.ts` 流程(1 行 import + 1 行调用)
- **防再犯**:1)单测加 case 用 `vi.mock` 拦截 + `vi.spyOn` 断言 `registerDeckRendererComponents` 被调一次 / 接 Vue App 实例;2)CLAUDE.md「已知坑 → 测试基建」段提炼通用规则(任何用 `createApp` 起独立 Vue app 实例做 SSR / 截图 / preview 时,必须手动调注册函数。这种 bug 单测如果 mock 掉真组件就永远暴露不出来 — **必须有真路径 E2E 视觉 verify**)

### 坑 3:`buffer` polyfill 跟 node 原生 Buffer 是不同 class,`Buffer.isBuffer()` 互不识别

- **症状**:Task A 单测 `expect(Buffer.isBuffer(pngs[0])).toBe(true)` 失败,但 `pngs[0]` 确实是 Buffer 实例
- **根因**:`creator` 是 DOM-only tsconfig 没装 `@types/node`,用 `buffer` polyfill 包(`^6.0.3`)提供 Buffer 类。这个 class 跟 Node global 的 Buffer 是不同 class 实例,`Buffer.isBuffer(x)` 内部走 `instanceof Buffer` 检查 — polyfill 的 Buffer instance 不是 Node Buffer 的 instance,所以判 false
- **修复**:测试断言用 `instanceof Uint8Array`(Buffer 继承 Uint8Array,两套实现都满足)
- **防再犯**:CLAUDE.md「已知坑」可以加一条「buffer polyfill 跨 node/browser 时,断言用 `instanceof Uint8Array` 不用 `Buffer.isBuffer()`」

---

## 测试数量落地(2026-05-18 close)

| 指标                  | 起点(Phase 13 结束) | 终点(Phase 14 结束) | 增量 |
| --------------------- | -------------------- | -------------------- | ---- |
| creator unit cases    | 260                  | 305                  | +45  |
| creator test files    | 30                   | 35                   | +5   |
| E2E specs(export 类) | 1(`export-md`)      | 3(+`export-pdf` +`export-pptx`)| +2 |
| coverage lines        | 维持 75%+ 门槛       | 维持                 | -    |
| coverage branches     | 维持 65%+ 门槛       | 维持                 | -    |

**Phase 14 commit chain**(由旧到新,7 commit):

| SHA | 内容 |
| --- | ---- |
| `eadc768` | feat(phase14-A): waitForRenderStable + ExportRenderer + capturePages 客户端截图基建 |
| `62a0eef` | fix(phase14-A): code review 4 issues — slide-canvas 全屏 override + timer leak + vi.mock 静态 import + dead code |
| `d4f252d` | feat(phase14-B): 三种 client-side 格式 converter (PDF/PPTX/PNG-zip) + download helper |
| `fdeb925` | fix(phase14-B): code review issues — pdf 测试真测 pngsToPdf + pptx blob runtime guard + media count 严格 |
| `bbc477c` | feat(phase14-C): ExportModal + useExport + 顶栏按钮 + E2E happy path |
| `6634a7c` | fix(phase14-C): capture-pages 注册组件 (修导出全白 production bug) + Modal setTimeout cleanup |
| `c0037af` | fix(phase14-A): wait-stable.test 加 document.fonts afterEach 复位 (final audit hygiene) |

**实施总工时**:plan 估 7d,实际(subagent-driven-development 流程 + 多轮 review fix)wall-clock 约 **5h**(controller + 3 fresh implementer + 6 reviewer 轮次)。比传统单线程实施快 ~10x,review 严格度更高。
