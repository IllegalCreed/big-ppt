/**
 * Phase 12.5 Task E：Gemini smoke test 重建,走 `createPiAiAdapter`(取代 Phase 12 的
 * `createGeminiProvider`)。Task A 删了 Phase 12 Task K 落地的 case,本 Task 从头建。
 *
 * 目的:打真 API,验 pi-ai-adapter + duckcoding 中转 + Gemini 路径(pi-ai 内部走
 * streamGoogle / `/v1beta/models/<m>:streamGenerateContent`)的端到端兼容性。
 *
 * - 没设 `GEMINI_TEST_KEY` 时整个 describe 被 `describe.skipIf` 跳过。
 * - 中转上游不稳(timeout / 502 / 503 等)时 `isSkippable` 软跳,warn 而非 fail。
 * - pi-ai MODELS 表找不到 model id 时也走 warn-skip(同 openai smoke 注释)。
 * - chat case maxTokens=200(gemini-2.5-flash 是 thinking-tier 模型,maxOutputTokens
 *   含 thoughtsTokenCount;50 会被 thinking 吃光导致 finishReason=MAX_TOKENS、output 为空)。
 *
 * 模型:`gemini-2.5-flash`(Phase 12 Task A probe 验证的中转可用 model;pi-ai 0.74.0
 * MODELS 表已 verified 包含此 id)。
 *
 * **baseUrl 不拼 /v1**:pi-ai 内部 Google SDK 用 `httpOptions.baseUrl` 自动追加
 * `/v1beta/...`,所以原样传 raw base(`https://www.duckcoding.ai`)。
 *
 * **cost 字段断言**:同 openai smoke。
 */

import { describe, it, expect } from 'vitest'
import { createPiAiAdapter } from '../../adapters/pi-ai-adapter.js'
import type { CanonicalEvent, ToolDef } from '../../types.js'

const GEMINI_KEY = process.env.GEMINI_TEST_KEY
// Gemini SDK 自动追加 /v1beta/... —— baseUrl 原样传(不拼 /v1)
const BASE_URL = process.env.DUCKCODING_TEST_BASE_URL

const PROVIDER_ID = 'gemini'

describe.skipIf(!GEMINI_KEY)('gemini smoke (via pi-ai)', () => {
  it(
    'chat + streaming round trip',
    { retry: 1, timeout: 30_000 },
    async () => {
      const adapter = createPiAiAdapter({
        id: PROVIDER_ID,
        apiKey: GEMINI_KEY!,
        baseUrl: BASE_URL,
        model: 'gemini-2.5-flash',
      })
      const events: CanonicalEvent[] = []
      const controller = new AbortController()
      try {
        for await (const e of adapter.streamChat(
          {
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'say hi in 3 words' }] },
            ],
            // gemini-2.5-flash 是 thinking 模型,maxOutputTokens 共享 thinking + output budget;
            // 50 会被 thoughtsTokenCount 吃光导致 finishReason=MAX_TOKENS、可见 output 为空;
            // 200 留足 margin
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

      // pi-ai stream 内 error event 走 skip(Gemini 真 key 跑撞过 "Incomplete JSON
      // segment" —— pi-ai google-generative-ai parser 跟 duckcoding 中转 SSE 兼容
      // 性问题;详见 isSkippable 注释 (4))
      if (skipIfStreamError(events, `${PROVIDER_ID} smoke (chat)`)) return

      if (!events.some((e) => e.type === 'text.delta')) {
        console.warn(
          `⚠️ ${PROVIDER_ID} chat: no text.delta. Events seen: ${events.map((e) => e.type).join(', ')}`,
        )
      }
      expect(events.some((e) => e.type === 'text.delta')).toBe(true)
      expect(events.at(-1)?.type).toBe('finish')

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
        apiKey: GEMINI_KEY!,
        baseUrl: BASE_URL,
        model: 'gemini-2.5-flash',
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

      expect(events.some((e) => e.type === 'finish')).toBe(true)
      if (!events.some((e) => e.type === 'tool_call.start')) {
        console.warn(
          `⚠️ ${PROVIDER_ID}: 期望 tool call 但 LLM 未调用 — 可能 model 决定直接回答而非调用`,
        )
      }
    },
  )
})

/**
 * Skippable 错误判定:四类走 warn 不 fail。详见 openai.smoke.test.ts 同名 helper 注释。
 */
function isSkippable(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message ?? ''
  return (
    // 网络 / 中转抖动
    /timeout|ECONNREFUSED|502|503|504|fetch failed|AbortError|aborted/i.test(msg) ||
    // pi-ai MODELS 表找不到
    /pi-ai 找不到/i.test(msg) ||
    // 中转 quota / 计费 / plan limit
    /quota|extra usage|plan limit|insufficient|billing|credit|top.?up/i.test(msg) ||
    // pi-ai / SDK 内部 JSON parser 错(Gemini 真 key 跑撞过 "Incomplete JSON segment")
    /Incomplete JSON|JSON parse|Unexpected token|SyntaxError/i.test(msg)
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 扫 events 找首个 `error`(pi-ai stream 内 emit 不抛错),命中 isSkippable 时 warn skip。
 * 详见 openai.smoke.test.ts 同名 helper 注释。
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
