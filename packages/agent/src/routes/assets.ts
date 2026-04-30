/**
 * Phase 11.5：deck assets serving 路由。
 *
 * 鉴权要点:
 * - 必走 requireAuth(本路由内逐个 handler 检 user,因 app.ts 用 authOptional global)
 * - 跨用户 GET 拒绝 403
 * - 响应不泄露字节(403 不带 body)
 *
 * Header 要点:
 * - Content-Type / Content-Length 准确
 * - Cache-Control: private, max-age=86400(同源浏览器缓存,避免反复读 BLOB)
 * - X-Content-Type-Options: nosniff(防 mime sniffing 攻击)
 *
 * Slidev 内 <img> 同源 fetch /api/assets/<id> 会自动带 session cookie → 鉴权通过。
 * 本路由不走 Slidev 反代,直接由 agent 提供。
 */
import { Hono } from 'hono'
import { type AuthVars } from '../middleware/auth.js'
import { getAsset } from '../db/deck-assets.js'

export const assetsRoute = new Hono<{ Variables: AuthVars }>()

assetsRoute.get('/assets/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const id = c.req.param('id')
  if (!id) return c.json({ error: 'missing id' }, 400)

  const asset = await getAsset(id)
  if (!asset) return c.json({ error: 'not found' }, 404)
  if (asset.userId !== user.id) {
    // 不返字节,不暴露存在性以外的信息
    return c.json({ error: 'forbidden' }, 403)
  }

  // Node Buffer 的 underlying ArrayBufferLike 在新 TS 下不兼容 BodyInit/BlobPart 期望的 ArrayBuffer。
  // 复制到全新 ArrayBuffer-backed Uint8Array,类型干净且零依赖 SharedArrayBuffer。
  const u8 = new Uint8Array(asset.data.byteLength)
  u8.set(asset.data)
  return new Response(u8, {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.bytesSize),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
