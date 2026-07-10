/**
 * Phase 10：/healthz + /api/healthz 增强版测试。
 *
 * 三场景：
 *   1. happy（DB up + slidev up）→ 200 + status:'ok'
 *   2. slidev down（DB up）→ 200 + status:'degraded'，agent 仍可服务
 *   3. DB down → 503 + status:'down'
 *
 * /api/healthz 与 /healthz 是同一 sub-router 的两个挂载点，行为一致；
 * mount-integration 测试覆盖路径级别的存在性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { useTestDb } from './_setup/test-db.js'

useTestDb()

describe('GET /healthz', () => {
  // 把所有出去的 fetch（slidev probe）默认 mock 成 200，避免测试机上没起 slidev 时一直 ok=false
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('happy：DB up + slidev up → 200 + status:ok', async () => {
    const res = await app.fetch(new Request('http://test/healthz'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      service: string
      checks: { db: { ok: boolean }; slidev: { ok: boolean } }
      gitSha: string
      uptimeSec: number
    }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('big-ppt-agent')
    expect(body.checks.db.ok).toBe(true)
    expect(body.checks.slidev.ok).toBe(true)
    expect(typeof body.uptimeSec).toBe('number')
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0)
  })

  it('返回部署注入的 GIT_SHA，供发布脚本校验版本', async () => {
    const previous = process.env.GIT_SHA
    process.env.GIT_SHA = '0123456789abcdef0123456789abcdef01234567'

    try {
      const res = await app.fetch(new Request('http://test/healthz'))
      const body = (await res.json()) as { gitSha: string }
      expect(body.gitSha).toBe(process.env.GIT_SHA)
    } finally {
      if (previous === undefined) delete process.env.GIT_SHA
      else process.env.GIT_SHA = previous
    }
  })

  it('Slidev 不通时 → 200 + status:degraded（agent 仍服务）', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await app.fetch(new Request('http://test/healthz'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      checks: { db: { ok: boolean }; slidev: { ok: boolean; error?: string } }
    }
    expect(body.status).toBe('degraded')
    expect(body.checks.db.ok).toBe(true)
    expect(body.checks.slidev.ok).toBe(false)
    expect(body.checks.slidev.error).toContain('ECONNREFUSED')
  })

  it('DB 不通时 → 503 + status:down', async () => {
    // 通过 mock getDb().execute() 抛错来模拟 DB down
    const dbModule = await import('../src/db/client.js')
    const fakeDb = {
      execute: vi.fn().mockRejectedValue(new Error('ER_ACCESS_DENIED')),
    }
    vi.spyOn(dbModule, 'getDb').mockReturnValue(fakeDb as never)

    const res = await app.fetch(new Request('http://test/healthz'))
    expect(res.status).toBe(503)
    const body = (await res.json()) as {
      status: string
      checks: { db: { ok: boolean; error?: string } }
    }
    expect(body.status).toBe('down')
    expect(body.checks.db.ok).toBe(false)
    expect(body.checks.db.error).toContain('ER_ACCESS_DENIED')
  })

  it('/api/healthz 与 /healthz 行为一致（mount alias）', async () => {
    const a = await app.fetch(new Request('http://test/healthz'))
    const b = await app.fetch(new Request('http://test/api/healthz'))
    expect(a.status).toBe(b.status)
    const aBody = (await a.json()) as { status: string; service: string }
    const bBody = (await b.json()) as { status: string; service: string }
    expect(aBody.status).toBe(bBody.status)
    expect(aBody.service).toBe(bBody.service)
  })

  it('不暴露 paths 等敏感内部信息（A09）', async () => {
    const res = await app.fetch(new Request('http://test/healthz'))
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('paths')
    expect(JSON.stringify(body)).not.toContain('/Users/')
    expect(JSON.stringify(body)).not.toContain('/root/')
    expect(JSON.stringify(body)).not.toContain('packages/')
  })
})
