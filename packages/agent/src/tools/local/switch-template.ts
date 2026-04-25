/**
 * switch_template 工具：AI 对话中可触发模板切换。
 *
 * 执行后立即返回 jobId；AI 或前端随后轮询 `GET /api/switch-template-jobs/:jobId`
 * 查看进度。失败由 job.state=failed + job.error 承载，tool 层不抛错。
 */
import type { ToolDef } from '../registry.js'
import { getRequestContext } from '../../context.js'
import { getDb, decks } from '../../db/index.js'
import { eq } from 'drizzle-orm'
import {
  createJob,
  runSwitchJob,
  validateSwitchTarget,
} from '../../template-switch-job.js'
import { rewriteForTemplate } from '../../prompts/rewriteForTemplate.js'
import { getHolder } from '../../slidev-lock.js'

export const switchTemplateTool: ToolDef = {
  name: 'switch_template',
  description:
    '把当前 deck 从现有模板切换到目标模板：自动快照当前版本 → 调 LLM 按新模板重写 → 入新 version + 更新 template_id。必须带 confirmed=true。失败时保留快照可回滚。',
  parameters: {
    type: 'object',
    properties: {
      deckId: { type: 'number', description: '要切模板的 deck id（默认取 active deck）' },
      targetTemplateId: { type: 'string', description: '目标模板 id，如 beitou-standard' },
      confirmed: { type: 'boolean', description: '必须显式传 true' },
    },
    required: ['targetTemplateId', 'confirmed'],
  },
  exec: async (args) => {
    const ctx = getRequestContext()
    if (!ctx.userId) {
      return JSON.stringify({ success: false, error: '未登录' })
    }
    if (args.confirmed !== true) {
      return JSON.stringify({
        success: false,
        error: '必须 confirmed=true 才能切换模板',
      })
    }
    const deckId =
      typeof args.deckId === 'number'
        ? args.deckId
        : typeof args.deckId === 'string' && /^\d+$/.test(args.deckId)
          ? Number(args.deckId)
          : ctx.activeDeckId
    if (!deckId) {
      return JSON.stringify({ success: false, error: '未指定 deckId 且无 active deck' })
    }
    const targetTemplateId =
      typeof args.targetTemplateId === 'string' ? args.targetTemplateId.trim() : ''

    const db = getDb()
    const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
    if (!deck) return JSON.stringify({ success: false, error: 'deck 不存在' })
    if (deck.userId !== ctx.userId) {
      return JSON.stringify({ success: false, error: '无权访问该 deck' })
    }

    const validation = validateSwitchTarget(deck.templateId, targetTemplateId)
    if (!validation.ok) {
      return JSON.stringify({ success: false, error: validation.error })
    }

    const holder = getHolder()
    if (holder && holder.deckId === deckId && holder.userId !== ctx.userId) {
      return JSON.stringify({
        success: false,
        error: 'deck 正被占用',
        holder: { userId: holder.userId, email: holder.userEmail },
      })
    }

    const job = createJob({
      deckId,
      userId: ctx.userId,
      from: deck.templateId,
      to: targetTemplateId,
    })
    void runSwitchJob(job.id, rewriteForTemplate)

    return JSON.stringify({
      success: true,
      jobId: job.id,
      state: job.state,
      hint: '通过 GET /api/switch-template-jobs/<jobId> 轮询状态',
    })
  },
}
