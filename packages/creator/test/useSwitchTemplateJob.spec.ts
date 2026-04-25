import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import { useSwitchTemplateJob } from '../src/composables/useSwitchTemplateJob'

useMsw()

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSwitchTemplateJob', () => {
  it('成功路径：POST → polling → stage 变化 → success', async () => {
    let pollCount = 0
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-1', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-1', () => {
        pollCount++
        if (pollCount === 1)
          return HttpResponse.json({ job: { id: 'job-1', state: 'snapshotting' } })
        if (pollCount === 2)
          return HttpResponse.json({ job: { id: 'job-1', state: 'migrating' } })
        return HttpResponse.json({
          job: {
            id: 'job-1',
            state: 'success',
            snapshotVersionId: 10,
            newVersionId: 11,
          },
        })
      }),
    )
    const job = useSwitchTemplateJob()
    const done = job.start({ deckId: 1, targetTemplateId: 'jingyeda-standard' })

    await vi.advanceTimersByTimeAsync(0)
    expect(job.stage.value).toBe('pending')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('snapshotting')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('migrating')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('success')
    const result = await done
    expect(result.newVersionId).toBe(11)
  })

  it('节奏：前 45s @ 1.5s，之后 @ 3s', async () => {
    let pollTimes: number[] = []
    const startNow = Date.now()
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-2', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-2', () => {
        pollTimes.push(Date.now() - startNow)
        return HttpResponse.json({ job: { id: 'job-2', state: 'migrating' } })
      }),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })

    // 前 45s 应该有 ~30 次（45s / 1.5s）
    await vi.advanceTimersByTimeAsync(45_000)
    const firstPhaseCount = pollTimes.length
    expect(firstPhaseCount).toBeGreaterThanOrEqual(28) // 容忍边界
    expect(firstPhaseCount).toBeLessThanOrEqual(32)

    // 之后 30s 应该只有 ~10 次（3s 节奏）
    const beforeSlow = pollTimes.length
    await vi.advanceTimersByTimeAsync(30_000)
    const slowPhaseDelta = pollTimes.length - beforeSlow
    expect(slowPhaseDelta).toBeGreaterThanOrEqual(8)
    expect(slowPhaseDelta).toBeLessThanOrEqual(12)

    job.abort()
  })

  it('超时：5 分钟无终态 → timeout error', async () => {
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-3', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-3', () =>
        HttpResponse.json({ job: { id: 'job-3', state: 'migrating' } }),
      ),
    )
    const job = useSwitchTemplateJob()
    const done = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    await expect(done).rejects.toThrow(/timeout/i)
  })

  it('abort：调用后 fetch 不再触发', async () => {
    let calls = 0
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-4', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-4', () => {
        calls++
        return HttpResponse.json({ job: { id: 'job-4', state: 'migrating' } })
      }),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(5_000)
    const before = calls
    job.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(before)
  })

  it('retry：失败后 start 再触发，jobId 替换', async () => {
    let started = 0
    server.use(
      http.post('/api/decks/1/switch-template', () => {
        started++
        return HttpResponse.json({ jobId: `job-r${started}`, state: 'pending' })
      }),
      http.get(/switch-template-jobs\/job-r1/, () =>
        HttpResponse.json({ job: { id: 'job-r1', state: 'failed', error: 'boom' } }),
      ),
      http.get(/switch-template-jobs\/job-r2/, () =>
        HttpResponse.json({
          job: {
            id: 'job-r2',
            state: 'success',
            snapshotVersionId: 1,
            newVersionId: 2,
          },
        }),
      ),
    )
    const job = useSwitchTemplateJob()
    const firstDone = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(1500)
    await expect(firstDone).rejects.toThrow(/boom/)

    const secondDone = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(1500)
    const ok = await secondDone
    expect(ok.newVersionId).toBe(2)
    expect(started).toBe(2)
  })

  it('migrating 阶段进度条每次 poll 递增（从 0.5 起步，封顶 0.9）', async () => {
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-mig', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-mig', () =>
        HttpResponse.json({ job: { id: 'job-mig', state: 'migrating' } }),
      ),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })

    // 第一次 poll：0.5 → 0.52
    await vi.advanceTimersByTimeAsync(1500)
    const p1 = job.progressRatio.value
    expect(p1).toBeGreaterThanOrEqual(0.5)
    expect(p1).toBeLessThanOrEqual(0.55)

    // 第二次 poll：0.52 → 0.54（必须严格递增）
    await vi.advanceTimersByTimeAsync(1500)
    const p2 = job.progressRatio.value
    expect(p2).toBeGreaterThan(p1)

    // 第十次 poll 仍然没超过 0.9 上限
    await vi.advanceTimersByTimeAsync(1500 * 10)
    const p3 = job.progressRatio.value
    expect(p3).toBeGreaterThan(p2)
    expect(p3).toBeLessThanOrEqual(0.9)

    job.abort()
  })
})
