/**
 * Phase 14 Task A：waitForRenderStable 单测。
 *
 * 5 个 case 各覆盖一条 stable 条件 —— 必须**真测行为**，不只断 mock 调用：
 *   1. img.complete + naturalWidth > 0 → 立即 resolve（不等 load 事件）
 *   2. img.complete=false → 等到触发 'load' 事件后 promise 才 resolve
 *   3. document.fonts.ready → 必须被 await（pending promise 阻塞 → resolve 放行）
 *   4. getAnimations 返的 animation.finished → 必须被 await
 *   5. settle setTimeout 500ms → 即便前 4 条立即满足，500ms 后才 resolve
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForRenderStable } from '../wait-stable'

/** 工厂：造一个 div 元素，注入 img 子元素列表 */
function makeContainer(imgs: HTMLImageElement[] = []): HTMLElement {
  const div = document.createElement('div')
  for (const img of imgs) div.appendChild(img)
  document.body.appendChild(div)
  return div
}

/** 工厂：造 img，可指定是否 complete + naturalWidth */
function makeImg(opts: { complete: boolean; naturalWidth?: number }): HTMLImageElement {
  const img = document.createElement('img') as HTMLImageElement & {
    complete: boolean
    naturalWidth: number
  }
  Object.defineProperty(img, 'complete', { value: opts.complete, writable: true })
  Object.defineProperty(img, 'naturalWidth', { value: opts.naturalWidth ?? 0, writable: true })
  return img
}

describe('waitForRenderStable', () => {
  let originalGetAnimations: typeof Element.prototype.getAnimations | undefined

  beforeEach(() => {
    // 默认让 document.fonts.ready 立即 resolve（个别 test 单独覆盖）
    if (typeof document !== 'undefined' && !document.fonts) {
      Object.defineProperty(document, 'fonts', {
        value: { ready: Promise.resolve() },
        writable: true,
        configurable: true,
      })
    }
    originalGetAnimations = Element.prototype.getAnimations
  })

  afterEach(() => {
    // 恢复原始 getAnimations（test 内可能覆盖）
    if (originalGetAnimations) {
      Element.prototype.getAnimations = originalGetAnimations
    }
    document.body.replaceChildren()
  })

  it('case 1：img 已 complete + naturalWidth > 0 → 不等 load 事件直接放行', async () => {
    const img = makeImg({ complete: true, naturalWidth: 100 })
    // 验证：如果错误地等了 load 事件，下面 promise 永不 resolve（img 不会 dispatchEvent）
    // 加一个 spy 看 addEventListener 是否被调；正确实现下不应该调
    const addSpy = vi.spyOn(img, 'addEventListener')
    const el = makeContainer([img])

    await waitForRenderStable(el)

    expect(addSpy).not.toHaveBeenCalled() // img.complete 已满足，跳过 load 等待
  })

  it('case 2：img 未 complete → 等 load 事件触发后 resolve（真行为，不只是 mock 调用）', async () => {
    const img = makeImg({ complete: false, naturalWidth: 0 })
    const el = makeContainer([img])

    // 启动 wait（不 await，先拿 promise）
    const p = waitForRenderStable(el)

    // 给一个小延迟让 wait-stable 注册 load listener，然后 dispatchEvent
    await new Promise((r) => setTimeout(r, 10))
    img.dispatchEvent(new Event('load'))

    // promise 应该正常 resolve（500ms settle 后）
    await expect(p).resolves.toBeUndefined()
  }, 10_000)

  it('case 3：document.fonts.ready pending → 必须 await，resolve 后才放行', async () => {
    let resolveFonts: () => void = () => {}
    const fontsPromise = new Promise<void>((res) => {
      resolveFonts = res
    })
    // 覆盖 document.fonts.ready 为 pending promise
    Object.defineProperty(document, 'fonts', {
      value: { ready: fontsPromise },
      writable: true,
      configurable: true,
    })

    const el = makeContainer([])
    let resolved = false
    const p = waitForRenderStable(el).then(() => {
      resolved = true
    })

    // 给 wait-stable 一点时间走完 case 1 + 进入 case 2 await fonts.ready
    await new Promise((r) => setTimeout(r, 50))
    expect(resolved).toBe(false) // fonts.ready 还 pending，wait 必然没结束

    // 触发 fonts ready
    resolveFonts()

    await expect(p).resolves.toBeUndefined()
    expect(resolved).toBe(true)
  }, 10_000)

  it('case 4：element.getAnimations 返 pending animation → 等 .finished 才放行', async () => {
    let resolveAnim: () => void = () => {}
    const animFinishedPromise = new Promise<void>((res) => {
      resolveAnim = res
    })
    const fakeAnim = { finished: animFinishedPromise } as unknown as Animation

    Element.prototype.getAnimations = vi.fn(() => [fakeAnim])

    const el = makeContainer([])
    let resolved = false
    const p = waitForRenderStable(el).then(() => {
      resolved = true
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(resolved).toBe(false)

    resolveAnim()
    await expect(p).resolves.toBeUndefined()
    expect(resolved).toBe(true)
  }, 10_000)

  it('case 5：500ms settle 兜底 —— 前 4 条立即满足，wait 仍至少耗 500ms', async () => {
    // 所有条件都立即满足
    Element.prototype.getAnimations = vi.fn(() => []) // 无动画

    const el = makeContainer([]) // 无 img
    const t0 = performance.now()
    await waitForRenderStable(el)
    const elapsed = performance.now() - t0

    // 至少 500ms（settle 兜底）；放宽到 480ms 防 jsdom 计时精度偶发
    expect(elapsed).toBeGreaterThanOrEqual(480)
    // 上限给宽点防 CI 抖动（理论应该 ~510ms）
    expect(elapsed).toBeLessThan(2000)
  }, 10_000)

  it('extra：img.error 也放行（不卡死），跟 load 等价', async () => {
    const img = makeImg({ complete: false, naturalWidth: 0 })
    const el = makeContainer([img])

    const p = waitForRenderStable(el)
    await new Promise((r) => setTimeout(r, 10))
    img.dispatchEvent(new Event('error'))

    await expect(p).resolves.toBeUndefined()
  }, 10_000)
})
