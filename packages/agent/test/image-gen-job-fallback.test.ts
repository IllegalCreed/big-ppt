/**
 * Phase 11.6：image worker graceful-degradation 单测。
 *
 * 覆盖关键路径:
 * - 出图失败 + 三件 DI 都注入 + 必要 job 字段都有 → state='fallback-rewrote',兜底 update 被调
 * - 出图失败 + rewriteSinglePage 抛错 → state='fallback-failed'
 * - 出图失败 + DI 缺失(老语义) → state='failed'(向后兼容,Phase 11.5 行为)
 * - 出图失败 + job.fallbackSummary 缺失 → state='failed'(无兜底输入,不进重写流程)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createImageJob,
  getImageJob,
  runImageJob,
  __resetImageJobsForTesting,
  type RunImageJobDeps,
} from '../src/image-gen-job.js'
import {
  __getImageSemaphoreStateForTesting,
  __resetImageSemaphoreForTesting,
} from '../src/middleware/image-semaphore.js'

beforeEach(() => {
  __resetImageJobsForTesting()
  __resetImageSemaphoreForTesting()
})

afterEach(() => {
  __resetImageJobsForTesting()
  __resetImageSemaphoreForTesting()
})

const FAKE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAlAA=='

function makeFailingDeps(overrides: Partial<RunImageJobDeps> = {}): RunImageJobDeps {
  return {
    generateImage: vi.fn(async () => {
      throw new Error('OpenAI 502 路 A/B 都崩')
    }),
    createAsset: vi.fn(async () => ({ id: 'unused' })),
    updateSlide: vi.fn(async () => undefined),
    targetLayout: 'beitou-image-content',
    preservedHeading: '系统架构',
    ...overrides,
  }
}

describe('image-gen-job graceful-degradation（Phase 11.6）', () => {
  it('出图失败 + 三件 DI 全注入 + fallbackSummary 在 → state=fallback-rewrote,updateSlideRaw 被调', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 3,
      prompt: 'a futuristic city',
      size: '1536x720',
      fallbackSummary: '列举 RAG 系统的 4 个核心模块',
      heading: '系统架构',
      templateId: 'beitou-standard',
    })
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\nlayout: beitou-cover\nmainTitle: T\n---\n')
    const rewriteSinglePage = vi.fn(async () => ({
      frontmatter: { layout: 'beitou-content', heading: '系统架构' },
      body: 'RAG 四大模块：检索器、向量库、生成器、编排器。',
    }))
    const deps = makeFailingDeps({ updateSlideRaw, readSlides, rewriteSinglePage })

    await runImageJob(job.id, deps)
    const final = getImageJob(job.id)

    expect(final?.state).toBe('fallback-rewrote')
    expect(final?.errorMsg).toContain('OpenAI 502')
    expect(rewriteSinglePage).toHaveBeenCalledOnce()
    expect(rewriteSinglePage).toHaveBeenCalledWith(
      expect.objectContaining({
        slideIndex: 3,
        heading: '系统架构',
        fallbackSummary: '列举 RAG 系统的 4 个核心模块',
        templateId: 'beitou-standard',
        userId: 1,
      }),
    )
    expect(updateSlideRaw).toHaveBeenCalledOnce()
    expect(updateSlideRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        slideIndex: 3,
        frontmatter: expect.objectContaining({ layout: 'beitou-content' }),
        body: expect.stringContaining('四大模块'),
        replaceFrontmatter: true,
      }),
    )
    // 出图成功路径的 updateSlide / createAsset 不应被调
    expect(deps.createAsset).not.toHaveBeenCalled()
    expect(deps.updateSlide).not.toHaveBeenCalled()
  })

  it('出图失败 + rewriteSinglePage 抛错（兜底也崩）→ state=fallback-failed', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '某段摘要',
      heading: 'h',
      templateId: 'beitou-standard',
    })
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\nlayout: beitou-cover\nmainTitle: T\n---\n')
    const rewriteSinglePage = vi.fn(async () => {
      throw new Error('主 LLM 也挂了')
    })
    const deps = makeFailingDeps({ updateSlideRaw, readSlides, rewriteSinglePage })

    await runImageJob(job.id, deps)
    const final = getImageJob(job.id)

    expect(final?.state).toBe('fallback-failed')
    expect(final?.errorMsg).toContain('OpenAI 502')
    expect(final?.errorMsg).toContain('主 LLM 也挂了')
    expect(updateSlideRaw).not.toHaveBeenCalled()
  })

  it('出图失败 + 三件 DI 没注入（老语义）→ state=failed（向后兼容 Phase 11.5）', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '摘要',
      heading: 'h',
      templateId: 'beitou-standard',
    })
    // 不注入 readSlides / rewriteSinglePage / updateSlideRaw
    const deps = makeFailingDeps()
    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('failed')
  })

  it('出图失败 + DI 全在但缺 fallbackSummary → state=failed（无兜底输入）', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      // fallbackSummary 缺失
      heading: 'h',
      templateId: 'beitou-standard',
    })
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\n---\n')
    const rewriteSinglePage = vi.fn(async () => ({ frontmatter: {}, body: '' }))
    const deps = makeFailingDeps({ updateSlideRaw, readSlides, rewriteSinglePage })

    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('failed')
    expect(rewriteSinglePage).not.toHaveBeenCalled()
  })

  it('出图失败 + DI 全在但缺 templateId → state=failed', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '摘要',
      heading: 'h',
      // templateId 缺失
    })
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\n---\n')
    const rewriteSinglePage = vi.fn(async () => ({ frontmatter: {}, body: '' }))
    const deps = makeFailingDeps({ updateSlideRaw, readSlides, rewriteSinglePage })

    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('failed')
    expect(rewriteSinglePage).not.toHaveBeenCalled()
  })

  it('cancel/abort 仍然不进入兜底流程（兼容性：cancelled 优先）', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '摘要',
      heading: 'h',
      templateId: 'beitou-standard',
    })
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\n---\n')
    const rewriteSinglePage = vi.fn(async () => ({ frontmatter: {}, body: '' }))
    const deps: RunImageJobDeps = {
      generateImage: vi.fn(async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }),
      createAsset: vi.fn(async () => ({ id: 'x' })),
      updateSlide: vi.fn(async () => undefined),
      updateSlideRaw,
      readSlides,
      rewriteSinglePage,
      targetLayout: 'beitou-image-content',
    }
    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('cancelled')
    expect(rewriteSinglePage).not.toHaveBeenCalled()
  })

  it('出图失败 → 进入 fallback rewrite 之前已释放 image slot(2026-05-06 dogfood 修复)', async () => {
    // 假设场景:user=1 的 slot limit=3,3 个 job 同时跑,全部 503 fail。
    // fallback rewrite 期间 image slot 必须已释放,否则后排 job 撞 queue-timeout。
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 4,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '某段摘要',
      heading: 'h',
      templateId: 'beitou-standard',
    })

    // rewriteSinglePage 用一个永远不 resolve 的 Promise 模拟"主 LLM 还在跑",
    // 我们在它跑期间检查 image-semaphore active 计数:必须已经回 0(说明 slot 释放了)。
    let releaseRewrite: (v: { frontmatter: Record<string, unknown>; body: string }) => void = () => {}
    const rewritePromise = new Promise<{ frontmatter: Record<string, unknown>; body: string }>(
      (resolve) => {
        releaseRewrite = resolve
      },
    )
    const updateSlideRaw = vi.fn(async () => undefined)
    const readSlides = vi.fn(() => '---\n---\n')
    const rewriteSinglePage = vi.fn(() => rewritePromise)

    const deps = makeFailingDeps({ updateSlideRaw, readSlides, rewriteSinglePage })

    // worker 跑起来,但还没 await 完(rewrite 卡住)
    const workerPromise = runImageJob(job.id, deps)

    // 让 worker 走完 acquire → 出图 fail → release slot → 进入 rewrite 等待
    // 多个 microtask 让 worker 推进到 rewriteSinglePage 的 await 点
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r))
    }

    // 关键断言:此时 worker 卡在 rewriteSinglePage,但 image semaphore 应已释放
    expect(rewriteSinglePage).toHaveBeenCalledOnce()
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })

    // 收尾:让 rewrite 完成,worker 走到 fallback-rewrote 状态
    releaseRewrite({
      frontmatter: { layout: 'beitou-content' },
      body: 'done',
    })
    await workerPromise
    expect(getImageJob(job.id)?.state).toBe('fallback-rewrote')
  })

  it('出图失败 + 无 fallback DI(老语义)→ 也立刻释放 slot 然后标 failed', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 5,
      prompt: 'x',
      size: '1536x720',
      heading: 'h',
      templateId: 'beitou-standard',
    })
    const deps = makeFailingDeps()
    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('failed')
    // worker 已退出,slot 已释放(finally 兜底)
    expect(__getImageSemaphoreStateForTesting(1)).toEqual({ active: 0, queueLen: 0 })
  })

  // 健全性确认:出图成功路径(FAKE_B64 → done)在新 ImageJob 字段下仍然 OK
  it('成功路径在 fallbackSummary/templateId 字段存在时仍走 done(不影响)', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 2,
      prompt: 'x',
      size: '1536x720',
      fallbackSummary: '摘要',
      heading: 'h',
      templateId: 'beitou-standard',
    })
    const deps: RunImageJobDeps = {
      generateImage: vi.fn(async () => ({
        b64: FAKE_B64,
        modelUsed: 'gpt-5.5',
        pathTaken: 'A' as const,
      })),
      createAsset: vi.fn(async () => ({ id: 'asset-uuid-002' })),
      updateSlide: vi.fn(async () => undefined),
      targetLayout: 'beitou-image-content',
      preservedHeading: 'h',
    }
    await runImageJob(job.id, deps)
    expect(getImageJob(job.id)?.state).toBe('done')
  })
})
