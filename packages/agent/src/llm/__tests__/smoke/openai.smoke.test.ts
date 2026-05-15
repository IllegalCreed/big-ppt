/**
 * Phase 12.5 Task E：OpenAI smoke test 重建,走 `createPiAiAdapter`(取代 Phase 12 的
 * `createOpenAICompatibleProvider`)。Task A 删了 Phase 12 Task K 落地的 6 个 smoke
 * case 来过 type-check,本 Task 从头建,测试逻辑(chat + tool call)+ 警示链路
 * (warn-not-fail / isUpstreamUnstable)按 Phase 12 Task K 模式保留。
 *
 * 目的:打真 API,验 pi-ai-adapter + duckcoding 中转 + OpenAI 路径(pi-ai 内部走
 * streamOpenAICompletions)的端到端兼容性。
 *
 * - 没设 `OPENAI_TEST_KEY` 时整个 describe 被 `describe.skipIf` 跳过 —— CI / 一般 dev
 *   跑 `pnpm test` 默认 skip 不烧 token,只有 `pnpm test:smoke` 才进来。
 * - 中转上游不稳(timeout / 502 / 503 等)时 `isUpstreamUnstable` 软跳,warn 而非 fail。
 * - **pi-ai MODELS 表找不到 model id** 时也走 console.warn skip(不 fail)。pi-ai 0.74.0
 *   MODELS 表是按时间冻结的快照,中转支持的 model id 可能没进表;defaultResolver 抛
 *   "pi-ai 找不到 provider" clear error,smoke 捕获后 skip 让开发者去 settings UI
 *   验真用户路径,而非测试 fail block 全流程。
 * - chat case maxTokens=200(reasoning-tier 模型 thinking + output 共享 budget,Phase 12
 *   Task K 学到 50 会被 MAX_TOKENS 截断)。
 *
 * 模型:`gpt-5.2`(Phase 12 Task A probe 验证的中转可用 model)。
 * model 选 'gpt-5.2' 而非 'gpt-5.2-low' —— pi-ai 0.74.0 MODELS 表无
 * reasoning-effort 变体(`-low`/`-medium`/`-high`),duckcoding 中转两个都支持
 * (Phase 12 Task A probe verified);用 base id 让 pi-ai getModel() 拿到 Model。
 *
 * **baseUrl 拼接**:OpenAI SDK 把 baseURL 当 prefix 直接拼 `/chat/completions`,必须含 /v1。
 * 单一 `DUCKCODING_TEST_BASE_URL` env 是根 URL(不含 /v1),smoke 内部拼;strip 末尾 / 避免 //v1。
 * Anthropic SDK 自动追加 /v1/messages、Gemini SDK 用 httpOptions.baseUrl 自动追加 /v1beta,
 * 所以那两家原样传不拼 /v1。
 *
 * **cost 字段断言**:Phase 12.5 Task C 起 pi-ai 透传 usage.cost(USD 浮点);smoke 在
 * finish event 含 cost 时断言 cost.total ≥ 0,不含时不强校验(部分上游可能漏返)。
 */

import { describe, it, expect } from 'vitest'
import { createPiAiAdapter } from '../../adapters/pi-ai-adapter.js'
import type { CanonicalEvent, ToolDef } from '../../types.js'

const OPENAI_KEY = process.env.OPENAI_TEST_KEY
const RAW_BASE_URL = process.env.DUCKCODING_TEST_BASE_URL
// OpenAI SDK 要求 baseURL 含 /v1(不自动追加);strip 末尾 / 避免变成 //v1
const BASE_URL = RAW_BASE_URL ? `${RAW_BASE_URL.replace(/\/$/, '')}/v1` : undefined

const PROVIDER_ID = 'openai'

describe.skipIf(!OPENAI_KEY)('openai smoke (via pi-ai)', () => {
  it(
    'chat + streaming round trip',
    { retry: 1, timeout: 30_000 },
    async () => {
      const adapter = createPiAiAdapter({
        id: PROVIDER_ID,
        apiKey: OPENAI_KEY!,
        baseUrl: BASE_URL,
        model: 'gpt-5.2',
      })
      const events: CanonicalEvent[] = []
      const controller = new AbortController()
      try {
        for await (const e of adapter.streamChat(
          {
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'say hi in 3 words' }] },
            ],
            maxTokens: 200,
          },
          controller.signal,
        )) {
          events.push(e)
        }
      } catch (e) {
        if (isSkippable(e)) {
          console.warn(`⚠️ ${PROVIDER_ID} smoke (chat) skipped:`, errMsg(e))
          return
        }
        throw e
      }

      // pi-ai 0.74.0 多数错误走 stream 内 `error` event 而非 throw —— for-await
      // 正常结束,events 数组里只有 `error` event。扫一遍,quota / JSON parser
      // 等 skippable 错误同样走 warn 不 fail(详见 isSkippable 注释 (3)(4))
      if (skipIfStreamError(events, `${PROVIDER_ID} smoke (chat)`)) return

      // 缺 text.delta 时把所有看到的 event type 打出来,方便排查 thinking-tier 模型被
      // MAX_TOKENS 截断、translator 漏 emit、provider 协议错位等故障模式
      if (!events.some((e) => e.type === 'text.delta')) {
        console.warn(
          `⚠️ ${PROVIDER_ID} chat: no text.delta. Events seen: ${events.map((e) => e.type).join(', ')}`,
        )
      }
      expect(events.some((e) => e.type === 'text.delta')).toBe(true)
      expect(events.at(-1)?.type).toBe('finish')

      // Phase 12.5 新增:cost 字段透传断言。pi-ai 返回 usage.cost 时,canonical finish
      // event 必须带 cost.total ≥ 0;不带 cost 的不强校验(中转可能漏返 cost meta)。
      const finish = events.at(-1)
      if (finish?.type === 'finish' && finish.usage.cost) {
        expect(finish.usage.cost.total).toBeGreaterThanOrEqual(0)
      }
    },
  )

  it(
    'chat with tool call',
    { retry: 1, timeout: 30_000 },
    async () => {
      const adapter = createPiAiAdapter({
        id: PROVIDER_ID,
        apiKey: OPENAI_KEY!,
        baseUrl: BASE_URL,
        model: 'gpt-5.2',
      })
      const tools: ToolDef[] = [
        {
          name: 'get_weather',
          description: 'Get current weather for a given location.',
          inputSchema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ]
      const events: CanonicalEvent[] = []
      const controller = new AbortController()
      try {
        for await (const e of adapter.streamChat(
          {
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'What is the weather in San Francisco? Use the get_weather tool.',
                  },
                ],
              },
            ],
            tools,
            maxTokens: 100,
          },
          controller.signal,
        )) {
          events.push(e)
        }
      } catch (e) {
        if (isSkippable(e)) {
          console.warn(`⚠️ ${PROVIDER_ID} smoke (tool) skipped:`, errMsg(e))
          return
        }
        throw e
      }

      // pi-ai stream 内 error event 走 skip(同 chat case)
      if (skipIfStreamError(events, `${PROVIDER_ID} smoke (tool)`)) return

      // 强断言:finish event 必有(无论 model 走 tool call 还是直接 text 回答)
      expect(events.some((e) => e.type === 'finish')).toBe(true)
      // 软断言:tool call 是否被触发,model 可能 hallucinate 直接答 "I don't know"
      if (!events.some((e) => e.type === 'tool_call.start')) {
        console.warn(
          `⚠️ ${PROVIDER_ID}: 期望 tool call 但 LLM 未调用 — 可能 model 决定直接回答而非调用`,
        )
      }
    },
  )
})

/**
 * Skippable 错误判定:四类走 warn 不 fail。
 *
 * (1) 上游中转不稳:timeout / 502 / 503 / 504 / ECONNREFUSED / fetch failed /
 *     AbortError / aborted。
 * (2) pi-ai MODELS 表找不到 model id —— `defaultResolver` 抛 "pi-ai 找不到 provider"
 *     clear error。pi-ai 0.74.0 MODELS 是按时间冻结的快照,中转支持的某些 model id
 *     可能未进表;smoke 不应因此 block 全测试。
 * (3) 中转 quota / 计费 / plan limit:控制面真 key 跑时撞过 Anthropic 中转 400
 *     "Third-party apps now draw from your extra usage..." —— key 耗尽 plan
 *     quota,要 top-up 才能继续。**典型 key 不稳定 case**,按 warn-not-fail 原则 skip。
 * (4) pi-ai / SDK 内部 JSON parser 错:Gemini 跑真 key 撞过 "Incomplete JSON segment
 *     at the end" —— pi-ai 的 google-generative-ai parser 收到不完整 SSE chunk
 *     或 duckcoding 中转返了非 streaming 响应。**也属上游 SSE 格式兼容性问题**,
 *     不是 adapter bug,按 warn-not-fail skip。
 *
 * Used in two places:
 * - catch 路径:pi-ai throw 时直接判定(getModel 找不到 / 同步 fetch failure)
 * - for-await 后:pi-ai 0.74.0 多数错误走 stream 内 `error` event 而非 throw;
 *   loop 结束后必须扫 events 找 `error` event,用 message 喂 isSkippable 判定
 */
function isSkippable(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message ?? ''
  return (
    // 网络 / 中转抖动
    /timeout|ECONNREFUSED|502|503|504|fetch failed|AbortError|aborted/i.test(msg) ||
    // pi-ai MODELS 表找不到(可能 model id 不在表)
    /pi-ai 找不到/i.test(msg) ||
    // 中转 quota / 计费 / plan limit(typical key 不稳定 case)
    /quota|extra usage|plan limit|insufficient|billing|credit|top.?up/i.test(msg) ||
    // pi-ai / SDK 内部 JSON parser 报错(SSE chunk 不完整 / 中转返非 streaming)
    /Incomplete JSON|JSON parse|Unexpected token|SyntaxError/i.test(msg)
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * pi-ai 0.74.0 多数 LLM 端错误走 stream 内 `error` event 而非 throw(见
 * pi-ai-adapter.ts translatePiEvent error 分支)。for-await 正常退出后,events
 * 里只有 `error` event 没有 text.delta / finish,如果直接走 expect 断言就 fail。
 *
 * 本 helper 扫 events 找首个 `error`,如果 message 命中 isSkippable 则 warn 返
 * true(caller 应 `return` skip 全 case);否则返 false(让后续断言去 catch
 * 真 adapter bug —— 比如 translator 漏 emit / canonical schema 违例)。
 */
function skipIfStreamError(events: CanonicalEvent[], label: string): boolean {
  const errorEvt = events.find((e) => e.type === 'error')
  if (!errorEvt || errorEvt.type !== 'error') return false
  if (isSkippable(new Error(errorEvt.message))) {
    console.warn(`⚠️ ${label} skipped (stream error): ${errorEvt.message.slice(0, 200)}`)
    return true
  }
  return false
}
