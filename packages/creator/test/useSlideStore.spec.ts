/**
 * Phase 10.5：useSlideStore.refresh() 端点变更回归测试。
 *
 * 历史：spike→落地切换后第一版 refresh() 仍 fetch '/api/read-slides'，被
 * slidev-lock 守 403（编辑器去抢锁 → 持锁=false）。修复改成走
 * `GET /api/decks/:id` 拿 currentVersion.content。
 *
 * 本测试守门：refresh() 必须用 activeDeckId 拼端点 + 取 currentVersion.content
 * 写到 slideStore.content。
 *
 * useSlideStore 是 module-scope 单例（content / activeDeckId 都在模块作用域），
 * 测试间需手动 reset。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock 必须在 import useSlideStore 之前生效；factory 内部不能引用模块外部
// 闭包变量（hoisted 时不可用），故 mock 状态挂到 globalThis 上转中介。
;(globalThis as Record<string, unknown>).__apiGetMock = vi.fn()
vi.mock('../src/api/client', () => ({
  api: {
    get: (path: string, opts?: unknown) =>
      ((globalThis as Record<string, unknown>).__apiGetMock as ReturnType<typeof vi.fn>)(path, opts),
  },
}))

import { useSlideStore } from '../src/composables/useSlideStore'

const apiGet = (globalThis as Record<string, unknown>).__apiGetMock as ReturnType<typeof vi.fn>

function resetStore() {
  const store = useSlideStore()
  store.update('')
  store.setPage(1)
  // activeDeckId 没有 public reset；通过 initDeck 覆盖
}

describe('useSlideStore', () => {
  beforeEach(() => {
    apiGet.mockReset()
    resetStore()
  })
  afterEach(() => {
    apiGet.mockReset()
  })

  it('initDeck 绑 deckId + 写初始内容', () => {
    const store = useSlideStore()
    store.initDeck(42, '---\nlayout: cover\n---')
    expect(store.activeDeckId.value).toBe(42)
    expect(store.content.value).toContain('layout: cover')
  })

  it('refresh 必须走 GET /api/decks/:id（不再读 /api/read-slides）', async () => {
    apiGet.mockResolvedValue({
      currentVersion: { content: '---\nlayout: beitou-cover\nmainTitle: from-server\n---' },
    })
    const store = useSlideStore()
    store.initDeck(99, '初始')
    await store.refresh()
    expect(apiGet).toHaveBeenCalledOnce()
    expect(apiGet.mock.calls[0]?.[0]).toBe('/api/decks/99')
    expect(store.content.value).toContain('from-server')
  })

  it('activeDeckId 未绑（编辑器外调用）refresh 直接 noop，不发请求', async () => {
    const store = useSlideStore()
    store.update('原内容')
    // 不调 initDeck → activeDeckId 还是 null
    // 但前一个 test 可能 set 过 — 用 initDeck(null as never) 不优雅；
    // 这里用 set-by-side-effect 验证：apiGet 不应被调
    // initDeck(0) 让 id 为 falsy
    store.initDeck(0, '原内容')
    apiGet.mockClear()
    await store.refresh()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('refresh 网络失败时静默吞错，不阻塞 UI', async () => {
    apiGet.mockRejectedValue(new Error('500'))
    const store = useSlideStore()
    store.initDeck(7, '初始')
    await expect(store.refresh()).resolves.toBeUndefined()
    expect(store.content.value).toBe('初始') // 保持原内容
  })

  it('refresh 返回 currentVersion null 时不覆盖现有 content', async () => {
    apiGet.mockResolvedValue({ currentVersion: null })
    const store = useSlideStore()
    store.initDeck(8, '现有内容')
    await store.refresh()
    expect(store.content.value).toBe('现有内容')
  })
})
