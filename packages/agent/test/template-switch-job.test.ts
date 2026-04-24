/**
 * Phase 6D：template-switch-job 模块单测，补路由集成测试没覆盖到的分支。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  createJob,
  getJob,
  runSwitchJob,
  validateSwitchTarget,
  __resetJobsForTesting,
} from '../src/template-switch-job.js'
import { getDb, decks, deckVersions } from '../src/db/index.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { __resetTemplateRegistryForTesting } from '../src/templates/registry.js'
import { __resetPathsForTesting } from '../src/workspace.js'

useTestDb()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_MANIFEST_PATH = path.resolve(
  __dirname,
  '../../slidev/templates/company-standard/manifest.json',
)

let tmpRoot: string
let templatesRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-sw-job-'))
  templatesRoot = path.join(tmpRoot, 'packages/slidev/templates')
  fs.mkdirSync(templatesRoot, { recursive: true })
  const csDir = path.join(templatesRoot, 'company-standard')
  fs.mkdirSync(csDir)
  fs.copyFileSync(REAL_MANIFEST_PATH, path.join(csDir, 'manifest.json'))
  fs.writeFileSync(path.join(csDir, 'starter.md'), '# cs\n')

  const alphaDir = path.join(templatesRoot, 'alpha')
  fs.mkdirSync(alphaDir)
  fs.writeFileSync(
    path.join(alphaDir, 'manifest.json'),
    JSON.stringify({
      id: 'alpha',
      name: 'Alpha',
      description: 'x',
      thumbnail: 'c.png',
      logos: { primary: 'l.png' },
      promptPersona: 'p',
      starterSlidesPath: 'starter.md',
      layouts: [
        {
          name: 'cover',
          description: 'c',
          frontmatterSchema: {
            type: 'object',
            properties: { mainTitle: { type: 'string', description: 'x' } },
          },
        },
      ],
    }),
  )
  fs.writeFileSync(path.join(alphaDir, 'starter.md'), '# a\n')

  process.env.BIG_PPT_TEMPLATES_ROOT = templatesRoot
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetJobsForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_TEMPLATES_ROOT
  __resetPathsForTesting()
  __resetTemplateRegistryForTesting()
  __resetJobsForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('validateSwitchTarget', () => {
  it('空 targetTemplateId → 400', () => {
    const r = validateSwitchTarget('company-standard', '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('同 templateId → 400', () => {
    const r = validateSwitchTarget('alpha', 'alpha')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('非 string 类型 → 400', () => {
    const r = validateSwitchTarget('alpha', null as unknown as string)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('目标不存在 → 404', () => {
    const r = validateSwitchTarget('alpha', 'does-not-exist')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })

  it('合法目标 → ok', () => {
    expect(validateSwitchTarget('company-standard', 'alpha')).toEqual({ ok: true })
  })
})

describe('createJob / getJob', () => {
  it('createJob 返回独立快照，后续 mutate 不反向污染', () => {
    const snap = createJob({ deckId: 1, userId: 2, from: 'a', to: 'b' })
    expect(snap.state).toBe('pending')
    const again = getJob(snap.id)!
    expect(again.state).toBe('pending')
    // 尝试修改返回对象不影响实际存储
    ;(snap as any).state = 'success'
    expect(getJob(snap.id)!.state).toBe('pending')
  })

  it('getJob 未知 id 返回 null', () => {
    expect(getJob('no-such')).toBeNull()
  })
})

describe('runSwitchJob 边界分支', () => {
  it('job 不存在时直接 return，无异常', async () => {
    await expect(runSwitchJob('does-not-exist', async () => '')).resolves.toBeUndefined()
  })

  it('deck 不存在 → state=failed with "deck 不存在"', async () => {
    const job = createJob({ deckId: 999999, userId: 1, from: 'company-standard', to: 'alpha' })
    await runSwitchJob(job.id, async () => '---\nlayout: cover\nmainTitle: X\n---\n')
    const finalJob = getJob(job.id)!
    expect(finalJob.state).toBe('failed')
    expect(finalJob.error).toContain('deck 不存在')
  })

  it('deck.userId !== job.userId → state=failed ownership 校验错', async () => {
    const { user } = await createLoggedInUser('a@a.com')
    const { deck } = await createDeckDirect(user.id, 'X')
    const job = createJob({ deckId: deck.id, userId: 999, from: 'company-standard', to: 'alpha' })
    await runSwitchJob(job.id, async () => '---\nlayout: cover\nmainTitle: X\n---\n')
    const finalJob = getJob(job.id)!
    expect(finalJob.state).toBe('failed')
    expect(finalJob.error).toContain('所有权')
  })

  it('currentVersionId=null 也能跑完，snapshot 内容为空串', async () => {
    const { user } = await createLoggedInUser('b@a.com')
    const db = getDb()
    await db.insert(decks).values({ userId: user.id, title: 'NoVer' })
    const [created] = await db
      .select()
      .from(decks)
      .where(eq(decks.userId, user.id))
      .limit(1)
    // 故意不建 version（currentVersionId 为 null）
    const job = createJob({
      deckId: created!.id,
      userId: user.id,
      from: 'company-standard',
      to: 'alpha',
    })
    await runSwitchJob(job.id, async () => '---\nlayout: cover\nmainTitle: X\n---\n')
    const finalJob = getJob(job.id)!
    expect(finalJob.state).toBe('success')
    expect(finalJob.snapshotVersionId).toBeTypeOf('number')
    const [snapshot] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, finalJob.snapshotVersionId!))
      .limit(1)
    expect(snapshot!.content).toBe('')
  })

  it('rewriteFn 返回非 string → state=failed', async () => {
    const { user } = await createLoggedInUser('c@a.com')
    const { deck } = await createDeckDirect(user.id, 'BadReturn')
    const job = createJob({
      deckId: deck.id,
      userId: user.id,
      from: 'company-standard',
      to: 'alpha',
    })
    await runSwitchJob(job.id, async () => null as unknown as string)
    const finalJob = getJob(job.id)!
    expect(finalJob.state).toBe('failed')
    expect(finalJob.error).toContain('LLM 返回空内容')
  })
})
