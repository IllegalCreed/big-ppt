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
import { and, desc, eq } from 'drizzle-orm'
import type { TemplateManifest } from '@big-ppt/shared'
import { getDb, decks, deckVersions, deckAssets } from './db/index.js'
import { getManifest } from './templates/registry.js'
import { analyzeDeckPurity } from './templates/analyzeDeckPurity.js'
import { SIZE_AR_TOLERANCE } from './llm/image-dimensions.js'

export type SwitchJobState = 'pending' | 'snapshotting' | 'migrating' | 'success' | 'failed'

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
  /**
   * v1.5:切模板成功后是否自动按新模板色板重新生成所有 *-image-content 页的 AI 图。
   * 由路由 body.regenerateImages 传入,worker success 后 fire-and-forget 触发 N 个 image job。
   * 用户在前端通过现有 /api/image-jobs/<id> 单独轮询每张图进度。
   */
  regenerateImages?: boolean
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
  /** v1.5:成功后是否触发 N 个 image-content 页重新生图(按新模板色板) */
  regenerateImages?: boolean
}): SwitchJob {
  const job: SwitchJob = {
    id: randomUUID(),
    deckId: args.deckId,
    userId: args.userId,
    from: args.from,
    to: args.to,
    state: 'pending',
    startedAt: new Date(),
    regenerateImages: args.regenerateImages === true,
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

function imageSizesCompatible(
  source: { width: number; height: number },
  target: { width: number; height: number },
): boolean {
  const sourceRatio = source.width / source.height
  const targetRatio = target.width / target.height
  return Math.abs(sourceRatio - targetRatio) / targetRatio <= SIZE_AR_TOLERANCE
}

/**
 * Phase 7.5D-3：deterministic 字符串替换路径。
 *
 * 当两个模板的 layouts 都遵循 `<prefix>-<suffix>` 命名 + suffix 集合相等时，
 * 切模板可以通过仅替换 frontmatter `layout:` 行的前缀来完成，**完全跳过 LLM**。
 * 这是 plan 16 设计抉择 #5 + #12 的实现：archive pure deck 走此路径，字节级一致。
 *
 * 返回 null 表示模板对不满足 deterministic 条件，调用方应 fallback LLM。
 */
function templatePrefix(manifest: TemplateManifest): string {
  if (manifest.layouts.length === 0) return ''
  let prefix = manifest.layouts[0].name
  for (const l of manifest.layouts) {
    while (prefix.length > 0 && !l.name.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }
  return prefix
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function tryDeterministicSwitch(
  content: string,
  fromManifest: TemplateManifest,
  toManifest: TemplateManifest,
): string | null {
  const fromPrefix = templatePrefix(fromManifest)
  const toPrefix = templatePrefix(toManifest)
  if (!fromPrefix || !toPrefix) return null

  const fromSuffixes = new Set(fromManifest.layouts.map((l) => l.name.slice(fromPrefix.length)))
  const toSuffixes = new Set(toManifest.layouts.map((l) => l.name.slice(toPrefix.length)))
  if (fromSuffixes.size !== toSuffixes.size) return null
  for (const s of fromSuffixes) {
    if (!toSuffixes.has(s)) return null
  }

  return content.replace(
    new RegExp(`^(layout:\\s*)${escapeRegex(fromPrefix)}(\\S+)$`, 'gm'),
    `$1${toPrefix}$2`,
  )
}

/** 重写函数：由路由注入（生产实现用 LLM；测试实现直接返回模拟内容） */
export type RewriteFn = (args: {
  oldContent: string
  fromTemplateId: string
  toTemplateId: string
  userId: number
}) => Promise<string>

/** 执行切换流水；任一步失败会把 job 标 failed，不抛异常到调用方 */
export async function runSwitchJob(jobId: string, rewriteFn: RewriteFn): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return

  try {
    mutateJob(jobId, { state: 'snapshotting' })

    const db = getDb()
    const [deck] = await db.select().from(decks).where(eq(decks.id, job.deckId)).limit(1)
    if (!deck) throw new Error('deck 不存在')
    if (deck.userId !== job.userId) throw new Error('deck 所有权校验失败')
    if (deck.status === 'deleted') throw new Error('deck 已删除')

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
    // Phase 11.8: snapshot 也带 anchor_asset_id,让 restore 时能恢复切模板前的 anchor
    await db.insert(deckVersions).values({
      deckId: job.deckId,
      content: currentContent,
      message: `切换模板前快照 (${job.from} → ${job.to})`,
      templateId: job.from,
      anchorAssetId: deck.anchorAssetId,
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

    // Phase 7.5D-3：尝试 deterministic 路径——pure deck + 模板对兼容则跳 LLM
    const fromManifest = getManifest(job.from)
    const toManifest = getManifest(job.to)
    const purity = analyzeDeckPurity(currentContent)
    let rewritten: string | null = null

    if (purity.pure && fromManifest && toManifest) {
      rewritten = tryDeterministicSwitch(currentContent, fromManifest, toManifest)
    }

    if (rewritten === null) {
      // fallback：含 chart.js / 原创组件 / 模板对不兼容 → LLM 重写
      rewritten = await rewriteFn({
        oldContent: currentContent,
        fromTemplateId: job.from,
        toTemplateId: job.to,
        userId: job.userId,
      })
      if (!rewritten || typeof rewritten !== 'string' || rewritten.trim().length === 0) {
        throw new Error('LLM 返回空内容')
      }
    }

    // Phase 17: template layout and image style are independent choices. Preserve the
    // current anchor/free decision whenever the target image area has a compatible ratio;
    // only incompatible references return to the undecided state.
    let nextAnchorAssetId = deck.anchorAssetId
    let nextAnchorSkipped = deck.anchorSkipped
    if (deck.anchorAssetId && toManifest) {
      const [anchor] = await db
        .select({
          width: deckAssets.imageWidth,
          height: deckAssets.imageHeight,
          styleSource: deckAssets.styleSource,
        })
        .from(deckAssets)
        .where(
          and(
            eq(deckAssets.id, deck.anchorAssetId),
            eq(deckAssets.deckId, job.deckId),
            eq(deckAssets.userId, job.userId),
          ),
        )
        .limit(1)
      const targetSize = toManifest.imageGenSize ?? { width: 1536, height: 720 }
      const sourceSize =
        anchor?.width && anchor.height
          ? { width: anchor.width, height: anchor.height }
          : (fromManifest?.imageGenSize ?? { width: 1536, height: 720 })
      if (!anchor || !imageSizesCompatible(sourceSize, targetSize)) {
        nextAnchorAssetId = null
        nextAnchorSkipped = false
        if (anchor) {
          await db
            .update(deckAssets)
            .set({
              purpose:
                anchor.styleSource === 'system' || anchor.styleSource === 'user'
                  ? 'mood-board-discarded'
                  : 'mood-board-candidate',
            })
            .where(and(eq(deckAssets.id, deck.anchorAssetId), eq(deckAssets.deckId, job.deckId)))
        }
      }
    }

    // 插切换后 version + 更新 decks.template_id / current_version_id
    // Phase 17:新 version 记录兼容性判定后的 anchor；undo 仍可从 snapshot 恢复旧值。
    await db.insert(deckVersions).values({
      deckId: job.deckId,
      content: rewritten,
      message: `切换到模板 ${job.to}`,
      templateId: job.to,
      anchorAssetId: nextAnchorAssetId,
      authorId: job.userId,
    })
    const [newest] = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, job.deckId))
      .orderBy(desc(deckVersions.id))
      .limit(1)
    if (!newest) throw new Error('new version 回查失败')

    // 尺寸兼容时保留 preset/generated/free；不兼容才回 undecided。
    await db
      .update(decks)
      .set({
        templateId: job.to,
        currentVersionId: newest.id,
        anchorAssetId: nextAnchorAssetId,
        anchorSkipped: nextAnchorSkipped,
      })
      .where(eq(decks.id, job.deckId))

    mutateJob(jobId, {
      state: 'success',
      newVersionId: newest.id,
      finishedAt: new Date(),
    })

    // v1.5:用户勾选"切模板后重新生图"则 fire-and-forget 触发 N 个 image job。
    // 不阻塞 success 状态(前端立刻看到切模板成功),image job 由前端 useGenerateImageJob
    // 单独轮询 /api/image-jobs/<id> 跟踪进度。
    if (job.regenerateImages) {
      void (async () => {
        try {
          const { regenerateImageContentPages } = await import('./regenerate-image-pages.js')
          const r = await regenerateImageContentPages({
            deckId: job.deckId,
            userId: job.userId,
            newContent: rewritten,
          })
          console.log(
            `[switch-template ${jobId.slice(0, 8)}] regenerate-images: triggered=${r.triggered} skipped=${r.skipped}`,
          )
        } catch (err) {
          console.error(
            `[switch-template ${jobId.slice(0, 8)}] regenerate-images 失败:`,
            (err as Error).message,
          )
        }
      })()
    }
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
