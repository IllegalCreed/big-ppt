/**
 * slides-store per-deck 写串行化(2026-07 生产 dogfood)。
 *
 * 背景:image-gen worker 是 fire-and-forget + 并发限流 3。多个 worker 几乎同时收工调
 * updateSlide,而 updateSlide 是「读整份内容 → 改一页 → 写回」,读写之间无 per-deck 串行化。
 * 生产 deck#30 实测:10 个 job 全 done,但第 11 页生成的 asset 未被最终内容引用——它的写
 * 被另一个 slide 的 job 用旧快照覆盖(lost update)。本测试并发触发同款竞态,验证串行化后不丢。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { editSlides, readSlides } from '../src/slides-store/index.js'
import { runInRequest, type RequestContext } from '../src/context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { __resetImageJobsForTesting } from '../src/image-gen-job.js'

useTestDb()

function ctxOf(overrides: Partial<RequestContext>): RequestContext {
  return { userId: null, sessionId: null, activeDeckId: null, turnId: null, ...overrides }
}
function inDeck<T>(userId: number, deckId: number, fn: () => Promise<T>): Promise<T> {
  return runInRequest(ctxOf({ userId, activeDeckId: deckId }), fn) as Promise<T>
}

beforeEach(() => {
  __resetImageJobsForTesting()
})

describe('slides-store 并发写不丢更新', () => {
  it('并发 6 次 editSlides 各改一行 → 6 行全部生效(无 lost update)', async () => {
    const { user } = await createLoggedInUser()
    const N = 6
    const initial = Array.from({ length: N }, (_, i) => `line${i}`).join('\n')
    const { deck } = await createDeckDirect(user.id, 'D', initial)

    // 并发触发:每个 op 读同一初始快照 → 改自己那行 → 写回。无串行化时后写覆盖先写。
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        inDeck(user.id, deck.id, () => editSlides(`line${i}`, `line${i}DONE`)),
      ),
    )

    const final = await inDeck(user.id, deck.id, () => readSlides())
    const missing = Array.from({ length: N }, (_, i) => i).filter(
      (i) => !final.includes(`line${i}DONE`),
    )
    expect(missing, `丢失的行: ${missing.join(',')};最终内容:\n${final}`).toEqual([])
  })

  it('不同 deck 的并发写互不阻塞(锁按 deck 分区)', async () => {
    const { user } = await createLoggedInUser()
    const a = await createDeckDirect(user.id, 'A', 'a0\na1\na2')
    const b = await createDeckDirect(user.id, 'B', 'b0\nb1\nb2')
    await Promise.all([
      inDeck(user.id, a.deck.id, () => editSlides('a0', 'a0X')),
      inDeck(user.id, b.deck.id, () => editSlides('b0', 'b0X')),
      inDeck(user.id, a.deck.id, () => editSlides('a1', 'a1X')),
      inDeck(user.id, b.deck.id, () => editSlides('b1', 'b1X')),
    ])
    const fa = await inDeck(user.id, a.deck.id, () => readSlides())
    const fb = await inDeck(user.id, b.deck.id, () => readSlides())
    expect(fa).toContain('a0X')
    expect(fa).toContain('a1X')
    expect(fb).toContain('b0X')
    expect(fb).toContain('b1X')
  })
})
