/**
 * Phase 6D：switch-template 路由 + job 流水集成测试。
 *
 * - 构造 tmp templates/ 包含 2 个合法 manifest（beitou-standard + alpha），支撑互切
 * - 通过 __setRewriteFnForTesting 注入 mock rewrite，避免真连 LLM
 * - runSwitchJob 是异步 fire-and-forget，测试用 poll 等 job 到终态
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { decksRoute, __setRewriteFnForTesting } from '../src/routes/decks.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { getDb, decks, deckVersions } from '../src/db/index.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { __resetJobsForTesting, type RewriteFn } from '../src/template-switch-job.js'
import { __resetForTesting as resetSlidevLock, tryAcquire } from '../src/slidev-lock.js'

useTestDb()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/beitou-standard/manifest.json',
)

let tmpRoot: string
let templatesRoot: string

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', decksRoute)
  return app
}

async function postJson(app: Hono, url: string, body: unknown, cookie?: string) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

async function waitForJobState(
  app: Hono,
  jobId: string,
  cookie: string,
  expected: 'success' | 'failed',
  timeoutMs = 2000,
): Promise<{ job: any }> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await app.request(`/api/switch-template-jobs/${jobId}`, {
      headers: { Cookie: cookie },
    })
    if (res.status === 200) {
      const json = (await res.json()) as { job: any }
      if (json.job.state === expected) return json
      if (json.job.state === 'failed' && expected === 'success') {
        throw new Error(`job 意外 failed: ${json.job.error}`)
      }
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`job ${jobId} 未在 ${timeoutMs}ms 内到达 ${expected}`)
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-switch-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  fs.mkdirSync(templatesRoot, { recursive: true })

  const csDir = path.join(templatesRoot, 'beitou-standard')
  fs.mkdirSync(csDir)
  fs.copyFileSync(REAL_MANIFEST_PATH, path.join(csDir, 'manifest.json'))
  fs.writeFileSync(
    path.join(csDir, 'starter.md'),
    '---\nlayout: cover\nmainTitle: CS\n---\n',
  )

  // 第二套模板 fixture，用来支持互切
  const alphaDir = path.join(templatesRoot, 'alpha')
  fs.mkdirSync(alphaDir)
  fs.writeFileSync(
    path.join(alphaDir, 'manifest.json'),
    JSON.stringify({
      id: 'alpha',
      name: 'Alpha 测试模板',
      description: 'fixture for switch-template test',
      thumbnail: 'cover.png',
      logos: { primary: 'logo.png' },
      promptPersona: 'alpha 定位',
      starterSlidesPath: 'starter.md',
      layouts: [
        {
          name: 'cover',
          description: '封面',
          frontmatterSchema: {
            type: 'object',
            required: ['mainTitle'],
            properties: { mainTitle: { type: 'string', description: '主标题' } },
          },
        },
      ],
    }),
  )
  fs.writeFileSync(
    path.join(alphaDir, 'starter.md'),
    '---\nlayout: cover\nmainTitle: ALPHA\n---\n',
  )

  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetJobsForTesting()
  resetSlidevLock()
  __setRewriteFnForTesting(null)
})

afterEach(() => {
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetJobsForTesting()
  resetSlidevLock()
  __setRewriteFnForTesting(null)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('POST /api/decks/:id/switch-template', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await postJson(app, '/api/decks/1/switch-template', {
      targetTemplateId: 'alpha',
      confirmed: true,
    })
    expect(res.status).toBe(401)
  })

  it('跨用户 deck → 403', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(a.user.id, 'A owned')
    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      b.cookie,
    )
    expect(res.status).toBe(403)
  })

  it('confirmed != true → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D')
    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha' },
      cookie,
    )
    expect(res.status).toBe(400)
  })

  it('目标 template 不存在 → 404', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D')
    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'not-found', confirmed: true },
      cookie,
    )
    expect(res.status).toBe(404)
  })

  it('目标与当前一致 → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D')
    // createDeckDirect 默认 DB default template_id=beitou-standard
    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'beitou-standard', confirmed: true },
      cookie,
    )
    expect(res.status).toBe(400)
  })

  it('deck 被他人占用 → 409', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(b.user.id, 'Bowned')
    // a 占用 b 的 deck 的锁（模拟跨用户占用；逻辑上不太可能，但锁检查只看 holder.userId != me.id）
    tryAcquire({
      sessionId: a.sid,
      userId: a.user.id,
      userEmail: 'a@a.com',
      deckId: deck.id,
      deckTitle: 'Bowned',
    })
    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      b.cookie,
    )
    expect(res.status).toBe(409)
  })

  it('成功路径：state 穿过 snapshotting→migrating→success；deck_versions +2 且 template_id 更新', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'Happy')

    // mock rewrite：返回固定 md
    const rewritten = '---\nlayout: cover\nmainTitle: 切后内容\n---\n'
    const rewriteFn: RewriteFn = async () => rewritten
    __setRewriteFnForTesting(rewriteFn)

    const db = getDb()
    const [{ count: beforeCount }] = (await db
      .select({ count: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, deck.id))) as any
    // ^ 粗略：实际我们用下面 .length 统计
    const beforeRows = await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id))
    expect(beforeRows.length).toBe(1)

    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      cookie,
    )
    expect(res.status).toBe(200)
    const { jobId } = await res.json()

    const { job } = await waitForJobState(app, jobId, cookie, 'success')
    expect(job.from).toBe('beitou-standard')
    expect(job.to).toBe('alpha')
    expect(job.snapshotVersionId).toBeTypeOf('number')
    expect(job.newVersionId).toBeTypeOf('number')

    const afterRows = await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id))
    expect(afterRows.length).toBe(3) // initial + snapshot + 切后
    const snapshot = afterRows.find((v) => v.id === job.snapshotVersionId)!
    expect(snapshot.message).toContain('切换模板前快照')
    const newest = afterRows.find((v) => v.id === job.newVersionId)!
    expect(newest.content).toBe(rewritten)
    expect(newest.message).toContain('切换到模板 alpha')

    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated!.templateId).toBe('alpha')
    expect(updated!.currentVersionId).toBe(job.newVersionId)
  })

  it('失败回滚：rewrite 抛错 → job.failed + template_id 未改 + snapshot 仍保留', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'FailPath')

    const rewriteFn: RewriteFn = async () => {
      throw new Error('LLM 假装挂了')
    }
    __setRewriteFnForTesting(rewriteFn)

    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      cookie,
    )
    const { jobId } = await res.json()

    const { job } = await waitForJobState(app, jobId, cookie, 'failed')
    expect(job.error).toContain('LLM 假装挂了')

    const db = getDb()
    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated!.templateId).toBe('beitou-standard') // 未改
    // snapshot 仍在（failed 时不回滚已写入的 snapshot row）
    const vs = await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id))
    expect(vs.find((v) => v.id === job.snapshotVersionId)?.message).toContain('切换模板前快照')
  })

  it('失败回滚：rewrite 返回空串 → job.failed', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'EmptyRet')

    __setRewriteFnForTesting(async () => '   ')

    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      cookie,
    )
    const { jobId } = await res.json()
    const { job } = await waitForJobState(app, jobId, cookie, 'failed')
    expect(job.error).toContain('LLM 返回空内容')
  })
})

describe('GET /api/switch-template-jobs/:jobId', () => {
  it('未登录 → 401', async () => {
    const app = makeApp()
    const res = await app.request('/api/switch-template-jobs/any')
    expect(res.status).toBe(401)
  })

  it('不存在 → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const res = await app.request('/api/switch-template-jobs/no-such', {
      headers: { Cookie: cookie },
    })
    expect(res.status).toBe(404)
  })

  it('跨用户 → 403', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(a.user.id, 'Aowned')
    __setRewriteFnForTesting(async () => '---\nlayout: cover\nmainTitle: X\n---\n')

    const start = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'alpha', confirmed: true },
      a.cookie,
    )
    const { jobId } = await start.json()
    await waitForJobState(app, jobId, a.cookie, 'success')

    const res = await app.request(`/api/switch-template-jobs/${jobId}`, {
      headers: { Cookie: b.cookie },
    })
    expect(res.status).toBe(403)
  })
})
