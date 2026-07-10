import type { LivePresentationInfo, PresentationSnapshot } from '@big-ppt/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveShareModal from './LiveShareModal.vue'

const getDeckLivePresentation = vi.fn()
const startDeckLivePresentation = vi.fn()
const updateDeckLivePresentation = vi.fn()
const endDeckLivePresentation = vi.fn()

vi.mock('../api/live-presentation', () => ({
  getDeckLivePresentation: (...args: unknown[]) => getDeckLivePresentation(...args),
  startDeckLivePresentation: (...args: unknown[]) => startDeckLivePresentation(...args),
  updateDeckLivePresentation: (...args: unknown[]) => updateDeckLivePresentation(...args),
  endDeckLivePresentation: (...args: unknown[]) => endDeckLivePresentation(...args),
}))

const info: LivePresentationInfo = {
  token: 'live-token',
  path: '/live/live-token',
  createdAt: '2026-07-10T00:00:00.000Z',
  expiresAt: '2026-07-10T08:00:00.000Z',
}

const snapshot: PresentationSnapshot = { page: 1, blackout: 'none', drawings: {} }

function bodyButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`)
  return button
}

describe('LiveShareModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getDeckLivePresentation.mockReset().mockResolvedValue(null)
    startDeckLivePresentation.mockReset().mockResolvedValue(info)
    updateDeckLivePresentation.mockReset().mockResolvedValue(2)
    endDeckLivePresentation.mockReset().mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('创建直播链接并按顺序节流发布演讲者状态', async () => {
    const wrapper = mount(LiveShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 7, deckTitle: 'Roadmap', snapshot },
    })
    await flushPromises()
    bodyButton('开始直播').click()
    await flushPromises()

    expect(startDeckLivePresentation).toHaveBeenCalledWith(7, snapshot)
    expect(
      document.body.querySelector<HTMLInputElement>('input[aria-label="直播观看链接"]')?.value,
    ).toContain('/live/live-token')
    expect(wrapper.emitted('update:active')?.at(-1)).toEqual([true])

    await wrapper.setProps({
      snapshot: {
        page: 2,
        blackout: 'black',
        drawings: {
          2: [
            {
              id: 'stroke-1',
              tool: 'pen',
              color: '#ef4444',
              width: 4,
              points: [{ x: 10, y: 20 }],
            },
          ],
        },
      },
    })
    await vi.advanceTimersByTimeAsync(80)
    await flushPromises()
    expect(updateDeckLivePresentation).toHaveBeenCalledWith(
      7,
      'live-token',
      expect.objectContaining({ page: 2, blackout: 'black' }),
    )

    wrapper.unmount()
  })

  it('恢复现有直播并只结束当前令牌对应的会话', async () => {
    getDeckLivePresentation.mockResolvedValue(info)
    const wrapper = mount(LiveShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 8, deckTitle: 'Demo', snapshot },
    })
    await flushPromises()
    expect(document.body.textContent).toContain('直播中')
    expect(wrapper.emitted('update:active')?.at(-1)).toEqual([true])

    bodyButton('结束直播').click()
    await flushPromises()
    expect(endDeckLivePresentation).toHaveBeenCalledWith(8, 'live-token')
    expect(wrapper.emitted('update:active')?.at(-1)).toEqual([false])
    expect(document.body.textContent).toContain('未开始')

    wrapper.unmount()
  })

  it('临时网络失败后自动退避重试最新状态', async () => {
    updateDeckLivePresentation
      .mockRejectedValueOnce(new Error('network offline'))
      .mockResolvedValueOnce(3)
    const wrapper = mount(LiveShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 10, deckTitle: 'Retry', snapshot },
    })
    await flushPromises()
    bodyButton('开始直播').click()
    await flushPromises()

    await wrapper.setProps({ snapshot: { page: 2, blackout: 'none', drawings: {} } })
    await vi.advanceTimersByTimeAsync(80)
    await flushPromises()
    expect(updateDeckLivePresentation).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('network offline')

    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(updateDeckLivePresentation).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain('network offline')

    wrapper.unmount()
  })
})
