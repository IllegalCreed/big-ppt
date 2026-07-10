import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'
import { getRequestContext } from '../../context.js'
import { getDb, decks } from '../../db/index.js'

/**
 * Phase 11.6 dogfood 修复:read_template 限制为只能读**当前 deck 所选模板**目录下的 .md 文件,
 * 不允许跨模板。LLM 传白名单文件名,工具内部用 deck.templateId 拼绝对路径。
 *
 * 早先版本(1)接受任意 path(含 jingyeda-standard/cover.md),会让 beitou 用户的 LLM 跨模板
 * 看到 jingyeda 的 layout 引用,引发跨模板污染。
 * 早先版本(2)接受任意 .md 文件名,但当前模板目录下实际只有 DESIGN.md / starter.md,
 * 别的名字(cover.md / content.md 等 Phase 6 之前遗留概念)不存在,LLM 调用浪费 turn。
 *
 * 现在 ALLOWED_NAMES 显式枚举,LLM 一目了然,且 description 也明示。
 */
const ALLOWED_NAMES = ['DESIGN.md', 'starter.md'] as const

export const readTemplateTool: ToolDef = {
  name: 'read_template',
  description:
    '读取**当前 deck 所选模板**目录下的 markdown 文件。仅 2 个白名单文件:`DESIGN.md`(完整视觉规范 / 配色字体 / 组件用法等) 或 `starter.md`(新建 deck 时的起点骨架,展示模板的惯用结构)。其他文件名会拒收;**仅当前模板**,不允许跨模板读取其他模板的文件。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        enum: [...ALLOWED_NAMES],
        description: '`DESIGN.md` 或 `starter.md`,二选一。其他文件名拒收。',
      },
    },
    required: ['name'],
  },
  exec: async (args) => {
    const ctx = getRequestContext()
    if (!ctx.userId) return JSON.stringify({ success: false, error: '未登录' })
    const deckId = ctx.activeDeckId
    if (!deckId) return JSON.stringify({ success: false, error: '无 active deck' })

    const db = getDb()
    const [deck] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
    if (!deck) return JSON.stringify({ success: false, error: 'deck 不存在' })
    if (deck.userId !== ctx.userId) {
      return JSON.stringify({ success: false, error: '无权访问该 deck' })
    }
    if (deck.status === 'deleted') {
      return JSON.stringify({ success: false, error: 'deck 已删除' })
    }

    const name = typeof args.name === 'string' ? args.name : ''
    if (!ALLOWED_NAMES.includes(name as (typeof ALLOWED_NAMES)[number])) {
      return JSON.stringify({
        success: false,
        error: `name 仅接受 ${ALLOWED_NAMES.join(' / ')} 二选一,收到 "${name}"`,
      })
    }

    const { templatesDir } = getPaths()
    const templateDir = path.join(templatesDir, deck.templateId)
    const templatePath = path.join(templateDir, name)
    const resolvedTemplate = path.resolve(templatePath)
    const resolvedTemplateDir = path.resolve(templateDir)
    if (!resolvedTemplate.startsWith(resolvedTemplateDir + path.sep)) {
      return JSON.stringify({ success: false, error: '非法路径' })
    }
    if (!fs.existsSync(resolvedTemplate)) {
      return JSON.stringify({
        success: false,
        error: `模板 ${deck.templateId}/${name} 不存在`,
      })
    }
    return JSON.stringify({
      success: true,
      templateId: deck.templateId,
      content: fs.readFileSync(resolvedTemplate, 'utf-8'),
    })
  },
}
