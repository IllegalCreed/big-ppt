/**
 * Phase 14 Task A：客户端逐页截图编排。
 *
 * mount 一个隐藏的 ExportRenderer 实例到 document.body 外的 div，iterate
 * pageIndex 1..N，每页 waitForRenderStable → html2canvas → toBlob → Buffer。
 *
 * --- Vue 响应式抉择（plan 30 预案 #3）---
 * 用 **reactive ref + render-host wrapper** 而非每页重新 mount：
 * - createApp(Component, propsObj) 直接传 propsObj 时，Vue 不会把 propsObj
 *   wrap 成 reactive，事后 `propsObj.pageIndex = i` 不触发 re-render
 * - 解法：用一个小 host 组件，内部读 reactive shared state（pageIndexRef.value）
 *   render `<ExportRenderer :pageIndex="pageIndexRef.value">`；修改 ref 触发
 *   host 组件 re-render，DeckRenderer 跟着切页
 * - 比"每页 unmount + 新 mount"快得多（N=20 页省 19 次 mount 开销）；
 *   也比 reactive object 透传稳定（Vue 不依赖 createApp 第二个参数的响应式语义）
 *
 * 异常时 finally 必 unmount + remove container（防内存泄露 + 残留隐藏元素），
 * 即便 html2canvas 抛错也保证清理。
 */
import { createApp, defineComponent, h, ref, type Ref } from 'vue'
import html2canvas from 'html2canvas'
// Buffer 走 `buffer` npm 包（同时支持 Node + browser），不依赖 @types/node。
// 浏览器 bundle 自动用其 polyfill（~3KB gzipped）。Task B 的 to-pdf / to-pptx 等
// converter 用 `Buffer.toString('base64')` 也依赖这个 import。
import { Buffer } from 'buffer'
import ExportRenderer from '../components/ExportRenderer.vue'
import { waitForRenderStable } from './wait-stable'
// Phase 14 Task C fix(production bug):`createApp(Host)` 起的 Vue app instance
// **完全独立** 不继承 main app 的 component 注册。DeckRenderer 用
// `<component :is="slide.layout">` 动态查找 layouts(beitou-cover / jingyeda-*
// 等),compileBody 的 body markdown 还含 `<TwoCol>` / `<BarChart>` 等公共组件,
// 全靠 main.ts 调 `registerDeckRendererComponents(app)` 注册到全局。本文件起的
// 新 app 必须**镜像同样的注册流程**,否则所有 layout / 公共组件全找不到 →
// 渲染白页 → 导出 PDF/PPTX/ZIP 内容全白(E2E size 阈值检查照过,production 用户
// 才肉眼发现)。
import { registerDeckRendererComponents } from '../deck-renderer/register-layouts'

export interface CapturePagesOptions {
  deckId: number
  markdown: string
  templateId: string
  totalPages: number
  /** 每页截图完成后调用，给 UI 更新进度条 */
  onProgress?: (done: number, total: number) => void
}

/**
 * 构造一个 render-host 组件：内部读 reactive pageIndex ref，render
 * ExportRenderer 并 expose 它的 rootRef。返回 ref + componentInstance 句柄，
 * 供外层 loop 修改 pageIndex 触发 re-render + 读最新 rootRef。
 */
function createHostComponent(
  pageIndexRef: Ref<number>,
  baseProps: { deckId: number; markdown: string; templateId: string },
) {
  // 用一个 ref 接子组件实例（每次 re-render Vue 会更新这个 ref）
  const exportRendererRef = ref<{ rootRef: HTMLElement | null } | null>(null)

  const Host = defineComponent({
    name: 'ExportHost',
    setup() {
      return () =>
        h(ExportRenderer, {
          ref: exportRendererRef,
          deckId: baseProps.deckId,
          markdown: baseProps.markdown,
          templateId: baseProps.templateId,
          pageIndex: pageIndexRef.value,
        })
    },
  })

  return { Host, exportRendererRef }
}

export async function capturePages(opts: CapturePagesOptions): Promise<Buffer[]> {
  const { deckId, markdown, templateId, totalPages, onProgress } = opts

  // pageIndex 从 1 起，先建 reactive ref + host 组件 + 容器，mount 一次
  const pageIndexRef = ref(1)
  const { Host, exportRendererRef } = createHostComponent(pageIndexRef, {
    deckId,
    markdown,
    templateId,
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(Host)
  // 镜像 main.ts:25 的注册流程 —— 不调这步 layouts + 公共组件全部 unresolved,
  // DeckRenderer `<component :is>` 渲染空白,导出产物全白。
  registerDeckRendererComponents(app)
  app.mount(container)

  const pngs: Buffer[] = []
  try {
    for (let i = 1; i <= totalPages; i++) {
      // 切到第 i 页 → Vue 响应式触发 host re-render → ExportRenderer 切 currentPage
      pageIndexRef.value = i

      // 让出主线程 + 给 Vue 一次 flush 把 reactive 变更应用到 DOM
      await new Promise<void>((res) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => res())
        } else {
          setTimeout(() => res(), 0)
        }
      })

      // 拿到 ExportRenderer 暴露的 rootRef（即 .export-renderer div）
      const rootEl = exportRendererRef.value?.rootRef ?? null
      if (!rootEl) {
        throw new Error(`capturePages: ExportRenderer rootRef 为 null（page ${i}）`)
      }

      // 等 DOM 稳定（img / fonts / animations / 2×rAF / 500ms settle）
      await waitForRenderStable(rootEl)

      // html2canvas → canvas → blob → Buffer
      // 不走 useCORS：项目所有图片同源 `<img src="/api/assets/...">`，
      // 默认就能 toBlob 不 tainted（plan 30 抉择 #7）
      const canvas = await html2canvas(rootEl, {
        scale: 2, // 2× DPR：1920×1080 → 3840×2160，打印质量
        backgroundColor: '#fff',
        width: 1920,
        height: 1080,
        logging: false,
      })

      const blob = await new Promise<Blob>((res, rej) => {
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error(`capturePages: canvas.toBlob 返 null（page ${i}）`))),
          'image/png',
        )
      })
      const arrayBuffer = await blob.arrayBuffer()
      pngs.push(Buffer.from(arrayBuffer))

      onProgress?.(i, totalPages)

      // 每页之间让出主线程，防 N=20 页连续截图卡死 UI
      await new Promise((res) => setTimeout(res, 0))
    }
  } finally {
    // 即便上面抛错也清理：unmount Vue app + 从 DOM 移除容器
    try {
      app.unmount()
    } catch {
      /* ignore：unmount 二次或残破 instance */
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  return pngs
}
