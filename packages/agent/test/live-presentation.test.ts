import type { PresentationPayload, PresentationSnapshot } from '@big-ppt/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLivePresentationsForTesting,
  createLivePresentation,
  getOwnerLivePresentation,
  getPublicLiveErrorCode,
  getPublicLivePresentation,
  parseLivePresentationSnapshot,
  subscribeToLivePresentation,
  updateLivePresentation,
} from '../src/live-presentation.js'

const LIVE_TTL_MS = 8 * 60 * 60 * 1000
const TOMBSTONE_TTL_MS = 60 * 60 * 1000

const presentation: PresentationPayload = {
  deckId: 9,
  title: 'Live Test',
  templateId: 'beitou-standard',
  markdown: '---\nlayout: beitou-cover\n---\n',
  updatedAt: '2026-07-10T00:00:00.000Z',
}

function snapshot(page = 1): PresentationSnapshot {
  return { page, blackout: 'none', drawings: {} }
}

describe('live-presentation registry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'))
    __resetLivePresentationsForTesting()
  })

  afterEach(() => {
    __resetLivePresentationsForTesting()
    vi.useRealTimers()
  })

  it('8 小时后主动结束 SSE、标记 expired，并在 tombstone 窗口后回到 not-found', () => {
    const { info } = createLivePresentation({ userId: 3, presentation, state: snapshot() })
    const events: unknown[] = []
    const unsubscribe = subscribeToLivePresentation(info.token, (event) => events.push(event))
    expect(unsubscribe).not.toBeNull()
    expect(events).toEqual([expect.objectContaining({ type: 'state', revision: 1 })])

    vi.advanceTimersByTime(LIVE_TTL_MS)
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'expired' })
    expect(getOwnerLivePresentation(3, presentation.deckId)).toBeNull()
    expect(getPublicLivePresentation(info.token)).toBeNull()
    expect(getPublicLiveErrorCode(info.token)).toBe('expired')

    vi.advanceTimersByTime(TOMBSTONE_TTL_MS + 1)
    expect(getPublicLiveErrorCode(info.token)).toBe('not-found')
    unsubscribe?.()
  })

  it('隔离抛错订阅者，仍允许演讲者继续更新当前会话', () => {
    const { info } = createLivePresentation({ userId: 3, presentation, state: snapshot() })
    const broken = subscribeToLivePresentation(info.token, () => {
      throw new Error('listener failed')
    })
    expect(broken).toBeNull()
    expect(updateLivePresentation(3, presentation.deckId, info.token, snapshot(2))).toBe(2)
    expect(getPublicLivePresentation(info.token)?.state.page).toBe(2)
  })

  it('接受第 10000 页坐标，并拒绝非法颜色、额外字段和超量笔迹', () => {
    const valid = {
      page: 10_000,
      blackout: 'white',
      drawings: {
        10000: [
          {
            id: 'stroke-1',
            tool: 'highlighter',
            color: '#facc15',
            width: 24,
            points: [{ x: 1000, y: 562.5 }],
          },
        ],
      },
    }
    expect(parseLivePresentationSnapshot(valid)).toEqual(valid)
    expect(
      parseLivePresentationSnapshot({
        ...valid,
        drawings: { 1: [{ ...valid.drawings[10000][0], color: 'red' }] },
      }),
    ).toBeNull()
    expect(parseLivePresentationSnapshot({ ...valid, extra: true })).toBeNull()

    const stroke = valid.drawings[10000][0]
    const excessiveDrawings = Object.fromEntries(
      Array.from({ length: 11 }, (_, page) => [
        page + 1,
        Array.from({ length: page === 10 ? 1 : 500 }, (_, index) => ({
          ...stroke,
          id: `${page}-${index}`,
        })),
      ]),
    )
    expect(
      parseLivePresentationSnapshot({ page: 1, blackout: 'none', drawings: excessiveDrawings }),
    ).toBeNull()
  })
})
