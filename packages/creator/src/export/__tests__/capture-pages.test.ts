/**
 * Phase 14 Task A：capturePages 单测。
 *
 * - mock html2canvas 返 fake canvas（toBlob 返 1×1 PNG blob）
 * - mock ExportRenderer / wait-stable，避免 jsdom 下真 mount DeckRenderer
 *   及其复杂依赖（autoImport / template compiler / Layout 查找）
 * - 测 N=5 页 loop + onProgress 调用 5 次 + 异常时 cleanup（unmount + remove）
 *   仍被调
 *
 * 顶层 vi.mock factory + static import —— CLAUDE.md vitest 4 已知坑：
 * dynamic import 的 vi.mock 拦截不稳定，必须顶层 factory + static import 才稳。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Important fix（code review）：vi.mock factory 必须**同步**，且 Vue API 走顶层
// static import 才能在 factory closure 里安全用 —— CLAUDE.md 测试基建已知坑:
// "Vitest 4 起 vi.mock 对 dynamic import 拦截不稳定...改用 static import +
//  顶层 vi.mock factory `() => ({ ... })` 才稳定"。
// vi.mock 被 hoist 到所有 import 之上，但**非 mocked** 包（vue）的 static import
// 不受 hoist 影响，可以在 factory closure 里照常引用。
import { defineComponent, h, onMounted, ref } from 'vue'

// ---- html2canvas mock ----------------------------------------------------
// Fake canvas：toBlob 返一个 1 字节 Blob（arrayBuffer 返 Uint8Array([0x89])，
// 真 PNG magic byte，capture-pages 只关心 buffer 长度而非内容）
const html2canvasMock = vi.fn<(el: HTMLElement, opts?: unknown) => Promise<HTMLCanvasElement>>()
vi.mock('html2canvas', () => ({
  default: (el: HTMLElement, opts?: unknown) => html2canvasMock(el, opts),
}))

// ---- waitForRenderStable mock --------------------------------------------
// 默认立即 resolve；单 case 内可 mockResolvedValueOnce / mockRejectedValueOnce
const waitForRenderStableMock = vi.fn<(el: HTMLElement) => Promise<void>>()
vi.mock('../wait-stable', () => ({
  waitForRenderStable: (el: HTMLElement) => waitForRenderStableMock(el),
}))

// ---- ExportRenderer mock -------------------------------------------------
// jsdom 下真 mount DeckRenderer 会撞 unplugin-vue-components 没跑（layouts 找不到）。
// mock 成最简 stub 组件，只暴露一个固定 rootRef = 真 DOM div（让 html2canvas 接收
// 到 truthy element）。
vi.mock('../../components/ExportRenderer.vue', () => ({
  default: defineComponent({
    name: 'ExportRendererStub',
    props: ['deckId', 'pageIndex', 'markdown', 'templateId'],
    setup() {
      const rootRef = ref<HTMLElement | null>(null)
      onMounted(() => {
        // mount 后给 rootRef 赋值真 DOM 元素，模拟 ref 行为
        rootRef.value = document.createElement('div')
      })
      return { rootRef }
    },
    render() {
      // 用 h() 创建 DOM 元素，render 后 mount 时 ref binding 会触发
      // 这里返回根节点；setup return 的 rootRef 在 onMounted 拿到 vnode el
      return h('div', { class: 'export-renderer-stub' })
    },
  }),
}))

// ---- import 被测体（static import + mock 已就位） ------------------------
import { capturePages } from '../capture-pages'

/** 工厂：fake canvas + toBlob 返 1-byte blob */
function makeFakeCanvas(): HTMLCanvasElement {
  return {
    toBlob: (cb: (blob: Blob | null) => void) => {
      // 1 字节 fake PNG header
      const blob = new Blob([new Uint8Array([0x89])], { type: 'image/png' })
      cb(blob)
    },
  } as unknown as HTMLCanvasElement
}

describe('capturePages', () => {
  beforeEach(() => {
    html2canvasMock.mockReset()
    html2canvasMock.mockResolvedValue(makeFakeCanvas())
    waitForRenderStableMock.mockReset()
    waitForRenderStableMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    // 清理：所有 test 后 document.body 不该残留 capturePages 的 container
    document.body.replaceChildren()
  })

  it('N=5 页：loop 5 次 → 返 5 个 Buffer + onProgress 调 5 次', async () => {
    const onProgress = vi.fn()
    const pngs = await capturePages({
      deckId: 7,
      markdown: '# fake',
      templateId: 'beitou-standard',
      totalPages: 5,
      onProgress,
    })

    expect(pngs).toHaveLength(5)
    pngs.forEach((buf) => {
      // capture-pages 用 `buffer` polyfill 包的 Buffer（浏览器兼容），
      // 跟 Node 全局 Buffer 不是同一类；用 Uint8Array 这个共同祖先做断言
      expect(buf).toBeInstanceOf(Uint8Array)
      expect(buf.length).toBe(1) // 1-byte fake PNG
    })

    expect(html2canvasMock).toHaveBeenCalledTimes(5)
    expect(waitForRenderStableMock).toHaveBeenCalledTimes(5)
    expect(onProgress).toHaveBeenCalledTimes(5)
    // onProgress 调用序列：(1,5), (2,5), ..., (5,5)
    expect(onProgress.mock.calls).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ])
  })

  it('N=1 页：单页 loop（最小边界）', async () => {
    const pngs = await capturePages({
      deckId: 1,
      markdown: '# fake',
      templateId: 'beitou-standard',
      totalPages: 1,
    })

    expect(pngs).toHaveLength(1)
    expect(html2canvasMock).toHaveBeenCalledTimes(1)
  })

  it('totalPages=0：loop 不进入，返空数组（不该抛）', async () => {
    const pngs = await capturePages({
      deckId: 1,
      markdown: '# fake',
      templateId: 'beitou-standard',
      totalPages: 0,
    })

    expect(pngs).toHaveLength(0)
    expect(html2canvasMock).not.toHaveBeenCalled()
  })

  it('onProgress 可选：未传时不抛', async () => {
    await expect(
      capturePages({
        deckId: 1,
        markdown: '# fake',
        templateId: 'beitou-standard',
        totalPages: 2,
      }),
    ).resolves.toHaveLength(2)
  })

  it('html2canvas 抛错 → 异常向上传播 + container 仍被清理（finally 跑）', async () => {
    html2canvasMock.mockRejectedValueOnce(new Error('html2canvas boom'))

    const containersBefore = document.body.children.length

    await expect(
      capturePages({
        deckId: 1,
        markdown: '# fake',
        templateId: 'beitou-standard',
        totalPages: 3,
      }),
    ).rejects.toThrow('html2canvas boom')

    // 异常后 document.body 应该被清空（capturePages 自己的 container 移除）
    expect(document.body.children.length).toBe(containersBefore)
  })

  it('waitForRenderStable 抛错 → 异常向上传播 + 清理', async () => {
    waitForRenderStableMock.mockRejectedValueOnce(new Error('wait boom'))

    const containersBefore = document.body.children.length

    await expect(
      capturePages({
        deckId: 1,
        markdown: '# fake',
        templateId: 'beitou-standard',
        totalPages: 3,
      }),
    ).rejects.toThrow('wait boom')

    expect(document.body.children.length).toBe(containersBefore)
  })

  it('canvas.toBlob 返 null → 抛带 page 号的错', async () => {
    const badCanvas = {
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement
    html2canvasMock.mockResolvedValueOnce(badCanvas)

    await expect(
      capturePages({
        deckId: 1,
        markdown: '# fake',
        templateId: 'beitou-standard',
        totalPages: 2,
      }),
    ).rejects.toThrow(/toBlob 返 null.*page 1/)
  })

  it('html2canvas 收到 1920×1080 + scale 2 + backgroundColor white（截图参数契约）', async () => {
    await capturePages({
      deckId: 1,
      markdown: '# fake',
      templateId: 'beitou-standard',
      totalPages: 1,
    })

    expect(html2canvasMock).toHaveBeenCalledTimes(1)
    const call = html2canvasMock.mock.calls[0]
    expect(call).toBeDefined()
    const opts = call![1] as Record<string, unknown>
    expect(opts).toMatchObject({
      width: 1920,
      height: 1080,
      scale: 2,
      backgroundColor: '#fff',
      logging: false,
    })
  })

  it('pageIndex 递增：waitForRenderStable 收到每页的 rootEl（每页都被等）', async () => {
    // 每次 waitForRenderStable 调用记录其传入的 element
    const els: HTMLElement[] = []
    waitForRenderStableMock.mockImplementation(async (el: HTMLElement) => {
      els.push(el)
    })

    await capturePages({
      deckId: 1,
      markdown: '# fake',
      templateId: 'beitou-standard',
      totalPages: 3,
    })

    expect(els).toHaveLength(3)
    els.forEach((el) => expect(el).toBeInstanceOf(HTMLElement))
  })
})
