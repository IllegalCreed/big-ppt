import { Hono } from 'hono'
import type { AuthVars } from '../middleware/auth.js'
import { decryptApiKey } from '../crypto/apikey.js'
import { acquireLlmSlot, LlmConcurrencyTimeoutError } from '../middleware/llm-semaphore.js'

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
  /** 接口协议;目前仅 'openai-compatible',resolveUpstream 暂不分支,留作未来协议适配钩子。 */
  apiType?: 'openai-compatible'
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
 * Phase 9-E：**LLM 代理刻意不挂 rate limit**。
 * Why：API Key 是用户自己提供的（users.llm_settings 加密存），用户用自己的 key
 * 烧自己的钱；upstream provider（智谱 / DeepSeek / OpenAI 等）自己会按用户 key 做
 * quota 限制，agent 不应在用户和自己 key 之间再加一层限流。
 *
 * 真正需要限流的是"用 agent 服务器资源"的攻击面（登录爆破 / 写日志），见
 * routes/auth.ts + routes/log.ts。LLM 用户配额超了由 provider 直接拒。
 */

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

  // 拿 LLM slot:超过 per-user 并发上限会 await 排队;超过队列超时才 reject
  // 解决智谱 GLM-5.1 上游"并发 2"硬限,避免多 tab / chat+切模板撞 429
  let release: () => void
  try {
    release = await acquireLlmSlot(user.id)
  } catch (err) {
    if (err instanceof LlmConcurrencyTimeoutError) {
      return c.json({ error: { message: err.message } }, 503)
    }
    throw err
  }

  // 透传 client AbortSignal 给 upstream fetch:
  // 客户端断开(刷新 / 取消 / 切 deck / 关 tab)时,c.req.raw.signal 触发 abort →
  // 上游 fetch 立刻断连 → 智谱端释放 in-flight 名额。
  // 否则 server 这边的 fetch 仍在等智谱,智谱真实并发占用不会减,
  // 用户立刻重发会叠加上去撞 429,本地 semaphore 计数与上游真实并发失同步。
  const clientSignal = c.req.raw.signal
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body,
      signal: clientSignal,
    })
  } catch (err) {
    release()
    const e = err as Error
    if (e.name === 'AbortError') {
      // client 主动断开,不算业务错误
      return new Response(null, { status: 499 })
    }
    return c.json({ error: { message: `upstream fetch failed: ${e.message}` } }, 502)
  }

  if (!upstream.body) {
    release()
    return new Response(null, { status: upstream.status })
  }

  // Wrap upstream body:在流结束 / cancel / error 三个出口都释放 slot,
  // 避免 fetch resolve 后即释放而上游 streaming 仍占着真实 in-flight 名额。
  const reader = upstream.body.getReader()
  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          release()
        } else {
          controller.enqueue(value)
        }
      } catch (err) {
        release()
        controller.error(err)
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => undefined)
      release()
    },
  })

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  headers.set('Cache-Control', 'no-cache')
  headers.set('X-Accel-Buffering', 'no')
  return new Response(wrapped, {
    status: upstream.status,
    headers,
  })
})
