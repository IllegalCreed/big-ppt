/** Phase 13 Task B: 用户级素材上传 API(multipart + magic-bytes + quota check)。 */
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { createHash, randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { getDb, userAssets } from '../db/index.js'
import type { AuthVars } from '../middleware/auth.js'
import { canUpload, getQuotaLimits, getUsedBytes } from '../uploads/quota.js'
import { deleteAssetBytes, getAssetBytes, putAssetBytes } from '../uploads/storage.js'
import { enqueueExtraction } from '../uploads/extractor.js'

export const uploads = new Hono<{ Variables: AuthVars }>()

/**
 * Mime 白名单 9 类:PDF / DOCX / XLSX / CSV / PNG / JPEG / GIF / MD / TXT。
 * 跟 spec 对齐;text/markdown 与 text/plain 由 file-type magic-bytes 检不出,
 * 需要 filename 后缀 fallback 兜底。
 */
const MIME_WHITELIST = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/markdown',
  'text/plain',
])

/** 返友好中文 quota 错误文本(supports file-too-large / quota-exceeded 两 case)。 */
function quotaErrorMessage(
  reason: 'file-too-large' | 'quota-exceeded',
  usedBytes: number,
  limitBytes: number,
): string {
  if (reason === 'file-too-large') return '单文件超过 10MB 上限'
  const usedMb = (usedBytes / 1024 / 1024).toFixed(1)
  const limitMb = (limitBytes / 1024 / 1024).toFixed(0)
  return `已用 ${usedMb}MB / ${limitMb}MB,请先在「我的素材」清理`
}

/** filename 后缀兜底:file-type 检不出文本类(md/txt/csv) → 看扩展名定 mime。 */
function inferMimeFromFilename(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'text/markdown'
  if (ext === 'txt') return 'text/plain'
  if (ext === 'csv') return 'text/csv'
  return null
}

uploads.post('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)

  // Hono parseBody 对 multipart/form-data 自动把 file 字段返成 File 实例(globalThis.File)
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) {
    return c.json({ error: { code: 'no-file', message: '请上传文件' } }, 400)
  }

  const filename = file.name || 'unnamed'
  const reportedMime = file.type || 'application/octet-stream'
  const bytes = Buffer.from(await file.arrayBuffer())

  // quota check 在写 disk 前做,避免临时占空间
  const check = await canUpload(user.id, bytes.length)
  if (!check.ok) {
    return c.json(
      {
        error: {
          code: check.reason,
          message: quotaErrorMessage(check.reason, check.usedBytes, check.limitBytes),
        },
      },
      413,
    )
  }

  // magic-bytes 检测优先 — 防 .exe 改后缀伪装
  const detected = await fileTypeFromBuffer(bytes)
  let finalMime = detected?.mime ?? reportedMime
  if (!MIME_WHITELIST.has(finalMime)) {
    const fromName = inferMimeFromFilename(filename)
    // 关键:仅在 magic-bytes "未检出" 时才走 filename fallback;
    // 若 magic-bytes 已识别但落在白名单外(如 .exe → application/x-msdownload),
    // 不允许 filename 后缀翻案(防 evil.exe 改名 evil.md 绕过)。
    if (!detected && fromName) finalMime = fromName
  }
  if (!MIME_WHITELIST.has(finalMime)) {
    return c.json(
      { error: { code: 'unsupported-mime', message: `不支持的文件类型: ${reportedMime}` } },
      415,
    )
  }

  const assetId = randomUUID()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const storagePath = await putAssetBytes(user.id, assetId, bytes)
  const isImage = finalMime.startsWith('image/')
  const extractStatus = isImage ? 'skipped' : 'pending'

  await getDb().insert(userAssets).values({
    id: assetId,
    userId: user.id,
    filename,
    mime: finalMime,
    sizeBytes: bytes.length,
    sha256,
    storagePath,
    extractStatus,
  })

  // Phase 13 Task G(close-out):非 image 落 'pending' 后丢进 extractor 队列。
  // 图片类(extractStatus 已 'skipped')无需抽取,跳过。worker 失败/timeout 内部
  // 自己写 status='failed' + extractErrorMsg,这里 fire-and-forget(同进程 queue,
  // 不抛错也不阻塞 response)。
  if (!isImage) {
    enqueueExtraction({ assetId, userId: user.id, mime: finalMime })
  }

  const uploadedAt = new Date()
  return c.json({
    asset: {
      id: assetId,
      filename,
      mime: finalMime,
      sizeBytes: bytes.length,
      extractStatus,
      uploadedAt: uploadedAt.toISOString(),
    },
    quota: {
      usedBytes: check.usedBytes + bytes.length,
      limitBytes: check.limitBytes,
    },
  })
})

uploads.get('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)

  const db = getDb()
  const rows = await db
    .select()
    .from(userAssets)
    .where(eq(userAssets.userId, user.id))
    .orderBy(desc(userAssets.uploadedAt))

  const usedBytes = await getUsedBytes(user.id)
  const { perUser } = getQuotaLimits()
  return c.json({
    assets: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
      extractStatus: r.extractStatus,
      uploadedAt: r.uploadedAt.toISOString(),
    })),
    quota: { usedBytes, limitBytes: perUser },
  })
})

uploads.get('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)

  const id = c.req.param('id')
  // 跨用户访问统一返 404(不暴露存在性),跟 assets.ts 的 403 语义有区别:
  // 此处 spec 要求"no leakage of exists-for-other-user info" → 404 不区分。
  const [row] = await getDb()
    .select()
    .from(userAssets)
    .where(and(eq(userAssets.id, id), eq(userAssets.userId, user.id)))
    .limit(1)
  if (!row) return c.json({ error: { message: 'not found' } }, 404)

  const bytes = await getAssetBytes(user.id, id)
  // Buffer.subarray 返回的 view 兼容 BodyInit
  const u8 = new Uint8Array(bytes.byteLength)
  u8.set(bytes)
  return new Response(u8, {
    status: 200,
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.filename)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

uploads.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)

  const id = c.req.param('id')
  const db = getDb()
  const [row] = await db
    .select()
    .from(userAssets)
    .where(and(eq(userAssets.id, id), eq(userAssets.userId, user.id)))
    .limit(1)
  if (!row) return c.json({ error: { message: 'not found' } }, 404)

  // storage.deleteAssetBytes 内部对 ENOENT 静默放行,fs 文件缺失下 DB row 仍删干净(幂等)
  await deleteAssetBytes(user.id, id)
  await db.delete(userAssets).where(eq(userAssets.id, id))

  const usedBytes = await getUsedBytes(user.id)
  return c.json({ quota: { usedBytes, limitBytes: getQuotaLimits().perUser } })
})
