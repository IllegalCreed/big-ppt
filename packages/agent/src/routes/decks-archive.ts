/**
 * Phase 15 Task 31-B/C:deck 归档导出 + 导入路由(`.lumideck` 数据包)。
 *
 * 端点:
 *   GET  /api/decks/:id/export-archive  →  application/zip stream(attachment)
 *   POST /api/decks/import              →  multipart/form-data 上传 .lumideck 还原成新 deck
 *
 * 设计抉择:
 * - **独立子路由文件**:Phase 15 import + export 都在这里,避免改已 800+ 行的 decks.ts。
 * - **不写 `*` wildcard 中间件**:CLAUDE.md「Hono sub-router wildcard 泄漏」坑 —— 通过
 *   `app.route('/api', sub)` mount 时 `sub.use('*', ...)` 会拦截整个 /api/ 前缀,
 *   只用显式 path handler。
 * - **路径 `:id{[0-9]+}`**:让非数字 id(如 `import`)不会落到 export route。
 * - **import 路由路径用 `/decks/import`**(非 `/decks/import-archive`):跟 plan 31 一致;
 *   `:id{[0-9]+}` regex 保证 export 不会误吞 'import' 这种字符串 id。
 * - **`Content-Length` 必带**:浏览器下载进度条依赖。
 * - **`filename` 处理`title` 内非法字符**:Win/Mac 文件系统不允许 `\/:*?"<>|`,替成 `_`。
 *
 * import 抉择:
 * - **每张 asset 重发 uuid**:避免跟现有 row id 冲突,顺带让 rewriteAssetUrls 必须真跑。
 * - **DB transaction 包 deck + version + assets**:任一步失败整体回滚。
 * - **新 deck 用 `desc(id).limit(1)` 回查**:跟 routes/decks.ts createDeck 同套路;
 *   dogfood 期单用户不并发,可接受。
 * - **`vi.stubEnv('LUMIDECK_IMPORT_MAX_BYTES', '100')`** 让小文件就能触发 413,测试时
 *   `afterEach(() => vi.unstubAllEnvs())` 复位(CLAUDE.md 已知坑「testing seam 复位」)。
 */
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { getDb, decks, deckVersions, deckAssets } from '../db/index.js'
import { buildArchive } from '../archive/build-archive.js'
import { parseArchive } from '../archive/parse-archive.js'
import { rewriteAssetUrls } from '../archive/rewrite-asset-urls.js'
import { ArchiveError } from '../archive/errors.js'
import { logServerEvent } from '../logger/server-log.js'
import { contentDisposition } from '../utils/content-disposition.js'
import { getManifest } from '../templates/registry.js'
import type { AuthVars } from '../middleware/auth.js'
import type { ImportArchiveResponse } from '@big-ppt/shared'

export const decksArchiveRoute = new Hono<{ Variables: AuthVars }>()

/** 100MB 默认上限;测试可 `vi.stubEnv('LUMIDECK_IMPORT_MAX_BYTES', '100')` 覆盖。 */
const DEFAULT_IMPORT_MAX_BYTES = 100 * 1024 * 1024
function getImportMaxBytes(): number {
  const raw = process.env.LUMIDECK_IMPORT_MAX_BYTES
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IMPORT_MAX_BYTES
}

decksArchiveRoute.get('/decks/:id{[0-9]+}/export-archive', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return c.json({ error: 'deck 不存在' }, 404)
  if (deck.userId !== user.id) return c.json({ error: '无权访问该 deck' }, 403)
  if (deck.status === 'deleted') return c.json({ error: 'deck 已删除' }, 404)

  try {
    const buf = await buildArchive({ deckId, userId: user.id })
    logServerEvent({
      category: 'archive-export',
      event: 'success',
      deckId,
      userId: user.id,
      bytesSize: buf.length,
    })

    // 文件名:safe(title) + 时间戳防覆盖。`.lumideck` 是 .zip 别名,内容是合法 zip。
    const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_')
    const filename = `${safeName}-${Date.now()}.lumideck`
    // Node Buffer 的 underlying ArrayBufferLike 在新 TS 下不兼容 BodyInit 期望的
    // ArrayBuffer,复制到全新 ArrayBuffer-backed Uint8Array(跟 routes/assets.ts 同套路)。
    const u8 = new Uint8Array(buf.length)
    u8.set(buf)
    return new Response(u8, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(buf.length),
        'Content-Disposition': contentDisposition('attachment', filename),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    logServerEvent({
      category: 'archive-export',
      event: 'failed',
      deckId,
      userId: user.id,
      errorMsg: (err as Error).message,
    })
    return c.json({ error: '导出失败,请稍后重试' }, 500)
  }
})

decksArchiveRoute.post('/decks/import', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  // 1. 接 multipart 文件:Hono parseBody 对 multipart/form-data 自动把 file 字段返成 File
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) {
    return c.json({ error: '请上传 .lumideck 文件(form 字段名 file)' }, 400)
  }

  // 大小闸门:size 限制提前看(避免 arrayBuffer() 把整个大文件读进内存才 reject)
  const max = getImportMaxBytes()
  if (file.size > max) {
    return c.json({ error: `数据包超过 ${Math.round(max / 1024 / 1024)}MB 上限` }, 413)
  }

  const buf = Buffer.from(await file.arrayBuffer())

  // 2. parse + validate
  let parsed: Awaited<ReturnType<typeof parseArchive>>
  try {
    parsed = await parseArchive(buf)
  } catch (err) {
    if (err instanceof ArchiveError) {
      logServerEvent({
        category: 'archive-import',
        event: 'parse-failed',
        userId: user.id,
        errorCode: err.code,
        errorMsg: err.userMessage,
      })
      return c.json({ error: err.userMessage, code: err.code }, 400)
    }
    logServerEvent({
      category: 'archive-import',
      event: 'parse-failed',
      userId: user.id,
      errorMsg: (err as Error).message,
    })
    return c.json({ error: '数据包损坏' }, 400)
  }

  // 3. templateId whitelist:跟 routes/decks.ts POST /api/decks 一致(line 92-94),
  //    防用户拿未来版本 / dev 自定义模板出的包来 import 出 silent dysfunctional deck
  //    (manifest 找不到 → buildSystemPrompt / generate-slide-image / template-switch
  //    全走 nil-guard fallback,预览空 / AI 出图崩 / 切模板挂)。明确报错让用户重新导出。
  const tplId = parsed.manifest.deck.templateId
  if (!getManifest(tplId)) {
    logServerEvent({
      category: 'archive-import',
      event: 'template-unknown',
      userId: user.id,
      templateId: tplId,
    })
    return c.json(
      {
        error: `数据包引用了当前实例不支持的模板「${tplId}」,请用对应版本 Lumideck 重新导出`,
        code: 'template-unknown',
      },
      400,
    )
  }

  // 4. DB transaction:create deck + version + 还原 assets(rewrite URL)
  const db = getDb()
  // O(1) lookup asset meta(原 .find() O(N) scan,N 张 asset 整体 O(N²))
  const metaByOldId = new Map(parsed.manifest.assets.map((a) => [a.id, a]))
  let result: ImportArchiveResponse
  try {
    result = await db.transaction(async (tx) => {
      const newTitle = `${parsed.manifest.deck.title}(导入)`
      await tx.insert(decks).values({
        userId: user.id,
        title: newTitle,
        templateId: parsed.manifest.deck.templateId,
        anchorSkipped: parsed.manifest.deck.anchorSkipped,
      })
      const [created] = await tx
        .select({ id: decks.id })
        .from(decks)
        .where(eq(decks.userId, user.id))
        .orderBy(desc(decks.id))
        .limit(1)
      if (!created) throw new Error('deck 回查失败')

      // 建 idMap:每张原 asset 用新 uuid 重插,避免跟现有 deck_assets row id 冲突
      const idMap = new Map<string, string>()
      const importedSourceByOldId = new Map<string, 'system' | 'explore' | null>()
      for (const [oldId, bytes] of parsed.assets.entries()) {
        const newId = randomUUID()
        const meta = metaByOldId.get(oldId)!
        // 账号级 user preset 不随包迁移；导入后降级为可继续使用/重新保存的 deck-local 风格。
        const importedStyleSource = meta.styleSource === 'user' ? 'explore' : meta.styleSource
        await tx.insert(deckAssets).values({
          id: newId,
          deckId: created.id,
          userId: user.id,
          mimeType: meta.mimeType,
          bytesSize: meta.bytesSize,
          data: bytes,
          prompt: meta.prompt,
          model: meta.model,
          style: meta.style,
          purpose: meta.purpose,
          styleSource: importedStyleSource,
          // explore 来源的稳定 id 就是 deck asset 自身；重发 UUID 后必须同步映射。
          styleSourceId: importedStyleSource === 'explore' ? newId : meta.styleSourceId,
          stylePalettePolicy: meta.stylePalettePolicy,
          stylePrompt: meta.stylePrompt,
          imageWidth: meta.imageWidth,
          imageHeight: meta.imageHeight,
        })
        idMap.set(oldId, newId)
        importedSourceByOldId.set(oldId, importedStyleSource)
      }

      const oldAnchorId = parsed.manifest.deck.anchorAssetId
      const newAnchorId = oldAnchorId ? (idMap.get(oldAnchorId) ?? null) : null
      if (oldAnchorId && !newAnchorId) {
        throw new Error('archive anchor id 映射失败')
      }

      // deck pointer 是当前状态权威来源；历史包里的 asset purpose 可能漂移，导入时规范化。
      if (newAnchorId) {
        const importedAnchorSource = importedSourceByOldId.get(oldAnchorId!) ?? null
        const purpose = importedAnchorSource === 'system' ? 'style-preset-anchor' : 'anchor'
        await tx.update(deckAssets).set({ purpose }).where(eq(deckAssets.id, newAnchorId))
      }

      // rewrite markdown 内 /api/assets/<oldId> → /api/assets/<newId>
      const newContent = rewriteAssetUrls(parsed.content, idMap)
      await tx.insert(deckVersions).values({
        deckId: created.id,
        content: newContent,
        message: `从 .lumideck 导入(原 deck #${parsed.manifest.deck.originalDeckId})`,
        templateId: parsed.manifest.deck.templateId,
        anchorAssetId: newAnchorId,
        authorId: user.id,
      })
      const [firstVer] = await tx
        .select({ id: deckVersions.id })
        .from(deckVersions)
        .where(eq(deckVersions.deckId, created.id))
        .orderBy(desc(deckVersions.id))
        .limit(1)
      if (!firstVer) throw new Error('version 回查失败')

      await tx
        .update(decks)
        .set({
          currentVersionId: firstVer.id,
          anchorAssetId: newAnchorId,
          anchorSkipped: parsed.manifest.deck.anchorSkipped,
        })
        .where(eq(decks.id, created.id))

      return { deckId: created.id, title: newTitle }
    })
  } catch (err) {
    logServerEvent({
      category: 'archive-import',
      event: 'db-failed',
      userId: user.id,
      errorMsg: (err as Error).message,
    })
    return c.json({ error: '还原失败,请重试' }, 500)
  }

  logServerEvent({
    category: 'archive-import',
    event: 'success',
    userId: user.id,
    deckId: result.deckId,
    assetCount: parsed.assets.size,
  })
  return c.json(result, 201)
})
