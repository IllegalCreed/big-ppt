/** Phase 13 Task D: agent tool — read user uploaded file content (text / image). */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ToolDef } from '../registry.js'
import { getRequestContext } from '../../context.js'
import { getDb, userAssets, users } from '../../db/index.js'
import { getAssetBytes } from '../../uploads/storage.js'
import { getSupportedMultiModalHint, isMultiModalLLM } from '../../uploads/multi-modal.js'
import { getActiveProviderConfig } from '../../llm/settings.js'

const InputSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(['text', 'image']).optional(),
})

export const readUploadedFileTool: ToolDef = {
  name: 'read_uploaded_file',
  description:
    'Read a user uploaded file by id. `mode="text"` returns extracted plain text (PDF/DOCX/XLSX/MD/TXT). `mode="image"` returns a base64 image block for multi-modal LLMs (PNG/JPG/GIF only). Default `mode="text"`. Image mode requires the active main LLM to be multi-modal (Claude / Gemini / GPT-4o+ / GLM-5v-turbo / Grok-2-vision); otherwise returns a friendly error asking the user to switch.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'asset id (uuid) from `list_uploaded_files`',
      },
      mode: {
        type: 'string',
        enum: ['text', 'image'],
        description: '`text` returns extractedText (default); `image` returns base64 for multi-modal LLM.',
      },
    },
    required: ['id'],
  },
  exec: async (args) => {
    const ctx = getRequestContext()
    if (!ctx.userId) {
      return JSON.stringify({ success: false, error: '未登录' })
    }
    const parsed = InputSchema.safeParse(args)
    if (!parsed.success) {
      return JSON.stringify({ success: false, error: 'invalid args' })
    }
    const { id, mode = 'text' } = parsed.data

    const db = getDb()
    const rows = await db
      .select()
      .from(userAssets)
      .where(and(eq(userAssets.id, id), eq(userAssets.userId, ctx.userId)))
      .limit(1)
    const asset = rows[0]
    if (!asset) {
      return JSON.stringify({ success: false, error: 'asset not found' })
    }

    if (mode === 'image') {
      if (!asset.mime.startsWith('image/')) {
        return JSON.stringify({
          success: false,
          error: '该 asset 不是 image 类型,用 mode=text',
        })
      }
      // 检查主 LLM 是否支持多模态(图像输入)
      const [u] = await db
        .select({ llmSettings: users.llmSettings })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1)
      const cfg = u?.llmSettings ? getActiveProviderConfig(u.llmSettings) : null
      if (!cfg || !isMultiModalLLM(cfg.provider, cfg.model)) {
        const cur = cfg ? `${cfg.provider}/${cfg.model ?? '未配置'}` : '未配置'
        return JSON.stringify({
          success: false,
          error: `当前主 LLM (${cur}) 不支持图片。请切换到 ${getSupportedMultiModalHint()} 后重试。`,
        })
      }
      let bytes: Buffer
      try {
        bytes = await getAssetBytes(ctx.userId, id)
      } catch (e) {
        return JSON.stringify({
          success: false,
          error: `读取 asset 字节失败: ${(e as Error).message}`,
        })
      }
      return JSON.stringify({
        success: true,
        image: { mediaType: asset.mime, dataBase64: bytes.toString('base64') },
      })
    }

    // text mode
    if (asset.mime.startsWith('image/')) {
      return JSON.stringify({ success: false, error: '该 asset 是 image 类型,用 mode=image' })
    }
    if (asset.extractStatus === 'pending' || asset.extractStatus === 'running') {
      return JSON.stringify({ success: false, error: '正在处理,稍后再试' })
    }
    if (asset.extractStatus === 'failed') {
      return JSON.stringify({
        success: false,
        error: `抽取失败: ${asset.extractErrorMsg ?? '未知错误'}`,
      })
    }
    if (asset.extractStatus === 'skipped') {
      return JSON.stringify({ success: false, error: '该类型不支持 text 抽取' })
    }
    // done
    return JSON.stringify({ success: true, content: asset.extractedText ?? '' })
  },
}
