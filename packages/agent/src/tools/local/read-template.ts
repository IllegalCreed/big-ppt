import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import type { ToolDef } from '../registry.js'
import { getPaths } from '../../workspace.js'
import { getRequestContext } from '../../context.js'
import { getDb, decks } from '../../db/index.js'

/**
 * Phase 11.6 dogfood 修复:read_template 限制为只能读**当前 deck 所选模板**目录下的 .md 文件,
 * 不允许跨模板。LLM 传相对文件名(如 cover.md / content.md / starter.md),工具内部用
 * deck.templateId 拼绝对路径。
 *
 * 早先版本接受任意 path(含 jingyeda-standard/cover.md),会让 beitou 用户的 LLM 跨模板看
 * 到 jingyeda 的 layout 引用,引发跨模板污染(beitou deck 出 jingyeda layout 等)。
 */
export const readTemplateTool: ToolDef = {
  name: 'read_template',
  description:
    '读取**当前 deck 所选模板**目录下的 .md 文件内容(如 cover.md / content.md / starter.md),用于了解模板的结构和语法。**仅当前模板**,不允许跨模板读取其他模板的文件。',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          '模板内 .md 文件名(纯文件名,不含模板目录前缀),如 cover.md / content.md / starter.md',
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

    const name = typeof args.name === 'string' ? args.name : ''
    if (!name) return JSON.stringify({ success: false, error: 'name 不能为空' })
    // 只允许纯文件名(不含 / 不含 ..),严格限制在当前模板目录
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      return JSON.stringify({
        success: false,
        error: 'name 必须是当前模板目录下的纯文件名,不允许 / \\ 或 .. 跨目录',
      })
    }
    const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')
    if (!safeName.endsWith('.md')) {
      return JSON.stringify({ success: false, error: '只支持 .md 模板文件' })
    }

    const { templatesDir } = getPaths()
    const templateDir = path.join(templatesDir, deck.templateId)
    const templatePath = path.join(templateDir, safeName)
    const resolvedTemplate = path.resolve(templatePath)
    const resolvedTemplateDir = path.resolve(templateDir)
    if (!resolvedTemplate.startsWith(resolvedTemplateDir + path.sep)) {
      return JSON.stringify({ success: false, error: '非法路径' })
    }
    if (!fs.existsSync(resolvedTemplate)) {
      return JSON.stringify({
        success: false,
        error: `模板 ${deck.templateId}/${safeName} 不存在`,
      })
    }
    return JSON.stringify({
      success: true,
      templateId: deck.templateId,
      content: fs.readFileSync(resolvedTemplate, 'utf-8'),
    })
  },
}
