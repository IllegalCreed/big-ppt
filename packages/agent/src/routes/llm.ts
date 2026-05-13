/**
 * Phase 12 Task E:LLM 路由从「HTTP body 透传」改成「canonical request → ProviderRegistry
 * → SSE 转发 canonical event」。
 *
 * 旧路径(Phase 5–9-E):前端发 OpenAI-shape body → agent 解密 user.llm_settings →
 * 直 fetch 上游 → ReadableStream 透传上游 SSE 字节。三家 provider(openai 兼容 +
 * Anthropic + Gemini)wire format 不一样,纯透传无法接 Anthropic / Gemini。
 *
 * 新路径(Task E 起):前端发 canonical request → agent 走 ProviderRegistry.resolve
 * → adapter.streamChat 返 canonical event 流 → eventsToSSEStream 编码成统一 SSE
 * wire format。Task G/H 在 registry 注册 Anthropic / Gemini 后,前端代码零修改自动
 * 支持新 provider(canonical request 跨 provider 通用)。
 *
 * 风险:本 Task 完成后线上「frontend OpenAI delta body → backend 解析为 canonical
 * 报错」。Task I 改 frontend 之前**不能上 main 跑产线**。dogfood 在 Task I 后开始。
 *
 * 设计:
 * - registry 实例 module-level + `__setRegistryForTesting(r)` 注入点(参考
 *   crypto/apikey.ts 的 __setMasterKeyGetterForTesting 模式),让测试期能塞 fake
 *   provider 验 streamChat 调用 + signal 透传 + SSE 输出。
 * - parseLlmSettings 在 Task F 之前是 stub,会让现有用户(老 shape)直接抛错。
 *   预期行为,Task F migration 跑过 dev DB 后恢复。
 * - acquireLlmSlot 行为保留(智谱 GLM-5.1 并发硬限 2),signal 透传保留
 *   (`c.req.raw.signal`),cancel 反向传播由 eventsToSSEStream(Task D)+ async
 *   generator try/finally 联合保证。
 */
import { Hono } from 'hono'
import type { AuthVars } from '../middleware/auth.js'
import { decryptApiKey } from '../crypto/apikey.js'
import { acquireLlmSlot, LlmConcurrencyTimeoutError } from '../middleware/llm-semaphore.js'
import { ProviderRegistry } from '../llm/provider.js'
import { createOpenAICompatibleProvider } from '../llm/adapters/openai-compatible.js'
import { eventsToSSEStream } from '../llm/canonical-sse.js'
import { LLMError } from '../llm/errors.js'
import { parseLlmSettings } from '../llm/settings.js'
import { logServerEvent } from '../logger/server-log.js'
import type { CanonicalChatRequest } from '../llm/types.js'

/**
 * 默认 registry:Task E 先接 5 个 OpenAI 兼容 provider。
 * Anthropic / Gemini 工厂在 Task G/H 完成 adapter 后,通过本文件 `__setRegistryForTesting`
 * **不**注入(那是测试用),而是直接修改本常量加 entries。或者把 registry
 * 提到独立 module(`packages/agent/src/llm/default-registry.ts`)。Task G/H 决定。
 */
function buildDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry(
    new Map([
      ['openai', createOpenAICompatibleProvider],
      ['zhipu', createOpenAICompatibleProvider],
      ['deepseek', createOpenAICompatibleProvider],
      ['moonshot', createOpenAICompatibleProvider],
      ['qwen', createOpenAICompatibleProvider],
      // anthropic / gemini 在 Task G/H 注册
    ]),
  )
}

let _registry: ProviderRegistry = buildDefaultRegistry()

/**
 * @internal 仅测试用:注入 fake registry 验 streamChat 调用 + SSE 输出。
 * 传 null 恢复默认 registry。
 */
export function __setRegistryForTesting(r: ProviderRegistry | null): void {
  _registry = r ?? buildDefaultRegistry()
}

export const llm = new Hono<{ Variables: AuthVars }>()

/**
 * Phase 9-E:**LLM 代理刻意不挂 rate limit**。
 * Why:API Key 是用户自己提供的(users.llm_settings 加密存),用户用自己的 key
 * 烧自己的钱;upstream provider 自己会按用户 key 做 quota 限制,agent 不应在用户
 * 和自己 key 之间再加一层限流。
 *
 * 真正需要限流的是"用 agent 服务器资源"的攻击面(登录爆破 / 写日志),见
 * routes/auth.ts + routes/log.ts。LLM 用户配额超了由 provider 直接拒。
 */
llm.post('/chat/completions', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)
  if (!user.llmSettings) {
    return c.json({ error: { message: '请先在设置中配置 LLM API Key' } }, 400)
  }

  let settings
  try {
    settings = parseLlmSettings(JSON.parse(decryptApiKey(user.llmSettings)))
  } catch (e) {
    return c.json(
      { error: { message: `LLM 配置解密 / 解析失败:${(e as Error).message}` } },
      500,
    )
  }

  let provider
  try {
    provider = _registry.resolve(settings)
  } catch (e) {
    return c.json({ error: { message: (e as Error).message } }, 400)
  }

  // canonical request body(Task B 定义的 CanonicalChatRequest shape)。
  // Task I 之前 frontend 还在发 OpenAI delta body,这里 parse 出来会传给 adapter
  // 但 adapter 的 translate 层校验 messages[] block shape 时会 throw —— 这是预期的
  // (Task I 改 frontend 后才恢复)。
  const req = (await c.req.json()) as CanonicalChatRequest

  // 拿 LLM slot:超过 per-user 并发上限会 await 排队;超过队列超时才 reject。
  // 解决智谱 GLM-5.1 上游"并发 2"硬限,避免多 tab / chat+切模板撞 429。
  let release: () => void
  try {
    release = await acquireLlmSlot(user.id)
  } catch (e) {
    if (e instanceof LlmConcurrencyTimeoutError) {
      return c.json({ error: { message: e.message } }, 503)
    }
    throw e
  }

  // 透传 client AbortSignal 给 adapter.streamChat:
  // 客户端断开(刷新 / 取消 / 切 deck / 关 tab)时,c.req.raw.signal 触发 abort →
  // adapter SDK 立刻断流 → 上游 provider 端释放 in-flight 名额。
  //
  // cancel 反向传播链:Hono response cancel → eventsToSSEStream cancel hook →
  // iterator.return() → async generator finally → release() + provider abort。
  // 这条链保证所有出口(正常 / throw / abort)都释放 slot,不依赖 caller。
  const clientSignal = c.req.raw.signal
  const events = (async function* () {
    try {
      yield* provider.streamChat(req, clientSignal)
    } catch (e) {
      logServerEvent({
        category: 'llm',
        event: 'request-failed',
        userId: user.id,
        provider: provider.id,
        code: e instanceof LLMError ? e.code : 'unknown',
        errorMsg: (e as Error).message,
      })
      throw e
    } finally {
      release()
    }
  })()

  const stream = eventsToSSEStream(events)
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})
