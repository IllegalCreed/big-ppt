/**
 * Phase 11.8 Task F-3:useMoodBoardPicker composable 单测。
 *
 * 覆盖:
 * - openPicker → 拉 candidates / 状态写入
 * - regenerate / 限频 429 → remainingGenerations=0 + canRegenerate=false
 * - selectAnchor → close + 写 selectedAssetId
 * - skip → close + skipped=true
 * - 错误兜底:网络错 / 5xx
 *
 * 套用 MSW 拦截 backend,不真打 Hono。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMsw, server, http, HttpResponse } from './_setup/msw'
import { useMoodBoardPicker } from '../src/composables/useMoodBoardPicker'

useMsw()

afterEach(() => {
  useMoodBoardPicker().__resetForTesting()
})

/**
 * Phase 11.8 dogfood:openPicker 现在先调 GET /candidates,空数组才 fallback 到 generate。
 * 给所有 case 默认 stub 返回空数组,模拟"没历史"语境;真要 mock 历史的 case 在自己 server.use 里覆写。
 */
beforeEach(() => {
  server.use(
    http.get('/api/decks/:id/mood-board/candidates', () =>
      HttpResponse.json({
        candidates: [],
        selectedAssetId: null,
        anchorSkipped: false,
        remaining: 3,
      }),
    ),
  )
})

const FAKE_CANDIDATES = {
  candidates: [
    { assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', style: 'isometric tech', prompt: 'p1' },
    { assetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', style: 'watercolor wash', prompt: 'p2' },
    { assetId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', style: 'cyberpunk neon', prompt: 'p3' },
  ],
  retried: false,
  diversityDegraded: false,
  remaining: 2,
}

describe('useMoodBoardPicker.openPicker', () => {
  it('打开 picker → 调 generate → 写 candidates + remaining', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.open.value).toBe(true)
    expect(picker.deckId.value).toBe(1)
    expect(picker.candidates.value).toHaveLength(3)
    expect(picker.candidates.value[0]!.style).toBe('isometric tech')
    expect(picker.remainingGenerations.value).toBe(2)
    expect(picker.loading.value).toBe(false)
    expect(picker.error.value).toBeNull()
  })

  it('再次 open 同 deck → no-op(不重复拉)', async () => {
    let callCount = 0
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => {
        callCount++
        return HttpResponse.json(FAKE_CANDIDATES)
      }),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    await picker.openPicker(1)
    expect(callCount).toBe(1)
  })

  it('open 别的 deck → 先 reset 再拉新 deck candidates', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
      http.post('/api/decks/2/mood-board/generate', () =>
        HttpResponse.json({
          ...FAKE_CANDIDATES,
          candidates: [
            { assetId: 'dddddddd-dddd-dddd-dddd-dddddddddddd', style: 'doodle', prompt: 'p' },
          ].concat(FAKE_CANDIDATES.candidates.slice(1)),
          remaining: 2,
        }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    await picker.openPicker(2)
    expect(picker.deckId.value).toBe(2)
    expect(picker.candidates.value[0]!.style).toBe('doodle')
  })
})

describe('useMoodBoardPicker.regenerate', () => {
  it('再调一次 → candidates 更新 + remaining 递减', async () => {
    let callCount = 0
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => {
        callCount++
        return HttpResponse.json({ ...FAKE_CANDIDATES, remaining: 2 - callCount + 1 })
      }),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.remainingGenerations.value).toBe(2)
    await picker.regenerate()
    expect(callCount).toBe(2)
    expect(picker.remainingGenerations.value).toBe(1)
  })

  it('后端返 429 → remainingGenerations=0 + canRegenerate=false + 友好错误', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () =>
        HttpResponse.json({ error: '本 deck 已达 3 次样张生成上限', remaining: 0 }, { status: 429 }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.remainingGenerations.value).toBe(0)
    expect(picker.canRegenerate.value).toBe(false)
    expect(picker.error.value).toMatch(/上限/)
  })

  it('网络 / 5xx 错 → error 写入,不抛', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () =>
        HttpResponse.json({ error: 'internal' }, { status: 500 }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.error.value).toBeTruthy()
    expect(picker.candidates.value).toHaveLength(0)
    expect(picker.loading.value).toBe(false)
  })

  it('loading 时再调 regenerate → no-op(防双击)', async () => {
    let resolveFirst: () => void = () => {}
    let callCount = 0
    server.use(
      http.post('/api/decks/1/mood-board/generate', async () => {
        callCount++
        if (callCount === 1) {
          await new Promise<void>((r) => {
            resolveFirst = r
          })
        }
        return HttpResponse.json(FAKE_CANDIDATES)
      }),
    )
    const picker = useMoodBoardPicker()
    const p1 = picker.openPicker(1)
    // 让 fetch 进入 await 状态(loading=true)再尝试并发 regenerate
    await new Promise((r) => setTimeout(r, 10))
    expect(picker.loading.value).toBe(true)
    // 此时第二次 regenerate 应该 no-op
    await picker.regenerate()
    expect(callCount).toBe(1)
    resolveFirst()
    await p1
  })
})

describe('useMoodBoardPicker.selectAnchor', () => {
  it('选定 → 调 anchor 端点 + 写 selectedAssetId + 关闭 modal', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
      http.post('/api/decks/1/anchor', () =>
        HttpResponse.json({
          ok: true,
          anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    await picker.selectAnchor('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(picker.selectedAssetId.value).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(picker.open.value).toBe(false)
  })

  it('后端拒绝(400 / 404) → error 写入,modal 保持 open', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
      http.post('/api/decks/1/anchor', () =>
        HttpResponse.json({ error: 'asset 不存在' }, { status: 404 }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    await picker.selectAnchor('zzzz-not-exist')
    expect(picker.error.value).toBeTruthy()
    expect(picker.open.value).toBe(true)
    expect(picker.selectedAssetId.value).toBeNull()
  })
})

describe('useMoodBoardPicker.skip', () => {
  it('跳过 → skipped=true + open=false + selectedAssetId 仍 null', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    picker.skip()
    expect(picker.open.value).toBe(false)
    expect(picker.anchorSkipped.value).toBe(true)
    expect(picker.selectedAssetId.value).toBeNull()
  })

  it('closePicker = skip alias', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    picker.closePicker()
    expect(picker.open.value).toBe(false)
    expect(picker.anchorSkipped.value).toBe(true)
  })
})

describe('useMoodBoardPicker canRegenerate', () => {
  it('loading 中 → false', async () => {
    let resolveFirst: () => void = () => {}
    server.use(
      http.post('/api/decks/1/mood-board/generate', async () => {
        await new Promise<void>((r) => {
          resolveFirst = r
        })
        return HttpResponse.json(FAKE_CANDIDATES)
      }),
    )
    const picker = useMoodBoardPicker()
    const p = picker.openPicker(1)
    // 给 fetch + msw 中间层几个 microtask 进入 await 状态(loading=true)
    await new Promise((r) => setTimeout(r, 10))
    expect(picker.loading.value).toBe(true)
    expect(picker.canRegenerate.value).toBe(false)
    resolveFirst()
    await p
  })

  it('remaining=0 → false', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () =>
        HttpResponse.json({ ...FAKE_CANDIDATES, remaining: 0 }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.remainingGenerations.value).toBe(0)
    expect(picker.canRegenerate.value).toBe(false)
  })

  it('正常 + remaining>0 → true', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => HttpResponse.json(FAKE_CANDIDATES)),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    expect(picker.canRegenerate.value).toBe(true)
  })
})
