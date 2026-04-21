import { Hono } from 'hono'

const PROVIDERS: Record<string, { name: string; baseURL: string; defaultModel: string }> = {
  zhipu: {
    name: '智谱 (GLM)',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'GLM-5.1',
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  moonshot: {
    name: 'Moonshot (Kimi)',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  qwen: {
    name: '千问 (Qwen)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
}

function selectBaseURL(): string {
  const key = process.env.LLM_PROVIDER ?? 'zhipu'
  return PROVIDERS[key]?.baseURL ?? PROVIDERS.zhipu!.baseURL
}

export const llm = new Hono()

/**
 * LLM 流式代理：转发前端的 /api/llm/chat/completions 到上游 OpenAI-兼容 endpoint，
 * 透传 SSE 流（body 是 ReadableStream，上下游共用 Web Streams，不做中间解析）。
 */
llm.post('/chat/completions', async (c) => {
  const upstreamUrl = `${selectBaseURL()}/chat/completions`
  const auth = c.req.header('Authorization') ?? ''
  const body = await c.req.text()

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body,
    })
  } catch (err) {
    return c.json(
      { error: { message: `upstream fetch failed: ${(err as Error).message}` } },
      502,
    )
  }

  // Pass-through Response 保留流式语义（上游是 text/event-stream 时直接透传给前端）
  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  headers.set('Cache-Control', 'no-cache')
  headers.set('X-Accel-Buffering', 'no')
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  })
})
