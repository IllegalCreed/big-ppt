/**
 * Phase 6D：模板切换 job 管理器（进程内内存）。
 *
 * 状态机：pending → snapshotting → migrating → success | failed
 * 重启丢失可接受（切模板是用户主动触发，失败重来即可，DB 已有 snapshot 可 /undo）。
 *
 * 执行流水：
 *  1. snapshotting —— 插入「切换前快照」version（current_version_id 不动，作为"可回滚点"）
 *  2. migrating   —— 调 rewriteFn 把旧 md 按新模板规则重写；失败则标 failed
 *  3. success     —— 插入「切换后」version + 更新 decks.template_id + current_version_id 指向新 version
 */
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb, decks, deckVersions } from './db/index.js'
import { getManifest } from './templates/registry.js'

export type SwitchJobState =
  | 'pending'
  | 'snapshotting'
  | 'migrating'
  | 'success'
  | 'failed'

export interface SwitchJob {
  id: string
  deckId: number
  userId: number
  from: string
  to: string
  state: SwitchJobState
  error?: string
  startedAt: Date
  finishedAt?: Date
  /** 执行过程中创建的 version id（snapshot 版 + 切换后版）。供观测用 */
  snapshotVersionId?: number
  newVersionId?: number
}

const jobs = new Map<string, SwitchJob>()

export function __resetJobsForTesting(): void {
  jobs.clear()
}

export function createJob(args: {
  deckId: number
  userId: number
  from: string
  to: string
}): SwitchJob {
  const job: SwitchJob = {
    id: randomUUID(),
    deckId: args.deckId,
    userId: args.userId,
    from: args.from,
    to: args.to,
    state: 'pending',
    startedAt: new Date(),
  }
  jobs.set(job.id, job)
  return { ...job }
}

export function getJob(id: string): SwitchJob | null {
  const job = jobs.get(id)
  return job ? { ...job } : null
}

function mutateJob(id: string, patch: Partial<SwitchJob>): void {
  const existing = jobs.get(id)
  if (!existing) return
  jobs.set(id, { ...existing, ...patch })
}

/** 重写函数：由路由注入（生产实现用 LLM；测试实现直接返回模拟内容） */
export type RewriteFn = (args: {
  oldContent: string
  fromTemplateId: string
  toTemplateId: string
  userId: number
}) => Promise<string>

/** 执行切换流水；任一步失败会把 job 标 failed，不抛异常到调用方 */
export async function runSwitchJob(
  jobId: string,
  rewriteFn: RewriteFn,
): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return

  try {
    mutateJob(jobId, { state: 'snapshotting' })

    const db = getDb()
    const [deck] = await db.select().from(decks).where(eq(decks.id, job.deckId)).limit(1)
    if (!deck) throw new Error('deck 不存在')
    if (deck.userId !== job.userId) throw new Error('deck 所有权校验失败')

    // 查当前 content 作为 snapshot 源
    let currentContent = ''
    if (deck.currentVersionId) {
      const [cur] = await db
        .select({ content: deckVersions.content })
        .from(deckVersions)
        .where(eq(deckVersions.id, deck.currentVersionId))
        .limit(1)
      currentContent = cur?.content ?? ''
    }

    // 插 snapshot version（current_version_id 暂不动，作为可回滚锚点）
    await db.insert(deckVersions).values({
      deckId: job.deckId,
      content: currentContent,
      message: `切换模板前快照 (${job.from} → ${job.to})`,
      authorId: job.userId,
    })
    const [snapshot] = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, job.deckId))
      .orderBy(desc(deckVersions.id))
      .limit(1)
    if (!snapshot) throw new Error('snapshot 回查失败')
    mutateJob(jobId, { snapshotVersionId: snapshot.id, state: 'migrating' })

    const rewritten = await rewriteFn({
      oldContent: currentContent,
      fromTemplateId: job.from,
      toTemplateId: job.to,
      userId: job.userId,
    })
    if (!rewritten || typeof rewritten !== 'string' || rewritten.trim().length === 0) {
      throw new Error('LLM 返回空内容')
    }

    // 插切换后 version + 更新 decks.template_id / current_version_id
    await db.insert(deckVersions).values({
      deckId: job.deckId,
      content: rewritten,
      message: `切换到模板 ${job.to}`,
      authorId: job.userId,
    })
    const [newest] = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, job.deckId))
      .orderBy(desc(deckVersions.id))
      .limit(1)
    if (!newest) throw new Error('new version 回查失败')

    await db
      .update(decks)
      .set({ templateId: job.to, currentVersionId: newest.id })
      .where(eq(decks.id, job.deckId))

    mutateJob(jobId, {
      state: 'success',
      newVersionId: newest.id,
      finishedAt: new Date(),
    })
  } catch (err) {
    mutateJob(jobId, {
      state: 'failed',
      error: (err as Error).message,
      finishedAt: new Date(),
    })
  }
}

/** 启动前的白名单校验（路由层调用，免启动 job 再失败）；合法则返回 { ok: true } */
export function validateSwitchTarget(
  from: string,
  to: string,
): { ok: true } | { ok: false; status: 400 | 404; error: string } {
  if (!to || typeof to !== 'string') {
    return { ok: false, status: 400, error: 'targetTemplateId 必填' }
  }
  if (from === to) {
    return { ok: false, status: 400, error: '目标模板与当前模板一致' }
  }
  if (!getManifest(to)) {
    return { ok: false, status: 404, error: `目标模板 ${to} 不存在` }
  }
  return { ok: true }
}
