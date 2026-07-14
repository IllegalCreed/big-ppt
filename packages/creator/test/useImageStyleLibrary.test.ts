import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http, server, useMsw } from './_setup/msw'
import type {
  ActiveImageStyle,
  ImageStyleLibraryPreset,
  ImageStyleLibraryResponse,
} from '@big-ppt/shared'
import { useImageStyleLibrary } from '../src/composables/useImageStyleLibrary'

useMsw()

const SYSTEM_PRESET: ImageStyleLibraryPreset = {
  id: 'flat-editorial',
  source: 'system',
  name: '扁平编辑插画',
  description: '克制的几何块面与编辑排版',
  category: 'editorial',
  tags: ['flat'],
  order: 1,
  palettePolicy: 'template',
  previewUrl: '/api/image-style-presets/system/flat-editorial/preview',
  compatible: true,
}

const USER_PRESET: ImageStyleLibraryPreset = {
  ...SYSTEM_PRESET,
  id: 'user-style-1',
  source: 'user',
  name: '我的线稿',
  previewUrl: '/api/style-presets/user-style-1/image',
}

function libraryResponse(
  overrides: Partial<ImageStyleLibraryResponse> = {},
): ImageStyleLibraryResponse {
  return {
    presets: { system: [SYSTEM_PRESET], user: [USER_PRESET] },
    generatedCandidates: [],
    active: { mode: 'undecided' },
    draw: {
      state: 'idle',
      jobId: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    remainingExplorations: 3,
    ...overrides,
  }
}

afterEach(() => {
  useImageStyleLibrary().__resetForTesting()
})

describe('useImageStyleLibrary.openLibrary', () => {
  it('只 GET 风格库，不会自动探索；普通打开 undecided deck 也不锁聊天', async () => {
    let getCount = 0
    let exploreCount = 0
    server.use(
      http.get('/api/decks/1/style-library', () => {
        getCount += 1
        return HttpResponse.json(libraryResponse())
      }),
      http.post('/api/decks/1/style-library/explore', () => {
        exploreCount += 1
        return HttpResponse.json({ jobId: 'job-1', state: 'running' }, { status: 202 })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)

    expect(getCount).toBe(1)
    expect(exploreCount).toBe(0)
    expect(styles.systemPresets.value).toEqual([SYSTEM_PRESET])
    expect(styles.userPresets.value).toEqual([USER_PRESET])
    expect(styles.decisionPending.value).toBe(false)
  })

  it('write_slides 首次提示显式 decisionPending；选择自由生成后解除并递增 mutation', async () => {
    let active: ActiveImageStyle = { mode: 'undecided' }
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(libraryResponse({ active }))),
      http.post('/api/decks/1/style-library/free', () => {
        active = { mode: 'free' }
        return HttpResponse.json({ ok: true })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1, { decisionPending: true })
    expect(styles.decisionPending.value).toBe(true)

    await styles.chooseFreeStyle()
    expect(styles.open.value).toBe(false)
    expect(styles.decisionPending.value).toBe(false)
    expect(styles.active.value).toEqual({ mode: 'free' })
    expect(styles.mutationRevision.value).toBe(1)
  })

  it('服务端已完成决策时自动解除 pendingHint，不再误锁聊天', async () => {
    const active: ActiveImageStyle = {
      mode: 'preset',
      styleSource: 'system',
      styleSourceId: SYSTEM_PRESET.id,
      anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      stylePalettePolicy: 'template',
    }
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(libraryResponse({ active }))),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1, { decisionPending: true })

    expect(styles.active.value).toEqual(active)
    expect(styles.decisionPending.value).toBe(false)
  })

  it('关闭首次决策前重新对齐服务端，避免 free 覆盖另一窗口刚选的风格', async () => {
    let getCount = 0
    let freeCount = 0
    const selected: ActiveImageStyle = {
      mode: 'preset',
      styleSource: 'system',
      styleSourceId: SYSTEM_PRESET.id,
      anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      stylePalettePolicy: 'template',
    }
    server.use(
      http.get('/api/decks/1/style-library', () => {
        getCount += 1
        return HttpResponse.json(
          libraryResponse({ active: getCount === 1 ? { mode: 'undecided' } : selected }),
        )
      }),
      http.post('/api/decks/1/style-library/free', () => {
        freeCount += 1
        return HttpResponse.json({ active: { mode: 'free' } })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1, { decisionPending: true })
    await styles.dismissLibrary()

    expect(getCount).toBe(2)
    expect(freeCount).toBe(0)
    expect(styles.active.value).toEqual(selected)
    expect(styles.decisionPending.value).toBe(false)
    expect(styles.open.value).toBe(false)
  })
})

describe('useImageStyleLibrary mutations', () => {
  it('应用系统预设后关闭并刷新 active', async () => {
    let active: ActiveImageStyle = { mode: 'undecided' }
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(libraryResponse({ active }))),
      http.post('/api/decks/1/style-library/apply', async ({ request }) => {
        expect(await request.json()).toEqual({ source: 'system', id: 'flat-editorial' })
        active = {
          mode: 'preset',
          styleSource: 'system',
          styleSourceId: 'flat-editorial',
          anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          stylePalettePolicy: 'template',
        }
        return HttpResponse.json({ active })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1, { decisionPending: true })
    await styles.applyStyle('system', 'flat-editorial')

    expect(styles.open.value).toBe(false)
    expect(styles.active.value).toEqual(active)
    expect(styles.decisionPending.value).toBe(false)
    expect(styles.mutationRevision.value).toBe(1)
  })

  it('保存、重命名、删除均调用独立风格 API 并刷新列表', async () => {
    let saveBody: unknown
    let renameBody: unknown
    let deleteCount = 0
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(libraryResponse())),
      http.post('/api/decks/1/style-library/save', async ({ request }) => {
        saveBody = await request.json()
        return HttpResponse.json({ preset: USER_PRESET })
      }),
      http.patch('/api/style-presets/user-style-1', async ({ request }) => {
        renameBody = await request.json()
        return HttpResponse.json({ preset: { ...USER_PRESET, name: '新名字' } })
      }),
      http.delete('/api/style-presets/user-style-1', () => {
        deleteCount += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)
    await styles.saveCandidate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '收藏风格')
    await styles.renamePreset('user-style-1', '新名字')
    await styles.deletePreset('user-style-1')

    expect(saveBody).toEqual({
      assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: '收藏风格',
    })
    expect(renameBody).toEqual({ name: '新名字' })
    expect(deleteCount).toBe(1)
  })

  it('旧 deck 的迟到 apply 响应不会关闭或污染新 deck 风格库', async () => {
    let releaseApply!: () => void
    let applyStarted = false
    const gate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(libraryResponse())),
      http.get('/api/decks/2/style-library', () =>
        HttpResponse.json(libraryResponse({ active: { mode: 'free' } })),
      ),
      http.post('/api/decks/1/style-library/apply', async () => {
        applyStarted = true
        await gate
        return HttpResponse.json({
          active: {
            mode: 'preset',
            styleSource: 'system',
            styleSourceId: SYSTEM_PRESET.id,
            anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            stylePalettePolicy: 'template',
          },
        })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)
    const applying = styles.applyStyle('system', SYSTEM_PRESET.id)
    await vi.waitFor(() => expect(applyStarted).toBe(true))

    await styles.openLibrary(2)
    releaseApply()
    await applying

    expect(styles.deckId.value).toBe(2)
    expect(styles.open.value).toBe(true)
    expect(styles.active.value).toEqual({ mode: 'free' })
    expect(styles.loading.value).toBe(false)
    expect(styles.applyingKey.value).toBeNull()
    expect(styles.mutationRevision.value).toBe(0)
  })
})

describe('useImageStyleLibrary AI exploration', () => {
  it('显式点击才 POST；202 后轮询到 done 并回填候选', async () => {
    let started = false
    let postCount = 0
    const candidate = {
      assetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      source: 'explore' as const,
      style: 'paper cut',
      prompt: 'paper cut prompt',
      palettePolicy: 'template' as const,
      previewUrl: '/api/assets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      compatible: true,
    }
    server.use(
      http.get('/api/decks/1/style-library', () =>
        HttpResponse.json(
          started
            ? libraryResponse({
                generatedCandidates: [candidate],
                draw: {
                  state: 'done',
                  jobId: 'job-1',
                  startedAt: '2026-07-11T00:00:00Z',
                  finishedAt: '2026-07-11T00:01:00Z',
                  error: null,
                },
                remainingExplorations: 2,
              })
            : libraryResponse(),
        ),
      ),
      http.post('/api/decks/1/style-library/explore', () => {
        started = true
        postCount += 1
        return HttpResponse.json({ jobId: 'job-1', state: 'running' }, { status: 202 })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)
    expect(postCount).toBe(0)

    const first = styles.explore()
    const second = styles.explore()
    expect(first).toBe(second)
    await first

    expect(postCount).toBe(1)
    expect(styles.generatedCandidates.value).toEqual([candidate])
    expect(styles.exploring.value).toBe(false)
    expect(styles.remainingExplorations.value).toBe(2)
  })

  it('刷新时发现 draw=running 会自动恢复轮询，无需再次点击探索', async () => {
    let getCount = 0
    server.use(
      http.get('/api/decks/1/style-library', () => {
        getCount += 1
        return HttpResponse.json(
          libraryResponse({
            draw:
              getCount === 1
                ? {
                    state: 'running',
                    jobId: 'job-resume',
                    startedAt: '2026-07-11T00:00:00Z',
                    finishedAt: null,
                    error: null,
                  }
                : {
                    state: 'done',
                    jobId: 'job-resume',
                    startedAt: '2026-07-11T00:00:00Z',
                    finishedAt: '2026-07-11T00:01:00Z',
                    error: null,
                  },
          }),
        )
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)
    expect(styles.exploring.value).toBe(true)

    await vi.waitFor(() => expect(styles.draw.value?.state).toBe('done'), {
      timeout: 2_500,
      interval: 50,
    })
    expect(getCount).toBeGreaterThanOrEqual(2)
    expect(styles.exploring.value).toBe(false)
  })

  it('关闭弹窗与一次网络抖动都不会中断后台探索', async () => {
    let started = false
    let pollCount = 0
    const candidate = {
      assetId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      source: 'explore' as const,
      style: 'ink wash',
      prompt: 'ink wash prompt',
      palettePolicy: 'reference' as const,
      previewUrl: '/api/assets/cccccccc-cccc-cccc-cccc-cccccccccccc',
      compatible: true,
    }
    server.use(
      http.get('/api/decks/1/style-library', () => {
        if (!started) return HttpResponse.json(libraryResponse())
        pollCount += 1
        if (pollCount === 1) return HttpResponse.error()
        return HttpResponse.json(
          libraryResponse({
            generatedCandidates: pollCount >= 3 ? [candidate] : [],
            draw: {
              state: pollCount >= 3 ? 'done' : 'running',
              jobId: 'job-resilient',
              startedAt: '2026-07-11T00:00:00Z',
              finishedAt: pollCount >= 3 ? '2026-07-11T00:01:00Z' : null,
              error: null,
            },
          }),
        )
      }),
      http.post('/api/decks/1/style-library/explore', () => {
        started = true
        return HttpResponse.json({ jobId: 'job-resilient', state: 'running' }, { status: 202 })
      }),
    )

    const styles = useImageStyleLibrary()
    await styles.openLibrary(1)
    const exploration = styles.explore()
    await vi.waitFor(() => expect(started).toBe(true))
    styles.closeLibrary()

    expect(styles.open.value).toBe(false)
    expect(styles.decisionPending.value).toBe(false)
    await exploration
    expect(pollCount).toBeGreaterThanOrEqual(3)
    expect(styles.generatedCandidates.value).toEqual([candidate])
    expect(styles.error.value).toBeNull()
    expect(styles.open.value).toBe(false)
  })
})
