import { describe, expect, it } from 'vitest'
import {
  getRequestContext,
  runInRequest,
  runInTurn,
  setActiveDeckId,
  setTurnId,
} from '../src/context.js'

describe('context (AsyncLocalStorage)', () => {
  it('ALS 外调用 getRequestContext 返回 EMPTY', () => {
    const ctx = getRequestContext()
    expect(ctx).toEqual({
      userId: null,
      sessionId: null,
      activeDeckId: null,
      turnId: null,
    })
  })

  it('runInRequest 内部 getRequestContext 返回传入值', () => {
    const result = runInRequest(
      { userId: 5, sessionId: 's1', activeDeckId: 7, turnId: 'turn-a' },
      () => getRequestContext(),
    ) as ReturnType<typeof getRequestContext>
    expect(result).toMatchObject({ userId: 5, sessionId: 's1', activeDeckId: 7, turnId: 'turn-a' })
  })

  it('嵌套 runInRequest：内外上下文互不影响', () => {
    let inner: ReturnType<typeof getRequestContext> | null = null
    let afterInner: ReturnType<typeof getRequestContext> | null = null
    runInRequest({ userId: 1, sessionId: 'outer', activeDeckId: null, turnId: null }, () => {
      runInRequest({ userId: 2, sessionId: 'inner', activeDeckId: 99, turnId: 'inner-turn' }, () => {
        inner = getRequestContext()
      })
      afterInner = getRequestContext()
    })
    expect(inner).toMatchObject({ userId: 2, sessionId: 'inner', activeDeckId: 99 })
    expect(afterInner).toMatchObject({ userId: 1, sessionId: 'outer', activeDeckId: null })
  })

  it('setTurnId 生效后当前 request 读到新值，且不污染外层 / 其他 request', () => {
    // 注意：getRequestContext 返回的是 store 原对象引用，setTurnId 是 in-place mutate，
    // 所以同一个 run 内 "before/after" 拿的是同一引用——验证目标换成 "生效 + 不跨 run"。
    runInRequest({ userId: 1, sessionId: 's', activeDeckId: null, turnId: null }, () => {
      expect(getRequestContext().turnId).toBeNull()
      setTurnId('T1')
      expect(getRequestContext().turnId).toBe('T1')
    })
    // ALS 外部无状态
    expect(getRequestContext().turnId).toBeNull()
    // 新的 runInRequest 拿到全新 store（turnId 不会残留 T1）
    runInRequest({ userId: 2, sessionId: 's2', activeDeckId: null, turnId: null }, () => {
      expect(getRequestContext().turnId).toBeNull()
    })
  })

  it('setActiveDeckId 原地改当前 store', () => {
    runInRequest({ userId: 1, sessionId: 's', activeDeckId: null, turnId: null }, () => {
      expect(getRequestContext().activeDeckId).toBeNull()
      setActiveDeckId(42)
      expect(getRequestContext().activeDeckId).toBe(42)
      setActiveDeckId(null)
      expect(getRequestContext().activeDeckId).toBeNull()
    })
  })

  it('runInTurn 作为兼容 shim：只设 turnId，其他字段继承外层', () => {
    runInRequest({ userId: 7, sessionId: 's', activeDeckId: 3, turnId: null }, () => {
      runInTurn('my-turn', () => {
        const ctx = getRequestContext()
        expect(ctx.turnId).toBe('my-turn')
        expect(ctx.userId).toBe(7)
        expect(ctx.sessionId).toBe('s')
        expect(ctx.activeDeckId).toBe(3)
      })
      // 退出 runInTurn 后，外层 turnId 恢复为 null
      expect(getRequestContext().turnId).toBeNull()
    })
  })
})
