/**
 * Phase 12 Task K：OpenAI 兼容 provider smoke test(warn-not-fail）。
 *
 * 目的:打真 API,验 Phase 12 OpenAI adapter 与中转(duckcoding.ai)的端到端兼容性。
 *
 * - 没设 `OPENAI_TEST_KEY` 时整个 describe 被 `describe.skipIf` 跳过 —— CI / 一般 dev
 *   跑 `pnpm test` 默认 skip 不烧 token,只有 `pnpm test:smoke` 才进来。
 * - 中转上游不稳(timeout / 502 / 503 等)时 `isUpstreamUnstable` 软跳,warn 而非 fail。
 *   Task A probe 结果是「全支持」,日常应该全 ✅;偶发抖动也不阻塞 nightly。
 * - 每个 case 限制 maxTokens ≤ 50 + retry: 1 + timeout: 30s,单次 nightly 单家成本约
 *   ~¥0.01 级。
 *
 * 模型:`gpt-5.2-low`(Task A probe 验证的 CodeX 专用 key 可用模型最低档,省 token)。
 */

import { describe, it, expect } from 'vitest'
import { createOpenAICompatibleProvider } from '../../adapters/openai-compatible.js'
import type { CanonicalEvent, ToolDef } from '../../types.js'

const OPENAI_KEY = process.env.OPENAI_TEST_KEY
const BASE_URL = process.env.DUCKCODING_TEST_BASE_URL

const PROVIDER_ID = 'openai'

describe.skipIf(!OPENAI_KEY)('openai smoke', () => {
  it(
    'chat + streaming round trip',
    { retry: 1, timeout: 30_000 },
    async () => {
      const provider = createOpenAICompatibleProvider({
        id: PROVIDER_ID,
        apiKey: OPENAI_KEY!,
        baseUrl: BASE_URL,
        model: 'gpt-5.2-low',
      })
      const events: CanonicalEvent[] = []
      const controller = new AbortController()
      try {
        for await (const e of provider.streamChat(
          {
            messages: [
              { role: 'user', content: [{ type: 'text', text: 'say hi in 3 words' }] },
            ],
            maxTokens: 50,
          },
          controller.signal,
        )) {
          events.push(e)
        }
      } catch (e) {
        if (isUpstreamUnstable(e)) {
          console.warn(`⚠️ ${PROVIDER_ID} smoke (chat) skipped: upstream unstable —`, errMsg(e))
          return
        }
        throw e
      }

      expect(events.some((e) => e.type === 'text.delta')).toBe(true)
      expect(events.at(-1)?.type).toBe('finish')
    },
  )

  it(
    'chat with tool call',
    { retry: 1, timeout: 30_000 },
    async () => {
      const provider = createOpenAICompatibleProvider({
        id: PROVIDER_ID,
        apiKey: OPENAI_KEY!,
        baseUrl: BASE_URL,
        model: 'gpt-5.2-low',
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
        for await (const e of provider.streamChat(
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
        if (isUpstreamUnstable(e)) {
          console.warn(`⚠️ ${PROVIDER_ID} smoke (tool) skipped: upstream unstable —`, errMsg(e))
          return
        }
        throw e
      }

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
 * 上游中转不稳判定:timeout / 502 / 503 / 504 / ECONNREFUSED / fetch failed /
 * AbortError / aborted 全部走 warn 不 fail。client signal abort 也走这里(测试期
 * controller.abort 之后 stream 抛 AbortError 不该 fail)。
 */
function isUpstreamUnstable(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message ?? ''
  return /timeout|ECONNREFUSED|502|503|504|fetch failed|AbortError|aborted/i.test(msg)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
