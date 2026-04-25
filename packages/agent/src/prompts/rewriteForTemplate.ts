/**
 * Phase 6D：模板切换时把旧 slides.md 按新模板重写。
 *
 * 生产实现：非流式调 LLM，system prompt 为新模板的 buildSystemPrompt（manifest 驱动），
 * user prompt 交付旧 md + 切换诉求，让 LLM 产出符合新模板 layouts 的完整 md。
 * 失败（API 错 / 空响应 / 非 markdown 文本）由调用方 (runSwitchJob) 标 failed。
 *
 * 为了单测能覆盖，runSwitchJob 把 RewriteFn 作为 DI 参数，
 * 生产链路在路由里把 `rewriteForTemplate` 包装成 RewriteFn 传入。
 */
import { eq } from 'drizzle-orm'
import { getDb, users } from '../db/index.js'
import { decryptApiKey } from '../crypto/apikey.js'
import { buildSystemPrompt } from './buildSystemPrompt.js'
import { readStarter } from '../templates/registry.js'

interface LlmSettings {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
}

const PROVIDER_BASE: Record<string, { baseURL: string; defaultModel: string }> = {
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'GLM-5.1' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  openai: { baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
  qwen: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
}

function resolveUpstream(settings: LlmSettings): { url: string; model: string } {
  const provider = settings.provider ?? 'zhipu'
  const base = settings.baseUrl
    ? settings.baseUrl.replace(/\/$/, '')
    : (PROVIDER_BASE[provider]?.baseURL ?? PROVIDER_BASE.zhipu!.baseURL)
  const model =
    settings.model ??
    PROVIDER_BASE[provider]?.defaultModel ??
    PROVIDER_BASE.zhipu!.defaultModel
  return { url: `${base}/chat/completions`, model }
}

/** 读取用户 llm_settings 并解密 */
async function loadUserLlmSettings(userId: number): Promise<LlmSettings> {
  const db = getDb()
  const [u] = await db
    .select({ llmSettings: users.llmSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u || !u.llmSettings) {
    throw new Error('用户未配置 LLM API Key')
  }
  const raw = decryptApiKey(u.llmSettings)
  const settings = JSON.parse(raw) as LlmSettings
  if (!settings.apiKey) throw new Error('LLM 配置缺失 apiKey')
  return settings
}

/** 从 LLM 回复中提取 slides.md 正文（去掉 ```markdown 代码块包裹） */
function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  if (fenceMatch) return fenceMatch[1]!.trim()
  return trimmed
}

/**
 * Phase 7D：LLM 重写返回值合法性校验。
 *
 * 现实中（尤其国产 LLM）会偶尔把 message content 写成 tool-call 格式字面文本，例如：
 *   <tool_call)>\n<tool_name>read_slides</tool_name>\n</tool_call()>
 * 我们没校验直接写进 deck_versions + mirror 到 slides.md，整个 deck 就废了。
 *
 * 合法 slidev markdown 必有第一段 frontmatter（以 --- 开头 + 至少声明 layout）。
 * 不合规则 throw，让 runSwitchJob 标 failed → 不写 DB / 不 mirror → 用户看错误提示。
 */
export function validateSlidevMarkdown(content: string): void {
  const trimmed = content.trim()
  // 1. 必须以 --- 开头（首段 frontmatter 起始符）
  if (!trimmed.startsWith('---')) {
    throw new Error('LLM 返回非 slidev markdown：未以 frontmatter `---` 开头')
  }
  // 2. 不能含 tool-call 字面标签 —— 这是 LLM 错把 tool_call 格式写到 content 的特征
  if (/<tool_call[^>]*>|<tool_name>|```tool_call/i.test(trimmed)) {
    throw new Error('LLM 返回包含 tool-call 字面标签，疑似格式漂移')
  }
  // 3. 必须至少能匹配到一处 layout 字段（slidev 渲染必需）
  if (!/^layout\s*:/m.test(trimmed)) {
    throw new Error('LLM 返回缺 layout 字段，无法作为合法 slidev markdown')
  }
}

/** 非流式调 LLM 重写 slides.md；错误向上抛 */
export async function rewriteForTemplate(args: {
  oldContent: string
  fromTemplateId: string
  toTemplateId: string
  userId: number
}): Promise<string> {
  // Phase 7D：E2E 测试模式 - 跳 LLM 直接返回目标模板的 starter.md，
  // 让 switch-template 状态机端到端跑通而不依赖外部 LLM。仅在 BIG_PPT_TEST_REWRITE_MODE=skeleton 时生效。
  if (process.env.BIG_PPT_TEST_REWRITE_MODE === 'skeleton') {
    return readStarter(args.toTemplateId)
  }

  const settings = await loadUserLlmSettings(args.userId)
  const { url, model } = resolveUpstream(settings)
  const systemPrompt = buildSystemPrompt({ templateId: args.toTemplateId })

  const userPrompt = `当前 slides.md 内容来自模板 \`${args.fromTemplateId}\`。请把它重写成符合模板 \`${args.toTemplateId}\` layout 规范的完整 slides.md，保留原有语义（标题 / 要点 / 数据），只调整结构和 frontmatter 字段以适配新模板。

要求：
- 只输出最终 slides.md 全文，不要解释、不要包 \`\`\`markdown 代码块
- **不要用 <tool_call> / <tool_name> / 任何工具调用格式回复**——本次没有工具可调，直接输出 markdown
- 输出必须以 \`---\` 起首声明第一段 frontmatter（含 layout 字段）
- 严格遵循新模板的 layout 清单与 frontmatter schema
- 页数可以微调（不要少于原 1/2 也不要超过原 2 倍）

原 slides.md：

${args.oldContent}`

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LLM 重写失败：HTTP ${resp.status} ${text.slice(0, 200)}`)
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('LLM 响应缺失 content')
  }
  const stripped = stripMarkdownFence(content)
  validateSlidevMarkdown(stripped)
  return stripped
}
