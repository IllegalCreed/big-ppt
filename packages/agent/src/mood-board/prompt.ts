/**
 * Phase 11.8 Task B-1: mood-board 主 LLM 调用相关的纯逻辑模块。
 *
 * 拆分 prompt.ts(无副作用纯函数)+ index.ts(带 IO 的 orchestration),
 * 让 prompt / parser / diversity 逻辑能独立单测,不需要 DB / network mock。
 *
 * 跟 rewriteSinglePageToComponents.ts 类似套路:可调函数 + DI seam。
 */

/**
 * 主 LLM 调用的 system prompt。
 * 强约束三件:(1) 输出 3 条 / (2) 视觉风格明显不同 / (3) 严格 JSON。
 * 不喂模板色板(让用户挑"调性",样张阶段不被锁死,见 plan 32 抉择 7)。
 *
 * 字符串 inline snapshot 锁在 mood-board-prompt.test.ts,防未来误改让样张漂。
 */
export const MOOD_BOARD_SYSTEM_PROMPT = `You are helping a user choose a visual style for an AI-generated presentation deck.

Look at the deck outline below. Generate 3 different image prompts that capture this deck's theme.

CRITICAL RULES:
1. Each prompt MUST use a CLEARLY DIFFERENT visual style. Pick whichever 3 directions you think best match the content.
2. Do NOT default all 3 to "flat infographic", "realistic photo", or any single style.
3. Style examples (NOT exhaustive — pick what fits the deck): isometric tech, hand-drawn doodle, watercolor wash, Bauhaus geometric, ukiyo-e woodblock, art deco, cyberpunk neon, minimalist line art, low-poly 3D, paper cutout, oil painting, blueprint schematic, retro 8-bit, brush calligraphy, gradient mesh abstract, etc.
4. Each prompt must be a complete English image-generation prompt (1-3 sentences), describing both subject and visual style.
5. Each "style" label is a SHORT (2-5 words) human-readable tag for the visual direction.

Output STRICT JSON (no markdown fence, no commentary, no preamble):

{
  "samples": [
    { "style": "<short label>", "prompt": "<full image prompt>" },
    { "style": "<short label>", "prompt": "<full image prompt>" },
    { "style": "<short label>", "prompt": "<full image prompt>" }
  ]
}`

/**
 * 主 LLM retry 时(第一轮 style 雷同时)用的差异化加强 prompt。
 * 把前一轮的 style label 喂回去,要求"明显不同"。
 */
export function buildRetrySystemPrompt(prevStyles: string[]): string {
  const list = prevStyles.map((s) => `"${s}"`).join(', ')
  return `${MOOD_BOARD_SYSTEM_PROMPT}

PREVIOUS ATTEMPT produced too-similar styles: ${list}.
This time the 3 styles MUST be genuinely distinct from each other AND from those listed above.
Pick directions that diverge meaningfully (e.g., switch medium / era / color palette / level of detail).`
}

/**
 * 从 deck 全文截取给主 LLM 的 outline(紧凑上下文,降本)。
 *
 * 策略:
 * - 截前 2KB 字节(UTF-8)
 * - 截断点尽量在段落边界(寻找最后一个 `\n---\n` 或 `\n\n`)
 * - frontmatter + heading 优先保留(它们一般在前 2KB 内)
 *
 * 不做完整 parse(parseSlides 会失败的极端 deck 也要能截) — 简单 string slice 即可。
 */
export const OUTLINE_MAX_BYTES = 2048

export function extractDeckOutlineForPrompt(content: string): string {
  if (!content) return ''
  const buf = Buffer.from(content, 'utf-8')
  if (buf.length <= OUTLINE_MAX_BYTES) return content
  // 简单 slice(可能截到 utf-8 字符中间),取出后找最后一个段落边界
  let truncated = buf.subarray(0, OUTLINE_MAX_BYTES).toString('utf-8')
  // 去掉末尾可能不完整的 utf-8 字符(toString 默认会保留 replacement char,这里更保守:
  // 截到最后一个 \n 边界)
  const lastBoundary = Math.max(
    truncated.lastIndexOf('\n---\n'),
    truncated.lastIndexOf('\n\n'),
    truncated.lastIndexOf('\n'),
  )
  if (lastBoundary > OUTLINE_MAX_BYTES / 2) {
    truncated = truncated.slice(0, lastBoundary)
  }
  return `${truncated}\n\n(...deck truncated for prompt brevity)`
}

export interface MoodBoardSample {
  style: string
  prompt: string
}

export interface MoodBoardLlmResponse {
  samples: MoodBoardSample[]
}

export class MoodBoardParseError extends Error {
  constructor(reason: string) {
    super(`mood-board LLM 响应解析失败:${reason}`)
    this.name = 'MoodBoardParseError'
  }
}

/**
 * 容错解析主 LLM 输出。
 * - 去 markdown fence(防 LLM 包 ```json ... ```)
 * - JSON.parse 失败 → MoodBoardParseError
 * - 校验 samples 长度 === 3 + 每项 style/prompt 非空字符串
 */
export function parseMoodBoardLlmResponse(raw: string): MoodBoardLlmResponse {
  const trimmed = raw.trim()
  // 去 ```json / ```\n``` 等 fence(防 LLM 不守 system prompt 偷偷包)
  const fenceMatch = trimmed.match(/^```(?:json)?\n([\s\S]*?)\n```$/)
  const jsonStr = fenceMatch ? fenceMatch[1]!.trim() : trimmed

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    throw new MoodBoardParseError(`不是合法 JSON: ${(err as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new MoodBoardParseError('顶层不是 object')
  }
  const samples = (parsed as { samples?: unknown }).samples
  if (!Array.isArray(samples)) {
    throw new MoodBoardParseError('缺少 samples 数组')
  }
  if (samples.length !== 3) {
    throw new MoodBoardParseError(`samples 长度必须是 3,实际 ${samples.length}`)
  }
  const out: MoodBoardSample[] = []
  for (let i = 0; i < 3; i++) {
    const item = samples[i]
    if (!item || typeof item !== 'object') {
      throw new MoodBoardParseError(`samples[${i}] 不是 object`)
    }
    const style = (item as { style?: unknown }).style
    const prompt = (item as { prompt?: unknown }).prompt
    if (typeof style !== 'string' || style.trim().length === 0) {
      throw new MoodBoardParseError(`samples[${i}].style 非空字符串`)
    }
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new MoodBoardParseError(`samples[${i}].prompt 非空字符串`)
    }
    out.push({ style: style.trim(), prompt: prompt.trim() })
  }
  return { samples: out }
}

/**
 * Token-based Jaccard 相似度。
 * 把 label 按空白 / 连字符 / 标点切词,小写后比较 token set。
 *
 * 实施期偏离(2026-05-19,plan 32 抉择 1):原方案用字符级 Levenshtein,实测对
 * "flat infographic" / "flat geometric" / "flat illustration" 这种"共享高频词
 * 但后缀全不同"系列只算 0.48 — Levenshtein 看字符变换数,后半截不同就距离大。
 * 但**用户视角下这 3 个 label 是雷同的**(都是"flat" 调)。换 token-based
 * Jaccard 直接看 token 重叠率,捕捉"共享前缀 / 后缀"语义雷同更准。
 * 例:"flat X / flat Y / flat Z" → 3 对都共享 {flat},Jaccard 各 1/3=0.33,
 * 平均 0.33;阈值改 0.3 触发 retry。
 */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .trim()
      .toLowerCase()
      .split(/[\s\-_/,.;:()[\]]+/u)
      .filter((t) => t.length > 0),
  )
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 && tb.size === 0) return 1
  let intersect = 0
  for (const t of ta) if (tb.has(t)) intersect++
  const unionSize = ta.size + tb.size - intersect
  return unionSize === 0 ? 0 : intersect / unionSize
}

/**
 * 评估 3 个 style label 的两两平均 Jaccard 相似度。
 * 返回 [0, 1] 之间数字: 0 = 完全不同 token, 1 = 完全相同 token set。
 * Plan 32 抉择 1: ≥ 0.3 视为雷同需 retry(原 0.8 用字符级相似度,换 Jaccard 后下调)。
 */
export function assessStyleDiversity(samples: Array<{ style: string }>): number {
  if (samples.length < 2) return 0 // 单条无所谓
  const labels = samples.map((s) => s.style)
  let totalSim = 0
  let pairs = 0
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      totalSim += jaccardSimilarity(labels[i]!, labels[j]!)
      pairs++
    }
  }
  return totalSim / pairs
}

/**
 * Plan 32 抉择 1 阈值。导出便于单测断言。
 * 实施期偏离:原 plan 0.8 用字符级 Levenshtein;换 Jaccard token 重叠率后语义不同,
 * 阈值降到 0.3 才能抓 "flat X / flat Y / flat Z" 共享 token 系列。
 */
export const STYLE_SIMILARITY_RETRY_THRESHOLD = 0.3
