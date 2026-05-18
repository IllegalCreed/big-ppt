/**
 * Phase 14 Task B：triggerDownload 单测。
 *
 * jsdom（vitest 4 默认）已实现 URL.createObjectURL / revokeObjectURL stub；
 * 用 vi.spyOn 显式拦截，断行为：
 * - createObjectURL 被调一次（传入我们给的 blob）
 * - <a> 被建出来并 click，`a.download` = filename, `a.href` = stubbed URL
 * - <a> 用完即 remove
 * - revokeObjectURL 在下一 tick 被调（用 vi.useFakeTimers 推进）
 *
 * 抉择：用 spy `document.body.appendChild` 拦截抓 <a> 实例（避免 `this`
 * aliasing 触发 @typescript-eslint/no-this-alias）。
 *
 * testing seam 复位规则（CLAUDE.md）：vitest 4 默认不 auto-restore spy，
 * afterEach 手动 mockRestore；vi.useFakeTimers / useRealTimers 每 case 内闭合。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerDownload } from '../download'

describe('triggerDownload', () => {
  let createObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn> | null = null
  let clickSpy: ReturnType<typeof vi.spyOn> | null = null
  let appendChildSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url-123')
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    // click 在 jsdom 下会触发 navigation 警告；spy 阻止真行为
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    // 拦 body.appendChild 抓刚创建的 <a>（避免 this aliasing），但仍走真实现以
    // 让后续 a.remove() 找得到
    appendChildSpy = vi.spyOn(document.body, 'appendChild')
  })

  afterEach(() => {
    createObjectURLSpy?.mockRestore()
    revokeObjectURLSpy?.mockRestore()
    clickSpy?.mockRestore()
    appendChildSpy?.mockRestore()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  /** 从 appendChild spy 取最近一次 append 的 <a> 元素 */
  function lastAppendedAnchor(): HTMLAnchorElement {
    const calls = appendChildSpy!.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const el = calls[calls.length - 1]![0] as HTMLAnchorElement
    expect(el.tagName).toBe('A')
    return el
  }

  it('正常路径：createObjectURL + click + remove + 延迟 revoke', () => {
    vi.useFakeTimers()
    const blob = new Blob(['hello'], { type: 'text/plain' })

    triggerDownload(blob, 'test.pdf')

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy).toHaveBeenCalledWith(blob)

    // click 被调一次
    expect(clickSpy).toHaveBeenCalledTimes(1)

    // click 触发后 <a> 已 remove（document.body 不应残留）
    const anchors = document.body.querySelectorAll('a')
    expect(anchors.length).toBe(0)

    // revoke 未即时调用（setTimeout 还未推进）
    expect(revokeObjectURLSpy).not.toHaveBeenCalled()

    // 推进 timer → revoke 被调
    vi.advanceTimersByTime(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url-123')
  })

  it('a.download 接收传入的 filename，a.href 是 stubbed URL', () => {
    const blob = new Blob(['x'])
    triggerDownload(blob, 'export-deck-5.pptx')

    const a = lastAppendedAnchor()
    expect(a.download).toBe('export-deck-5.pptx')
    expect(a.href).toBe('blob:fake-url-123')
  })

  it('click 前 <a> 被 append 到 body（Firefox 兼容性）', () => {
    triggerDownload(new Blob(['x']), 'a.zip')

    // appendChild 被调；click 也被调；按 triggerDownload 实现 append 必先于 click
    expect(appendChildSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const appendOrder = appendChildSpy!.mock.invocationCallOrder[0]!
    const clickOrder = clickSpy!.mock.invocationCallOrder[0]!
    expect(appendOrder).toBeLessThan(clickOrder)
  })

  it('特殊文件名（含中文 + 空格）正确赋给 a.download', () => {
    triggerDownload(new Blob(['x']), '幻光千叶 演示文稿.pdf')
    const a = lastAppendedAnchor()
    expect(a.download).toBe('幻光千叶 演示文稿.pdf')
  })
})
