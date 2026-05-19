/**
 * Phase 11.8 Task C: mood-board 两端点。
 *
 * - POST /api/decks/:id/mood-board/generate
 *   生成 3 张样张候选,落 deck_assets(purpose='mood-board-candidate')。
 *   per-deck 限 3 次(进程内存 Map,重启清零,严格一致性不重要)。
 *
 * - POST /api/decks/:id/anchor
 *   body { assetId }。选定锚图 → asset.purpose='anchor' + 同 deck 其它 candidate=discarded
 *   + decks.anchor_asset_id 写入。IDOR guard 三条件:asset 必须 deckId + userId 匹配 +
 *   purpose 当前 = 'mood-board-candidate'(防用户伪造 assetId 偷把任意行变 anchor)。
 *
 * 沿用 image-jobs.ts 同款路由风格(c.get('user') + getOwnedDeck-like guard)。
 */
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { type AuthVars } from '../middleware/auth.js'
import { getDb, decks, deckVersions, deckAssets } from '../db/index.js'
import { generateMoodBoard, MoodBoardGenError } from '../mood-board/index.js'
import { markAsAnchor } from '../db/deck-assets.js'
import { logServerEvent } from '../logger/server-log.js'

export const moodBoardRoute = new Hono<{ Variables: AuthVars }>()

/**
 * per-deck 累计 generate 次数(包含成功 + 失败,失败也算 1 次用以防滥用调度反复
 * 烧主 LLM token)。重启清零;严格一致性不需要(用户重连后从 0 重计上限可接受)。
 * 暴露 reset helper 给测试用。
 */
const generateCountByDeck = new Map<number, number>()
export const MAX_MOOD_BOARD_GENERATE_PER_DECK = 3

export function __resetMoodBoardRoutesForTesting(): void {
  generateCountByDeck.clear()
}

async function getOwnedDeck(userId: number, deckId: number) {
  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return { ok: false as const, status: 404 as const, error: 'deck 不存在' }
  if (deck.userId !== userId)
    return { ok: false as const, status: 403 as const, error: '无权访问该 deck' }
  return { ok: true as const, deck }
}

moodBoardRoute.post('/decks/:id{[0-9]+}/mood-board/generate', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  // per-deck 限频
  const prevCount = generateCountByDeck.get(deckId) ?? 0
  if (prevCount >= MAX_MOOD_BOARD_GENERATE_PER_DECK) {
    return c.json(
      {
        error: `本 deck 已达 ${MAX_MOOD_BOARD_GENERATE_PER_DECK} 次样张生成上限。3 次还不满意通常是 prompt engineering 问题,建议跳过用 text-only 模式继续。`,
        remaining: 0,
      },
      429,
    )
  }

  // 拿 deck 当前 content(给主 LLM 看大纲)
  let deckContent = ''
  if (check.deck.currentVersionId) {
    const db = getDb()
    const [v] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(
        and(
          eq(deckVersions.id, check.deck.currentVersionId),
          eq(deckVersions.deckId, deckId),
        ),
      )
      .limit(1)
    deckContent = v?.content ?? ''
  }
  if (!deckContent.trim()) {
    return c.json(
      { error: 'deck 内容为空,请先生成大纲后再选风格' },
      400,
    )
  }

  // 计数 +1(先增后跑,防并发请求同时通过限频检查)
  generateCountByDeck.set(deckId, prevCount + 1)

  try {
    const { candidates, retried, diversityDegraded } = await generateMoodBoard({
      deckId,
      userId: user.id,
      deckContent,
      templateId: check.deck.templateId,
    })
    return c.json({
      candidates: candidates.map((c) => ({
        assetId: c.assetId,
        style: c.style,
        prompt: c.prompt,
      })),
      retried,
      diversityDegraded,
      remaining: MAX_MOOD_BOARD_GENERATE_PER_DECK - (prevCount + 1),
    })
  } catch (err) {
    logServerEvent({
      category: 'mood-board',
      event: 'route-generate-failed',
      deckId,
      userId: user.id,
      errorMsg: (err as Error).message,
    })
    if (err instanceof MoodBoardGenError) {
      return c.json({ error: err.message }, 500)
    }
    return c.json({ error: `生成样张失败:${(err as Error).message}` }, 500)
  }
})

moodBoardRoute.post('/decks/:id{[0-9]+}/anchor', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  type Body = { assetId?: string }
  const body = await c.req.json<Body>().catch((): Body => ({}))
  const assetId = body.assetId?.trim()
  if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return c.json({ error: 'assetId 必填且必须是 uuid 格式' }, 400)
  }

  // IDOR guard 三条件:asset.deckId === deckId + asset.userId === user.id + purpose='mood-board-candidate'
  // (防用户伪造任意 assetId 把跨 deck / 跨 user / 已 discarded 的 asset 偷上位)
  const db = getDb()
  const [asset] = await db
    .select({
      id: deckAssets.id,
      deckId: deckAssets.deckId,
      userId: deckAssets.userId,
      purpose: deckAssets.purpose,
    })
    .from(deckAssets)
    .where(eq(deckAssets.id, assetId))
    .limit(1)
  if (!asset) return c.json({ error: 'asset 不存在' }, 404)
  if (asset.deckId !== deckId || asset.userId !== user.id) {
    return c.json({ error: '无权访问该 asset' }, 403)
  }
  if (asset.purpose !== 'mood-board-candidate') {
    return c.json(
      { error: '该 asset 不是当前 deck 的有效候选(可能已被丢弃或已选定)' },
      400,
    )
  }

  await markAsAnchor(deckId, assetId)
  // Phase 11.8 真阻塞:选定 anchor 也算"已决策",set anchorSkipped=true,工具入口
  // polling block 就能解锁(它检测 anchor_asset_id 写入或 anchorSkipped=true 任一即放行)。
  await db.update(decks).set({ anchorSkipped: true }).where(eq(decks.id, deckId))

  logServerEvent({
    category: 'mood-board',
    event: 'anchor-selected',
    deckId,
    userId: user.id,
    assetId,
  })

  return c.json({ ok: true, anchorAssetId: assetId })
})

/**
 * Phase 11.8 真阻塞:用户显式跳过 anchor 选样。
 * set decks.anchor_skipped = true → generate_slide_image 工具入口 polling block 解锁,
 * 允许无 anchor 生图(走 Phase 11.6 老路径)。
 *
 * 切模板时此字段会被 reset 为 false,触发下次走 image-gen 前重新走 modal 流程。
 */
moodBoardRoute.post('/decks/:id{[0-9]+}/anchor/skip', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const deckId = Number(c.req.param('id'))
  const check = await getOwnedDeck(user.id, deckId)
  if (!check.ok) return c.json({ error: check.error }, check.status)

  const db = getDb()
  await db.update(decks).set({ anchorSkipped: true }).where(eq(decks.id, deckId))

  logServerEvent({
    category: 'mood-board',
    event: 'anchor-skipped',
    deckId,
    userId: user.id,
  })

  return c.json({ ok: true, anchorSkipped: true })
})
