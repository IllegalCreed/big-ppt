/**
 * Phase 7.5D-3：deterministic 切模板路径集成测试。
 *
 * 当两个真模板（beitou-standard / jingyeda-standard）都遵循 layer-1 5 个
 * `<prefix>-<suffix>` 命名 + suffix 集合相等时，pure deck 切模板**不调** rewriteFn，
 * 直接走字符串前缀替换。本测试用真 manifest 验证整条流水。
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
import {
  __resetJobsForTesting,
  type RewriteFn,
  tryDeterministicSwitch,
} from '../src/template-switch-job.js'
import { __resetForTesting as resetSlidevLock } from '../src/slidev-lock.js'
import { getManifest } from '../src/templates/registry.js'

useTestDb()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SLIDEV_TEMPLATES_DIR = path.resolve(__dirname, '../../slidev/templates')

let tmpRoot: string

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
): Promise<{ job: { state: string; from: string; to: string; newVersionId: number } }> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await app.request(`/api/switch-template-jobs/${jobId}`, {
      headers: { Cookie: cookie },
    })
    if (res.status === 200) {
      const json = (await res.json()) as {
        job: { state: string; from: string; to: string; newVersionId: number }
      }
      if (json.job.state === expected) return json
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`job ${jobId} 未在 ${timeoutMs}ms 内到达 ${expected}`)
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-det-'))
  const templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  fs.mkdirSync(templatesRoot, { recursive: true })
  // copy 真 beitou + jingyeda 进 tmp（manifest + starter）
  for (const id of ['beitou-standard', 'jingyeda-standard'] as const) {
    const dst = path.join(templatesRoot, id)
    fs.mkdirSync(dst)
    fs.copyFileSync(
      path.join(SLIDEV_TEMPLATES_DIR, id, 'manifest.json'),
      path.join(dst, 'manifest.json'),
    )
    fs.writeFileSync(
      path.join(dst, 'starter.md'),
      `---\nlayout: ${id === 'beitou-standard' ? 'beitou-cover' : 'jingyeda-cover'}\nmainTitle: 占位\n---\n`,
    )
  }
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

describe('tryDeterministicSwitch（unit）', () => {
  it('beitou ↔ jingyeda：layer-1 5 个 1:1，前缀替换成功', () => {
    const fromM = getManifest('beitou-standard')!
    const toM = getManifest('jingyeda-standard')!
    const out = tryDeterministicSwitch(
      `---\nlayout: beitou-cover\nmainTitle: A\n---\n\n---\nlayout: beitou-content\nheading: B\n---\n\n正文`,
      fromM,
      toM,
    )
    expect(out).not.toBeNull()
    expect(out).toContain('layout: jingyeda-cover')
    expect(out).toContain('layout: jingyeda-content')
    expect(out).not.toContain('layout: beitou-')
  })

  it('两套模板 layout suffix 集合不同 → 返回 null（fallback LLM）', () => {
    const fromM = getManifest('beitou-standard')!
    // 构造一个 mock 模板，layout 数量与 beitou 不一致
    const toM = {
      ...fromM,
      id: 'mock',
      layouts: [{ ...fromM.layouts[0], name: 'mock-only-cover' }],
    }
    const out = tryDeterministicSwitch('---\nlayout: beitou-cover\nmainTitle: X\n---\n', fromM, toM)
    expect(out).toBeNull()
  })

  it('保留 body / frontmatter 其他字段不变，仅替换 layout 行', () => {
    const fromM = getManifest('beitou-standard')!
    const toM = getManifest('jingyeda-standard')!
    const input =
      '---\nlayout: beitou-content\nheading: 关键指标\n---\n\n<MetricCard value="89" unit="%" label="留存率" />\n'
    const out = tryDeterministicSwitch(input, fromM, toM)
    expect(out).toContain('layout: jingyeda-content')
    expect(out).toContain('heading: 关键指标')
    expect(out).toContain('<MetricCard value="89" unit="%" label="留存率" />')
  })
})

describe('runSwitchJob deterministic 集成路径', () => {
  it('pure deck（layer-1 + 公共组件）→ 跳 LLM，content 走字符串替换', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('det-pure@a.com')
    const { deck } = await createDeckDirect(
      user.id,
      'PureDeck',
      `---\nlayout: beitou-cover\nmainTitle: 纯净 deck\n---\n\n---\nlayout: beitou-content\nheading: 关键\n---\n\n<MetricCard value="89" unit="%" label="留存率" />\n`,
    )

    // 注入会 throw 的 rewriteFn——如果走 LLM 路径会 fail
    const rewriteFn: RewriteFn = async () => {
      throw new Error('rewriteFn 不应被调用：deck 是 pure，应走 deterministic')
    }
    __setRewriteFnForTesting(rewriteFn)

    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'jingyeda-standard', confirmed: true },
      cookie,
    )
    expect(res.status).toBe(200)
    const { jobId } = (await res.json()) as { jobId: string }

    const { job } = await waitForJobState(app, jobId, cookie, 'success')

    // 验证新 version 内容由 deterministic 替换得到
    const db = getDb()
    const [newest] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, job.newVersionId))
      .limit(1)
    expect(newest!.content).toContain('layout: jingyeda-cover')
    expect(newest!.content).toContain('layout: jingyeda-content')
    expect(newest!.content).not.toContain('layout: beitou-')
    // body 公共组件标签字面保留
    expect(newest!.content).toContain('<MetricCard value="89" unit="%" label="留存率" />')

    const [updatedDeck] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updatedDeck!.templateId).toBe('jingyeda-standard')
  })

  it('not-pure deck（含 <script setup>）→ fallback LLM 路径', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser('det-impure@a.com')
    const { deck } = await createDeckDirect(
      user.id,
      'ImpureDeck',
      `---\nlayout: beitou-content\nheading: 自定义\n---\n\n<script setup>\nconst x = 1\n</script>\n\n<div>{{ x }}</div>\n`,
    )

    // 注入正常 rewriteFn——not-pure 应该真调用它
    const rewritten = '---\nlayout: jingyeda-content\nheading: AI 重写后\n---\n\n纯文本\n'
    let rewriteFnCalled = false
    const rewriteFn: RewriteFn = async () => {
      rewriteFnCalled = true
      return rewritten
    }
    __setRewriteFnForTesting(rewriteFn)

    const res = await postJson(
      app,
      `/api/decks/${deck.id}/switch-template`,
      { targetTemplateId: 'jingyeda-standard', confirmed: true },
      cookie,
    )
    const { jobId } = (await res.json()) as { jobId: string }
    const { job } = await waitForJobState(app, jobId, cookie, 'success')

    expect(rewriteFnCalled).toBe(true)
    const db = getDb()
    const [newest] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, job.newVersionId))
      .limit(1)
    expect(newest!.content).toBe(rewritten)
  })
})
