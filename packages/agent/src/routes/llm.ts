import { Hono } from 'hono'
import type { AuthVars } from '../middleware/auth.js'
import { decryptApiKey } from '../crypto/apikey.js'

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

type StoredLlmSettings = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
}

function resolveUpstream(settings: StoredLlmSettings): { url: string } {
  if (settings.baseUrl) {
    return { url: `${settings.baseUrl.replace(/\/$/, '')}/chat/completions` }
  }
  const provider = settings.provider ?? 'zhipu'
  const base = PROVIDERS[provider]?.baseURL ?? PROVIDERS.zhipu!.baseURL
  return { url: `${base}/chat/completions` }
}

export const llm = new Hono<{ Variables: AuthVars }>()

/**
 * LLM 流式代理（Phase 5 起必须登录 + 服务端加密 API Key）：
 * 前端只发 POST body，agent 用当前用户的 llm_settings 解密后加 Authorization 转发上游。
 */
llm.post('/chat/completions', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)
  if (!user.llmSettings) {
    return c.json({ error: { message: '请先在设置中配置 LLM API Key' } }, 400)
  }

  let settings: StoredLlmSettings
  try {
    settings = JSON.parse(decryptApiKey(user.llmSettings)) as StoredLlmSettings
  } catch (err) {
    return c.json(
      { error: { message: `LLM 配置解密失败：${(err as Error).message}` } },
      500,
    )
  }
  if (!settings.apiKey) {
    return c.json({ error: { message: 'LLM 配置无 apiKey，请在设置中重新填入' } }, 400)
  }

  const { url: upstreamUrl } = resolveUpstream(settings)
  const body = await c.req.text()

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body,
    })
  } catch (err) {
    return c.json({ error: { message: `upstream fetch failed: ${(err as Error).message}` } }, 502)
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
