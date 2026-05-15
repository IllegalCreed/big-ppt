/**
 * Phase 12.7 Task B：agent-message 双向翻译单测（9 测）。
 *
 * 覆盖：
 * 1. pi UserMessage → canonical：string content 也能翻成单 text block
 * 2. pi UserMessage（多模态 array）→ canonical：image 字段名换名
 *    （data/mimeType ↔ dataBase64/mediaType）
 * 3. pi AssistantMessage → canonical：text / thinking / toolCall 三 block 全覆盖
 * 4. pi ToolResultMessage → canonical：toolName drop / isError 透传 / content 翻译
 * 5. canonical → pi user / assistant / tool 三 role 全覆盖（含 image / thinking
 *    字段换名 + tool_use → toolCall 类型名换 + tool_result 顶层化）
 * 6. canonical system role → throw（不入 message 链）
 * 7. canonical tool 消息缺 tool_result block → throw（防御性）
 * 8. canonical tool 消息 tool_result content 为 Block[]（含 image）→ pi 翻译保留 image+text
 * 9. round-trip：canonical → pi → canonical 内容 + role 不变（忽略 timestamp）
 */
import { describe, expect, it } from 'vitest'
import {
  agentMessageToCanonical,
  canonicalToAgentMessage,
} from '../agent-message.js'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type { CanonicalMessage } from '../../types.js'

describe('agentMessageToCanonical', () => {
  it('pi UserMessage string content → canonical 单 text block', () => {
    const m: UserMessage = { role: 'user', content: 'hello', timestamp: 1 }
    expect(agentMessageToCanonical(m)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('pi UserMessage array content → canonical（image 字段名 mimeType → mediaType / data → dataBase64）', () => {
    const m: UserMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'see this:' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
      timestamp: 1,
    }
    expect(agentMessageToCanonical(m)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'see this:' },
        { type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' },
      ],
    })
  })

  it('pi AssistantMessage → canonical：text + thinking + toolCall 三 block 全覆盖', () => {
    const m: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will use a tool.' },
        { type: 'thinking', thinking: 'reasoning step' },
        { type: 'toolCall', id: 'call-1', name: 'read_slides', arguments: { idx: 0 } },
      ],
      api: 'openai-completions',
      provider: 'openai',
      model: 'gpt-5',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 1,
    }
    expect(agentMessageToCanonical(m)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will use a tool.' },
        { type: 'thinking', text: 'reasoning step' },
        { type: 'tool_use', id: 'call-1', name: 'read_slides', input: { idx: 0 } },
      ],
    })
  })

  it('pi ToolResultMessage → canonical role=tool 单 tool_result block：toolName drop、isError 透传', () => {
    const m: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read_slides',
      content: [{ type: 'text', text: '{"slides":[]}' }],
      isError: false,
      timestamp: 1,
    }
    expect(agentMessageToCanonical(m)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          content: [{ type: 'text', text: '{"slides":[]}' }],
          isError: false,
        },
      ],
    })

    // isError=true 同样保留
    const err: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call-2',
      toolName: 'write_slides',
      content: [{ type: 'text', text: 'permission denied' }],
      isError: true,
      timestamp: 2,
    }
    const can = agentMessageToCanonical(err) as CanonicalMessage
    const block = can.content[0] as Extract<
      CanonicalMessage['content'][number],
      { type: 'tool_result' }
    >
    expect(block.isError).toBe(true)
  })
})

describe('canonicalToAgentMessage', () => {
  it('canonical user / assistant / tool 三 role 全覆盖（字段名换 + 类型名换）', () => {
    // user with image
    const user: CanonicalMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', mediaType: 'image/jpeg', dataBase64: 'BBBB' },
      ],
    }
    const piUser = canonicalToAgentMessage(user) as UserMessage
    expect(piUser.role).toBe('user')
    const userContent = piUser.content as Array<{ type: string }>
    expect(userContent).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' },
    ])

    // assistant with text + thinking + tool_use
    const asst: CanonicalMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'using tool' },
        { type: 'thinking', text: 'think...' },
        { type: 'tool_use', id: 'c1', name: 'do_thing', input: { x: 1 } },
      ],
    }
    const piAsst = canonicalToAgentMessage(asst) as AssistantMessage
    expect(piAsst.role).toBe('assistant')
    expect(piAsst.content).toEqual([
      { type: 'text', text: 'using tool' },
      { type: 'thinking', thinking: 'think...' },
      { type: 'toolCall', id: 'c1', name: 'do_thing', arguments: { x: 1 } },
    ])

    // tool result（tool_result block in canonical → ToolResultMessage in pi）
    const toolMsg: CanonicalMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'c1',
          content: 'result string',
          isError: false,
        },
      ],
    }
    const piTool = canonicalToAgentMessage(toolMsg) as ToolResultMessage
    expect(piTool.role).toBe('toolResult')
    expect(piTool.toolCallId).toBe('c1')
    expect(piTool.isError).toBe(false)
    expect(piTool.content).toEqual([{ type: 'text', text: 'result string' }])
    // toolName 空串占位（canonical 不承载）
    expect(piTool.toolName).toBe('')
  })

  it('canonical system role → throw（不入 message 链，应走 initialState.systemPrompt）', () => {
    const sys: CanonicalMessage = {
      role: 'system',
      content: [{ type: 'text', text: 'be helpful' }],
    }
    expect(() => canonicalToAgentMessage(sys)).toThrow(/system role 不入 AgentMessage/)
  })

  it('canonical tool 消息缺 tool_result block → throw（防御性）', () => {
    const bad: CanonicalMessage = {
      role: 'tool',
      content: [{ type: 'text', text: 'not a result' }],
    }
    expect(() => canonicalToAgentMessage(bad)).toThrow(/必须至少含 1 个 tool_result block/)
  })

  it('canonical tool 消息 content 为 Block[]（含 image）→ pi 翻译保留 image+text', () => {
    const toolMsg: CanonicalMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'c2',
          content: [
            { type: 'text', text: 'generated image:' },
            { type: 'image', mediaType: 'image/png', dataBase64: 'CCCC' },
          ],
          isError: false,
        },
      ],
    }
    const piTool = canonicalToAgentMessage(toolMsg) as ToolResultMessage
    expect(piTool.content).toEqual([
      { type: 'text', text: 'generated image:' },
      { type: 'image', data: 'CCCC', mimeType: 'image/png' },
    ])
  })
})

describe('canonical ↔ pi round-trip', () => {
  it('canonical → pi → canonical：user/assistant/tool 内容 + role 全保留', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', mediaType: 'image/png', dataBase64: 'BIN' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'thinking...' },
          { type: 'text', text: 'sure, calling tool' },
          { type: 'tool_use', id: 'call-99', name: 'noop', input: { a: 1 } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'call-99',
            content: 'ok',
            isError: false,
          },
        ],
      },
    ]

    for (const c of messages) {
      const pi = canonicalToAgentMessage(c)
      const back = agentMessageToCanonical(pi)
      expect(back.role).toBe(c.role)
      // tool_result 的 string content 在往返中会变成 Block[]
      // （pi ToolResultMessage.content 永远是 array），所以单独比 role=tool 时
      // content 形态：canonical 出去时 string，pi 内是 [TextContent]，
      // 回到 canonical 时 content 字段也是 [{type:'text', ...}]。
      if (c.role === 'tool') {
        const trIn = c.content[0] as Extract<
          CanonicalMessage['content'][number],
          { type: 'tool_result' }
        >
        const trOut = back.content[0] as Extract<
          CanonicalMessage['content'][number],
          { type: 'tool_result' }
        >
        expect(trOut.toolUseId).toBe(trIn.toolUseId)
        expect(trOut.isError).toBe(trIn.isError)
        // string → [{type:'text',text:string}]
        expect(trOut.content).toEqual([{ type: 'text', text: 'ok' }])
      } else {
        expect(back.content).toEqual(c.content)
      }
    }
  })
})
