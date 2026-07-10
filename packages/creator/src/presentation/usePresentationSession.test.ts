import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePresentationSession } from './usePresentationSession'

class FakeBroadcastChannel {
  static groups = new Map<string, Set<FakeBroadcastChannel>>()

  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    const group = FakeBroadcastChannel.groups.get(name) ?? new Set()
    group.add(this)
    FakeBroadcastChannel.groups.set(name, group)
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.groups.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent)
    }
  }

  close(): void {
    FakeBroadcastChannel.groups.get(this.name)?.delete(this)
  }
}

describe('usePresentationSession', () => {
  beforeEach(() => {
    FakeBroadcastChannel.groups.clear()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('同 deck + channel 同步页码、黑白屏和笔迹', async () => {
    const a = usePresentationSession({
      deckId: 7,
      channelId: 'channel-a',
      initialPage: 1,
      totalPages: () => 5,
    })
    const b = usePresentationSession({
      deckId: 7,
      channelId: 'channel-a',
      initialPage: 1,
      totalPages: () => 5,
    })
    await Promise.resolve()

    a.setPage(4)
    a.setBlackout('black')
    a.setStrokes(4, [{ id: 's1', tool: 'pen', color: '#f00', width: 4, points: [{ x: 1, y: 2 }] }])

    expect(b.currentPage.value).toBe(4)
    expect(b.blackout.value).toBe('black')
    expect(b.drawings.value[4]?.[0]?.id).toBe('s1')
    a.close()
    b.close()
  })

  it('新窗口通过 state-request 握手取得既有完整状态', async () => {
    const controller = usePresentationSession({
      deckId: 9,
      channelId: 'presenter',
      initialPage: 1,
      totalPages: () => 8,
    })
    await Promise.resolve()
    controller.setPage(6)
    controller.setBlackout('white')

    const lateAudience = usePresentationSession({
      deckId: 9,
      channelId: 'presenter',
      initialPage: 1,
      totalPages: () => 8,
    })
    await Promise.resolve()

    expect(lateAudience.currentPage.value).toBe(6)
    expect(lateAudience.blackout.value).toBe('white')
    controller.close()
    lateAudience.close()
  })

  it('不同 deck 或 channel 完全隔离，页码始终 clamp 到合法范围', async () => {
    const a = usePresentationSession({
      deckId: 1,
      channelId: 'one',
      initialPage: 99,
      totalPages: () => 3,
    })
    const b = usePresentationSession({
      deckId: 1,
      channelId: 'two',
      initialPage: 1,
      totalPages: () => 3,
    })
    const c = usePresentationSession({
      deckId: 2,
      channelId: 'one',
      initialPage: 1,
      totalPages: () => 3,
    })
    await Promise.resolve()

    expect(a.currentPage.value).toBe(3)
    a.setPage(-5)
    expect(a.currentPage.value).toBe(1)
    expect(b.currentPage.value).toBe(1)
    expect(c.currentPage.value).toBe(1)
    a.close()
    b.close()
    c.close()
  })
})
