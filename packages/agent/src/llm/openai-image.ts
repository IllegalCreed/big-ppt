/**
 * Phase 11.5：OpenAI 出图 client(独立于主 LLM 转发链 routes/llm.ts)。
 *
 * - 路 A:POST /v1/responses,model=gpt-5.5,tools=[{type:'image_generation'}]
 *   带 reasoning 自动改写 prompt + 多轮 edit + LLM 决定何时出图;OpenAI 推荐路径
 * - 路 B:POST /v1/images/generations,model=gpt-image-2(fallback)
 *   直接调底层模型,无 reasoning,简单稳定
 *
 * 故意不复用 routes/llm.ts 的 chat-completions 转发链:
 * - 那是 streaming + 占 per-user LLM semaphore,本场景不需要 streaming
 * - 必须强制 OpenAI(用户主聊天可能用 GLM),不走 provider routing
 *
 * Vitest 4 起 vi.mock 对 dynamic import 不稳定(plan 17 踩坑 2),
 * 单测应用 vi.spyOn(globalThis, 'fetch') 来 mock。
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_PRIMARY_MODEL = 'gpt-5.5'
const DEFAULT_FALLBACK_MODEL = 'gpt-image-2'

export type ImagePathTaken = 'A' | 'B'
// OpenAI gpt-image-2 接受任意 'WIDTHxHEIGHT'(满足 16 倍数 / ≤3:1 / [655360, 8294400] 像素)
// 不枚举固定值,工具层按模板硬编最优 size 透传
export type ImageSize = string

export interface ImageGenInput {
  prompt: string
  size: ImageSize
  signal: AbortSignal
  apiKey: string
  baseUrl?: string
  primaryModel?: string
  fallbackModel?: string
  /**
   * Hybrid vision-aware 模式(2026-05-18):当前 slide 已有图时透传 base64 给路 A,
   * 让 gpt-5.5 看原图后再调 image_generation 工具生成新版本,改 X 局部细节时
   * 风格 / 构图比纯 text-to-image 更贴近原图。
   *
   * **路 B(images/generations)不接受 image input** — 有 baseImage 时若路 A 失败,
   * 不降级路 B,直接抛错让 worker 走 fallback-rewrote 兜底重写。
   */
  baseImageBase64?: string
  baseImageMime?: string
}

export interface ImageGenOutput {
  /** base64-encoded PNG bytes(无 data URI 前缀) */
  b64: string
  modelUsed: string
  pathTaken: ImagePathTaken
}

/** 401/403:认证问题,不 fallback,直接 fail-fast */
export class ImageAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ImageAuthError'
  }
}

/** 路 A 失败标记,由 generateImage 内部捕获后走路 B */
export class ImagePathAFailed extends Error {
  constructor(readonly reason: string) {
    super(`path A failed: ${reason}`)
    this.name = 'ImagePathAFailed'
  }
}

export class ImageRateLimitError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super('OpenAI 速率限制,稍后重试')
    this.name = 'ImageRateLimitError'
  }
}

export class ImageCancelled extends Error {
  constructor() {
    super('已取消')
    this.name = 'ImageCancelled'
  }
}

/**
 * 主入口。先走路 A;5xx / "no image_generation_call in output" 等可恢复错误降级路 B。
 * 401/403 → ImageAuthError 不 fallback。signal aborted → ImageCancelled。
 */
export async function generateImage(input: ImageGenInput): Promise<ImageGenOutput> {
  const baseUrl = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const primaryModel = input.primaryModel ?? DEFAULT_PRIMARY_MODEL
  const fallbackModel = input.fallbackModel ?? DEFAULT_FALLBACK_MODEL
  const hasBaseImage = !!input.baseImageBase64 && !!input.baseImageMime

  // 强制走路 B 的特殊情况:用户在 settings 显式选 gpt-image-* 模型
  // hybrid 模式下 baseImage 无法走路 B(images/generations 不接受 image input),
  // 此时直接忽略 baseImage,按纯 text-to-image 走路 B(降级行为)。
  if (primaryModel.startsWith('gpt-image')) {
    const b64 = await callImagesApi({
      baseUrl,
      model: primaryModel,
      prompt: input.prompt,
      size: input.size,
      apiKey: input.apiKey,
      signal: input.signal,
    })
    return { b64, modelUsed: primaryModel, pathTaken: 'B' }
  }

  let pathAError: Error | null = null
  try {
    const b64 = await callResponsesApi({
      baseUrl,
      model: primaryModel,
      prompt: input.prompt,
      size: input.size,
      apiKey: input.apiKey,
      signal: input.signal,
      baseImageBase64: input.baseImageBase64,
      baseImageMime: input.baseImageMime,
    })
    return { b64, modelUsed: primaryModel, pathTaken: 'A' }
  } catch (err) {
    if (err instanceof ImageCancelled) throw err
    // 路 A 任何错误(包括 401/4xx)都 fallback 到路 B 试一次:
    // 中转代理常见场景 —— /v1/responses 没代理 / 模型 whitelist 没 gpt-5.5,
    // 返含糊 401 "Invalid token",但 /v1/images/generations + gpt-image-2
    // 一般都通。fallback 失败再用最后一个错误抛(优先抛路 B 错,带 ImageAuthError 标识)。
    pathAError = err as Error
  }

  // Hybrid vision-aware 关键决策:有 baseImage 时**不降级路 B**。
  // 路 B(/v1/images/generations + gpt-image-2)是纯 text-to-image,不接受 image input,
  // 降级会丢失"基于原图改"的语义,生成的新图跟用户期望偏差更大。
  // 直接抛路 A 错,worker catch 后走 fallback-rewrote 兜底(LLM 重写为组件版),
  // 这样用户至少能看到一个对得上 fallbackSummary 内容的页面,而不是被静默换成无关新图。
  if (hasBaseImage) {
    throw pathAError ?? new Error('path A failed (hasBaseImage, refuse path B downgrade)')
  }

  try {
    const b64 = await callImagesApi({
      baseUrl,
      model: fallbackModel,
      prompt: input.prompt,
      size: input.size,
      apiKey: input.apiKey,
      signal: input.signal,
    })
    return { b64, modelUsed: fallbackModel, pathTaken: 'B' }
  } catch (err) {
    if (err instanceof ImageCancelled) throw err
    // 双路都失败:优先暴露路 B 的错(更明确),保留路 A 错作为诊断信息
    const e = err as Error
    if (pathAError) {
      e.message = `${e.message} (path A also failed: ${pathAError.message})`
    }
    throw e
  }
}

interface CallArgs {
  baseUrl: string
  model: string
  prompt: string
  size: ImageSize
  apiKey: string
  signal: AbortSignal
  /** 仅路 A 用:hybrid 模式透传原图 base64 让 gpt-5.5 vision 理解上下文 */
  baseImageBase64?: string
  baseImageMime?: string
}

async function callResponsesApi(args: CallArgs): Promise<string> {
  // OpenAI Responses API content block format:
  // - text-only:input 可以是 string,也可是 [{role,content:string}]
  // - multimodal:input 必须是 [{role:'user', content:[{type:'input_text',...},{type:'input_image',...}]}]
  // hybrid 模式有 baseImage 时走 content-block array,让 gpt-5.5 vision 看到原图。
  const userContent =
    args.baseImageBase64 && args.baseImageMime
      ? [
          { type: 'input_text', text: args.prompt },
          {
            type: 'input_image',
            image_url: `data:${args.baseImageMime};base64,${args.baseImageBase64}`,
          },
        ]
      : args.prompt

  let res: Response
  try {
    res = await fetch(`${args.baseUrl}/responses`, {
      method: 'POST',
      signal: args.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        input: [{ role: 'user', content: userContent }],
        tools: [{ type: 'image_generation', size: args.size }],
        tool_choice: { type: 'image_generation' },
      }),
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ImageCancelled()
    throw new ImagePathAFailed(`network error: ${(err as Error).message}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new ImageAuthError(await readErrorMessage(res), res.status)
  }
  if (res.status === 429) {
    throw new ImageRateLimitError(parseRetryAfter(res.headers.get('retry-after')))
  }
  if (res.status >= 500) {
    throw new ImagePathAFailed(`server error ${res.status}`)
  }
  if (!res.ok) {
    throw new ImagePathAFailed(`status ${res.status}: ${await readErrorMessage(res)}`)
  }

  const json = (await res.json()) as { output?: Array<Record<string, unknown>> }
  if (!Array.isArray(json.output)) {
    throw new ImagePathAFailed('response.output 不是数组')
  }
  // 容错:用 endsWith 而非精确匹配,防 OpenAI 后续微调字段命名
  const item = json.output.find(
    (i) => typeof i.type === 'string' && i.type.endsWith('image_generation_call'),
  )
  if (!item) throw new ImagePathAFailed('output 内无 image_generation_call')
  const result = item.result
  if (typeof result !== 'string' || result.length === 0) {
    throw new ImagePathAFailed('image_generation_call.result 不是非空 base64')
  }
  return result
}

async function callImagesApi(args: CallArgs): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${args.baseUrl}/images/generations`, {
      method: 'POST',
      signal: args.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        prompt: args.prompt,
        size: args.size,
        n: 1,
        response_format: 'b64_json',
      }),
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ImageCancelled()
    throw new Error(`Images API 网络错误:${(err as Error).message}`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new ImageAuthError(await readErrorMessage(res), res.status)
  }
  if (res.status === 429) {
    throw new ImageRateLimitError(parseRetryAfter(res.headers.get('retry-after')))
  }
  if (!res.ok) {
    throw new Error(`Images API status ${res.status}: ${await readErrorMessage(res)}`)
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> }
  const b64 = json.data?.[0]?.b64_json
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new Error('Images API 返回无 b64_json')
  }
  return b64
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    return j.error?.message ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000)
  return undefined
}
