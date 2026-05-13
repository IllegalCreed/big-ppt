/**
 * Phase 12 Task K：Anthropic 原生 provider smoke test(warn-not-fail）。
 *
 * 目的:打真 API,验 Phase 12 Anthropic adapter(`/v1/messages` native 协议)
 *      + 中转(duckcoding.ai)的端到端兼容性。Phase 12 核心价值点
 *      —— prompt caching + extended thinking 都跑在这条 native 通道上,smoke
 *      验证「文本流 + tool call」可走通。
 *
 * - 没设 `ANTHROPIC_TEST_KEY` 时整个 describe 被 `describe.skipIf` 跳过。
 * - 中转上游不稳(timeout / 502 / 503 等)时 `isUpstreamUnstable` 软跳,
 *   warn 而非 fail。Task A probe 结果是「全支持 native」。
 *
 * 模型:`claude-sonnet-4-6`(Task A probe 验证的 Claude Code 专用 key 支持的主线模型;
 * 也是 adapter `DEFAULT_MODEL`)。
 */

import { describe, it, expect } from 'vitest'
import { createAnthropicProvider } from '../../adapters/anthropic.js'
import type { CanonicalEvent, ToolDef } from '../../types.js'

const ANTHROPIC_KEY = process.env.ANTHROPIC_TEST_KEY
const BASE_URL = process.env.DUCKCODING_TEST_BASE_URL

const PROVIDER_ID = 'anthropic'

describe.skipIf(!ANTHROPIC_KEY)('anthropic smoke', () => {
  it(
    'chat + streaming round trip',
    { retry: 1, timeout: 30_000 },
    async () => {
      const provider = createAnthropicProvider({
        id: PROVIDER_ID,
        apiKey: ANTHROPIC_KEY!,
        baseUrl: BASE_URL,
        model: 'claude-sonnet-4-6',
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
      const provider = createAnthropicProvider({
        id: PROVIDER_ID,
        apiKey: ANTHROPIC_KEY!,
        baseUrl: BASE_URL,
        model: 'claude-sonnet-4-6',
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
