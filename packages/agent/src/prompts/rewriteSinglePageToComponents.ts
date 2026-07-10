/**
 * Phase 11.6：image-gen 失败兜底——单页用 LLM 重写为 *-content + 组件版本。
 *
 * 设计动机:
 *   图片优先模式下,write_slides 写入的内容页只有 layout: *-image-content + heading + 空 body,
 *   没有任何 layout/组件兜底版本(策略上"两条独立流程"不交叉)。
 *   生图工具失败时(OpenAI 路 A/B 都崩),slides.md 该页仅剩 heading,需要本模块用 LLM
 *   按 fallbackSummary + 整 deck 上下文重写成 *-content + 合适组件,实现 graceful-degradation。
 *
 * 与 rewriteForTemplate 的差异:
 * - 输入: 单页 (heading + fallbackSummary + slideIndex) + 当前 deck 上下文
 * - 输出: 单页 markdown (frontmatter + body),由 worker parse 后 update_slide 替换该页
 * - system prompt 强制走 OFF 决策树 (imageGenEnabled: false),让 LLM 用 layout/组件路径
 */
import { buildSystemPrompt } from './buildSystemPrompt.js'
import {
  loadUserLlmSettings,
  resolveUpstream,
  stripMarkdownFence,
  validateSlidevMarkdown,
} from './rewriteForTemplate.js'
import { acquireLlmSlot } from '../middleware/llm-semaphore.js'
import { parseSlides, type SlidePage } from '../slides-store/pages.js'

export interface RewriteSinglePageInput {
  /** 当前 slides.md 全文,作为整 deck 上下文喂给 LLM */
  currentSlidesContent: string
  slideIndex: number
  /** 该页 heading（如有,LLM 应该尽量保留）*/
  heading?: string
  /** 中文兜底摘要,描述本页应承载的信息;不传时仅靠 heading,效果差 */
  fallbackSummary?: string
  templateId: string
  userId: number
}

export interface RewriteSinglePageOutput {
  /** 解析后的 frontmatter,可直接喂给 update_slide */
  frontmatter: Record<string, unknown>
  /** 解析后的 body 字符串 */
  body: string
  /** LLM 输出的原始单页 markdown,含调试用 */
  rawPageMarkdown: string
}

/** DI seam: 测试时可注入 mock,生产链路用默认 export */
export interface RewriteSinglePageFn {
  (input: RewriteSinglePageInput): Promise<RewriteSinglePageOutput>
}

/**
 * 把 LLM 单页输出拆成 frontmatter + body。
 * 借用 parseSlides:把单页字符串当作"只有一页的 deck",取 pages[0]。
 */
function parseSinglePage(pageMarkdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = pageMarkdown.trim()
  // parseSlides 期望的 deck 必须以 --- 起首声明 frontmatter。
  // LLM 极少数情况可能漏掉外层 ---,这里防御性补一个空的。
  const deckLike = trimmed.startsWith('---') ? trimmed : `---\n---\n\n${trimmed}`
  const parsed = parseSlides(deckLike)
  if (!parsed.pages || parsed.pages.length === 0) {
    throw new Error('rewriteSinglePage 解析失败:LLM 输出无任何页')
  }
  const first: SlidePage = parsed.pages[0]!
  return {
    frontmatter: first.frontmatter ?? {},
    body: first.body ?? '',
  }
}

const SKELETON_FALLBACK_PAGE = (heading: string | undefined, summary: string | undefined): string => {
  const hd = heading?.trim() || '生图失败'
  const summ = summary?.trim() || '此页生图失败,系统兜底提示:请检查生图模型配置或重试。'
  return `---\nlayout: beitou-content\nheading: ${hd}\n---\n\n${summ}`
}

/**
 * 默认实现:非流式调主 LLM(用户配的 chat key)重写单页为组件版。
 *
 * 错误处理:任何子步骤失败(API 错 / 空响应 / 校验失败)都向上抛,由 worker 标 fallback-failed。
 */
export const rewriteSinglePageToComponents: RewriteSinglePageFn = async (input) => {
  // E2E / CI:跳真 LLM,直接返回 skeleton 页(测试时用 BIG_PPT_TEST_REWRITE_MODE=skeleton)
  if (process.env.BIG_PPT_TEST_REWRITE_MODE === 'skeleton') {
    const raw = SKELETON_FALLBACK_PAGE(input.heading, input.fallbackSummary)
    const parsed = parseSinglePage(raw)
    return { ...parsed, rawPageMarkdown: raw }
  }

  const settings = await loadUserLlmSettings(input.userId)
  const { url, model } = await resolveUpstream(settings)
  // 强制 OFF 分支:让 LLM 走 layout/组件路径,不主动调 generate_slide_image
  const systemPrompt = buildSystemPrompt({
    templateId: input.templateId,
    imageGenEnabled: false,
  })

  const userPrompt = `图片优先模式下,第 ${input.slideIndex} 页生图失败。请用 layout/组件版本重写该页(graceful-degradation)。

**只输出该页的 markdown**(frontmatter + body),格式如下,**不要**输出整 deck,**不要**包 \`\`\`markdown 代码块,**不要**写解释:

\`\`\`
---
layout: <模板 prefix>-content   # 或其他合适的内容 layout
heading: ${input.heading?.trim() || '<根据下方摘要起标题>'}
---

<body 用合适的组件 + markdown>
\`\`\`

**该页应承载的信息(中文摘要,必须如实传达)**:
${input.fallbackSummary?.trim() || '(摘要缺失,请仅靠 heading 推断)'}

**整 deck 上下文(供你保持叙事一致性)**:

${input.currentSlidesContent}`

  const release = await acquireLlmSlot(input.userId)
  try {
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
      throw new Error(`rewriteSinglePage LLM 失败:HTTP ${resp.status} ${text.slice(0, 200)}`)
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') {
      throw new Error('rewriteSinglePage LLM 响应缺失 content')
    }
    const stripped = stripMarkdownFence(content)
    validateSlidevMarkdown(stripped)
    const parsed = parseSinglePage(stripped)
    return { ...parsed, rawPageMarkdown: stripped }
  } finally {
    release()
  }
}
