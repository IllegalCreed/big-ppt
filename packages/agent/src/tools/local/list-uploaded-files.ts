/** Phase 13 Task D: agent tool — list current user's uploaded files. */
import { desc, eq } from 'drizzle-orm'
import type { ToolDef } from '../registry.js'
import { getRequestContext } from '../../context.js'
import { getDb, userAssets } from '../../db/index.js'

const SUMMARY_MAX = 200

export const listUploadedFilesTool: ToolDef = {
  name: 'list_uploaded_files',
  description:
    'List the current user uploaded reference files (PDF/DOCX/XLSX/Image/MD/TXT). Returns id, filename, mime, sizeBytes, extractStatus, and a 200-char summary of extractedText. Use this to discover what reference material the user has uploaded before reading specific files with `read_uploaded_file`.',
  parameters: {
    type: 'object',
    properties: {},
  },
  exec: async () => {
    const ctx = getRequestContext()
    if (!ctx.userId) {
      return JSON.stringify({ success: false, error: '未登录' })
    }
    const db = getDb()
    const rows = await db
      .select()
      .from(userAssets)
      .where(eq(userAssets.userId, ctx.userId))
      .orderBy(desc(userAssets.uploadedAt))
    const files = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
      extractStatus: r.extractStatus,
      summary: r.extractedText ? r.extractedText.slice(0, SUMMARY_MAX) : null,
    }))
    return JSON.stringify({ success: true, files })
  },
}
