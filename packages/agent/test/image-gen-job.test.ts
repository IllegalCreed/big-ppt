/**
 * Phase 11.5 Task C：image-gen-job 状态机 + 取消 + 路由集成测。
 *
 * 不依赖真实 OpenAI / DB(用 DI mock 三个依赖),纯进程内单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createImageJob,
  getImageJob,
  cancelImageJob,
  runImageJob,
  __resetImageJobsForTesting,
  type RunImageJobDeps,
} from '../src/image-gen-job.js'
import { imageJobsRoute } from '../src/routes/image-jobs.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'

useTestDb() // 用于路由 cookie 鉴权

beforeEach(() => {
  __resetImageJobsForTesting()
})

afterEach(() => {
  __resetImageJobsForTesting()
})

const FAKE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAlAA=='

function makeDeps(overrides: Partial<RunImageJobDeps> = {}): RunImageJobDeps {
  return {
    generateImage: vi.fn(async () => ({
      b64: FAKE_B64,
      modelUsed: 'gpt-5.5',
      pathTaken: 'A' as const,
    })),
    createAsset: vi.fn(async () => ({ id: 'asset-uuid-001' })),
    updateSlide: vi.fn(async () => undefined),
    targetLayout: 'beitou-image-content',
    preservedHeading: undefined,
    ...overrides,
  }
}

describe('image-gen-job 状态机', () => {
  it('createImageJob：初始状态 pending,id 是 uuid', () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 3,
      prompt: 'a city',
      size: '1280x720',
    })
    expect(job.state).toBe('pending')
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(getImageJob(job.id)?.state).toBe('pending')
  })

  it('runImageJob 成功:pending → running → done,DI 都被调到', async () => {
    const job = createImageJob({
      deckId: 5,
      userId: 7,
      slideIndex: 2,
      prompt: 'mountain',
      size: '1280x720',
    })
    const deps = makeDeps()
    await runImageJob(job.id, deps)
    const final = getImageJob(job.id)
    expect(final?.state).toBe('done')
    expect(final?.assetId).toBe('asset-uuid-001')
    expect(final?.modelUsed).toBe('gpt-5.5')
    expect(final?.pathTaken).toBe('A')
    expect(final?.finishedAt).toBeInstanceOf(Date)
    expect(deps.generateImage).toHaveBeenCalledOnce()
    expect(deps.createAsset).toHaveBeenCalledOnce()
    expect(deps.updateSlide).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 5,
        userId: 7,
        slideIndex: 2,
        layout: 'beitou-image-content',
        imageSrc: '/api/assets/asset-uuid-001',
      }),
    )
  })

  it('runImageJob:generateImage 抛错 → state=failed,errorMsg 透传,DB/slides 不动', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    const deps = makeDeps({
      generateImage: vi.fn(async () => {
        throw new Error('OpenAI 502')
      }),
    })
    await runImageJob(job.id, deps)
    const final = getImageJob(job.id)
    expect(final?.state).toBe('failed')
    expect(final?.errorMsg).toContain('OpenAI 502')
    expect(deps.createAsset).not.toHaveBeenCalled()
    expect(deps.updateSlide).not.toHaveBeenCalled()
  })

  it('runImageJob:updateSlide 抛错 → state=failed,asset 已写入留库(deck-delete cascade 时清)', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    const deps = makeDeps({
      updateSlide: vi.fn(async () => {
        throw new Error('slides.md write fail')
      }),
    })
    await runImageJob(job.id, deps)
    const final = getImageJob(job.id)
    expect(final?.state).toBe('failed')
    expect(deps.createAsset).toHaveBeenCalledOnce() // asset 已写
    expect(deps.updateSlide).toHaveBeenCalledOnce() // 但失败
  })

  it('cancelImageJob:running 中调 → 中断 fetch + state=cancelled', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    let signalSeen: AbortSignal | null = null
    const deps = makeDeps({
      generateImage: vi.fn(async (args) => {
        signalSeen = args.signal
        await new Promise((resolve) => setTimeout(resolve, 50))
        if (args.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        return { b64: FAKE_B64, modelUsed: 'gpt-5.5', pathTaken: 'A' as const }
      }),
    })
    const runPromise = runImageJob(job.id, deps)
    // 让 worker 跑起来
    await new Promise((r) => setTimeout(r, 5))
    const cancelled = cancelImageJob(job.id, 1)
    expect(cancelled).toBe(true)
    await runPromise
    const final = getImageJob(job.id)
    expect(final?.state).toBe('cancelled')
    expect(signalSeen?.aborted).toBe(true)
  })

  it('cancelImageJob:跨用户(校验 userId)→ 拒绝,state 不变', () => {
    const job = createImageJob({
      deckId: 1,
      userId: 100,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    const ok = cancelImageJob(job.id, 999)
    expect(ok).toBe(false)
    expect(getImageJob(job.id)?.state).toBe('pending')
  })

  it('cancelImageJob:已 done 的 job 是 noop,返 true', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    await runImageJob(job.id, makeDeps())
    expect(getImageJob(job.id)?.state).toBe('done')
    expect(cancelImageJob(job.id, 1)).toBe(true)
    expect(getImageJob(job.id)?.state).toBe('done') // 不变
  })

  it('runImageJob:创建后 controller 已 abort 的 job → 直接 cancelled,不调 DI', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x720',
    })
    cancelImageJob(job.id, 1)
    const deps = makeDeps()
    await runImageJob(job.id, deps)
    expect(deps.generateImage).not.toHaveBeenCalled()
    expect(getImageJob(job.id)?.state).toBe('cancelled')
  })

  it('hybrid vision-aware:job.baseImageBase64/baseImageMime 透传到 deps.generateImage', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'add a cat',
      size: '1536x720',
      baseImageBase64: 'AAAA',
      baseImageMime: 'image/png',
    })
    const generateImage = vi.fn(async () => ({
      b64: FAKE_B64,
      modelUsed: 'gpt-5.5',
      pathTaken: 'A' as const,
    }))
    const deps = makeDeps({ generateImage })
    await runImageJob(job.id, deps)
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'add a cat',
        size: '1536x720',
        baseImageBase64: 'AAAA',
        baseImageMime: 'image/png',
      }),
    )
    expect(getImageJob(job.id)?.state).toBe('done')
  })

  it('hybrid vision-aware:job 无 baseImage 字段 → deps.generateImage 拿到 undefined(向后兼容)', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'a city',
      size: '1536x720',
    })
    const generateImage = vi.fn(async () => ({
      b64: FAKE_B64,
      modelUsed: 'gpt-5.5',
      pathTaken: 'A' as const,
    }))
    const deps = makeDeps({ generateImage })
    await runImageJob(job.id, deps)
    const arg = generateImage.mock.calls[0]![0] as {
      baseImageBase64?: string
      baseImageMime?: string
    }
    expect(arg.baseImageBase64).toBeUndefined()
    expect(arg.baseImageMime).toBeUndefined()
  })

  it('__resetImageJobsForTesting:清光所有 job', () => {
    createImageJob({ deckId: 1, userId: 1, slideIndex: 1, prompt: 'x', size: '1280x720' })
    createImageJob({ deckId: 1, userId: 1, slideIndex: 2, prompt: 'x', size: '1280x720' })
    __resetImageJobsForTesting()
    expect(getImageJob('any')).toBeNull()
  })
})

describe('image-jobs 路由', () => {
  function makeApp() {
    const app = new Hono<{ Variables: AuthVars }>()
    app.use('*', authOptional)
    app.route('/api', imageJobsRoute)
    return app
  }

  it('GET 未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/image-jobs/whatever')
    expect(res.status).toBe(401)
  })

  it('GET 不存在的 id → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser('jobs-404@a.com')
    const res = await app.request('/api/image-jobs/missing', { headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
  })

  it('GET owner → 200 + job 完整字段(剥 controller)', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('jobs-owner@a.com')
    const job = createImageJob({
      deckId: 1,
      userId: user.id,
      slideIndex: 1,
      prompt: 'p',
      size: '1280x720',
    })
    const res = await app.request(`/api/image-jobs/${job.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.job.id).toBe(job.id)
    expect(data.job.state).toBe('pending')
    expect(data.job).not.toHaveProperty('controller')
  })

  it('GET 跨用户 → 403', async () => {
    const app = makeApp()
    const { user: a } = await createLoggedInUser('jobs-a@a.com')
    const job = createImageJob({
      deckId: 1,
      userId: a.id,
      slideIndex: 1,
      prompt: 'p',
      size: '1280x720',
    })
    const { cookie: bCookie } = await createLoggedInUser('jobs-b@a.com')
    const res = await app.request(`/api/image-jobs/${job.id}`, { headers: { Cookie: bCookie } })
    expect(res.status).toBe(403)
  })

  it('DELETE owner → 200 + state=cancelled', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('jobs-cancel@a.com')
    const job = createImageJob({
      deckId: 1,
      userId: user.id,
      slideIndex: 1,
      prompt: 'p',
      size: '1280x720',
    })
    const res = await app.request(`/api/image-jobs/${job.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(200)
    expect(getImageJob(job.id)?.state).toBe('cancelled')
  })

  it('DELETE 跨用户 → 403,state 不变', async () => {
    const app = makeApp()
    const { user: a } = await createLoggedInUser('jobs-a2@a.com')
    const job = createImageJob({
      deckId: 1,
      userId: a.id,
      slideIndex: 1,
      prompt: 'p',
      size: '1280x720',
    })
    const { cookie: bCookie } = await createLoggedInUser('jobs-b2@a.com')
    const res = await app.request(`/api/image-jobs/${job.id}`, {
      method: 'DELETE',
      headers: { Cookie: bCookie },
    })
    expect(res.status).toBe(403)
    expect(getImageJob(job.id)?.state).toBe('pending')
  })
})
