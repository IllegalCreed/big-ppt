import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@big-ppt/shared'
import { __trimMessagesForTesting as trimMessages } from '../src/composables/useAIChat'

const sys: ChatMessage = { role: 'system', content: 'sys instructions' }

function tcAssistant(ids: string[]): ChatMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'noop', arguments: '{}' } })),
  }
}

function toolMsg(id: string): ChatMessage {
  return { role: 'tool', content: '{"success":true}', tool_call_id: id }
}

function userMsg(text: string): ChatMessage {
  return { role: 'user', content: text }
}

/**
 * 校验：每条 role:'tool' 的消息必须紧跟在带匹配 tool_call_id 的 assistant 之后。
 * 这是 OpenAI / GLM API 对 messages 数组的硬约束，违反会返回 "messages 参数非法"。
 */
function assertNoOrphanTool(messages: ChatMessage[]): void {
  const pendingIds = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) pendingIds.add(tc.id)
    } else if (m.role === 'tool') {
      const id = m.tool_call_id ?? ''
      if (!pendingIds.has(id)) {
        throw new Error(`orphan tool message tool_call_id=${id}`)
      }
      pendingIds.delete(id)
    } else {
      pendingIds.clear()
    }
  }
}

describe('trimMessages', () => {
  it('对短会话直接原样返回', () => {
    const msgs: ChatMessage[] = [sys, userMsg('hi'), tcAssistant(['a']), toolMsg('a')]
    expect(trimMessages(msgs)).toEqual(msgs)
  })

  it('裁剪长会话时不留下孤儿 tool 消息（复现 GLM "messages 参数非法" bug）', () => {
    // 复现 session 0fc07088... turn 7 失败场景：
    // 原始 [user, assistant(tc=2), tool, tool, ...] —— 当 slice(-20) 把切口
    // 落在 assistant 与其 tool 结果之间，trim 后 tool 失去 parent，GLM 拒收。
    const msgs: ChatMessage[] = [
      sys,
      userMsg('帮我做幻灯片'),
      tcAssistant(['a1', 'a2']),
      toolMsg('a1'),
      toolMsg('a2'),
    ]
    // 再塞 20 条 (assistant tool_calls=1 + tool) 配对，把总长推到触发裁剪的阈值
    for (let i = 0; i < 10; i++) {
      msgs.push(tcAssistant([`c${i}`]))
      msgs.push(toolMsg(`c${i}`))
    }
    // 此时 length = 5 + 20 = 25，slice(-20) 会从原 [5] (tcAssistant c0) 开始
    // 但若 MAX 是 20、长度 25，朴素 slice 会把切口落在中间，触发孤儿
    // —— 关键断言：裁剪后所有 tool 都有匹配 parent
    const trimmed = trimMessages(msgs)
    expect(() => assertNoOrphanTool(trimmed)).not.toThrow()
  })

  it('当 slice 边界正好落在 tool 上时，向前扫描丢掉孤儿 tool', () => {
    // 精确构造：MAX_CONTEXT_MESSAGES=20，构造 23 条原始消息，使 slice(-20) 起点为 tool
    // 原始结构：[sys, user, asst(2tc), tool_a1, tool_a2, ...18 条配对...]
    // length = 5 + 18 = 23，超过 20+1，触发裁剪；slice(-20) 从原 [3]=tool_a1 开始
    const msgs: ChatMessage[] = [sys, userMsg('go'), tcAssistant(['a1', 'a2']), toolMsg('a1'), toolMsg('a2')]
    for (let i = 0; i < 9; i++) {
      msgs.push(tcAssistant([`p${i}`]))
      msgs.push(toolMsg(`p${i}`))
    }
    expect(msgs.length).toBe(23)
    const trimmed = trimMessages(msgs)
    expect(trimmed[0]?.role).toBe('system')
    // 第二条是裁剪占位符 system；第三条往后不能是孤儿 tool
    const afterSummary = trimmed.slice(2)
    expect(afterSummary[0]?.role).not.toBe('tool')
    expect(() => assertNoOrphanTool(trimmed)).not.toThrow()
  })

  it('保留最末 turn 完整：assistant.tool_calls + 其全部 tool 结果不被切散', () => {
    // 末尾构造一组 assistant(tc=3) + 3 个 tool，确保整组保留
    const msgs: ChatMessage[] = [sys]
    for (let i = 0; i < 10; i++) {
      msgs.push(tcAssistant([`x${i}`]))
      msgs.push(toolMsg(`x${i}`))
    }
    msgs.push(tcAssistant(['last1', 'last2', 'last3']))
    msgs.push(toolMsg('last1'))
    msgs.push(toolMsg('last2'))
    msgs.push(toolMsg('last3'))
    const trimmed = trimMessages(msgs)
    expect(() => assertNoOrphanTool(trimmed)).not.toThrow()
    // 末尾四条仍是那组完整配对
    expect(trimmed.slice(-4)).toEqual(msgs.slice(-4))
  })
})
