/**
 * Phase 12 Task K：Gemini 原生 provider smoke test(warn-not-fail）。
 *
 * 目的:打真 API,验 Phase 12 Gemini adapter(`/v1beta/models/<m>:generateContent`
 *      native 协议)+ 中转(duckcoding.ai)的端到端兼容性。
 *
 * - 没设 `GEMINI_TEST_KEY` 时整个 describe 被 `describe.skipIf` 跳过。
 * - 中转上游不稳(timeout / 502 / 503 等)时 `isUpstreamUnstable` 软跳。
 * - Gemini SDK 用 `httpOptions.baseUrl` 透传中转 origin(Task H adapter 已 wire 过)。
 *
 * 模型:`gemini-2.5-flash`(Task A probe 验证 + adapter `DEFAULT_MODEL`)。
 */

import { describe, it, expect } from 'vitest'
import { createGeminiProvider } from '../../adapters/gemini.js'
import type { CanonicalEvent, ToolDef } from '../../types.js'

const GEMINI_KEY = process.env.GEMINI_TEST_KEY
const BASE_URL = process.env.DUCKCODING_TEST_BASE_URL

const PROVIDER_ID = 'gemini'

describe.skipIf(!GEMINI_KEY)('gemini smoke', () => {
  it(
    'chat + streaming round trip',
    { retry: 1, timeout: 30_000 },
    async () => {
      const provider = createGeminiProvider({
        id: PROVIDER_ID,
        apiKey: GEMINI_KEY!,
        baseUrl: BASE_URL,
        model: 'gemini-2.5-flash',
      })
      const events: CanonicalEvent[] = []
      const controller = new AbortController()
      try {
        for await (const e of provider.streamChat(
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
        if (isUpstreamUnstable(e)) {
          console.warn(`⚠️ ${PROVIDER_ID} smoke (chat) skipped: upstream unstable —`, errMsg(e))
          return
        }
        throw e
      }

      if (!events.some((e) => e.type === 'text.delta')) {
        console.warn(
          `⚠️ ${PROVIDER_ID} chat: no text.delta. Events seen: ${events.map((e) => e.type).join(', ')}`,
        )
      }
      expect(events.some((e) => e.type === 'text.delta')).toBe(true)
      expect(events.at(-1)?.type).toBe('finish')
    },
  )

  it(
    'chat with tool call',
    { retry: 1, timeout: 30_000 },
    async () => {
      const provider = createGeminiProvider({
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

      expect(events.some((e) => e.type === 'finish')).toBe(true)
      if (!events.some((e) => e.type === 'tool_call.start')) {
        console.warn(
          `⚠️ ${PROVIDER_ID}: 期望 tool call 但 LLM 未调用 — 可能 model 决定直接回答而非调用`,
        )
      }
    },
  )
})

function isUpstreamUnstable(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message ?? ''
  return /timeout|ECONNREFUSED|502|503|504|fetch failed|AbortError|aborted/i.test(msg)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
