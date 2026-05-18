/**
 * Phase 15 Task 31-B:deck 归档导出路由(`.lumideck` 数据包)。
 *
 * 端点:
 *   GET /api/decks/:id/export-archive  →  application/zip stream(attachment)
 *
 * 设计抉择:
 * - **独立子路由文件**:Task C 会再扩 import 路由(POST /api/decks/import-archive);
 *   现在分文件挂载避免改 routes/decks.ts(它已 800+ 行)。
 * - **不写 `*` wildcard 中间件**:CLAUDE.md「Hono sub-router wildcard 泄漏」坑 —— 通过
 *   `app.route('/api', sub)` mount 时 `sub.use('*', ...)` 会拦截整个 /api/ 前缀,
 *   只用显式 path handler。
 * - **路径 `:id{[0-9]+}`**:让非数字 id(如 future `import-archive`)不会落到这里。
 * - **`Content-Length` 必带**:浏览器下载进度条依赖。`Buffer.length` 跟 `byteLength`
 *   语义相同(都是字节数)。
 * - **`filename` 处理`title` 内非法字符**:Win/Mac 文件系统不允许 `\/:*?"<>|`,替成 `_`。
 *   附 `Date.now()` 后缀避免重复下载同名覆盖。
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, decks } from '../db/index.js'
import { buildArchive } from '../archive/build-archive.js'
import { logServerEvent } from '../logger/server-log.js'
import type { AuthVars } from '../middleware/auth.js'

export const decksArchiveRoute = new Hono<{ Variables: AuthVars }>()

decksArchiveRoute.get('/decks/:id{[0-9]+}/export-archive', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const deckId = Number(c.req.param('id'))
  const db = getDb()
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
  if (!deck) return c.json({ error: 'deck 不存在' }, 404)
  if (deck.userId !== user.id) return c.json({ error: '无权访问该 deck' }, 403)

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
        'Content-Disposition': `attachment; filename="${filename}"`,
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
