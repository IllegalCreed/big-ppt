import { describe, expect, it, test, expectTypeOf } from 'vitest'
import type {
  AgentStatus,
  CallToolResponse,
  ChatBubble,
  ChatMessage,
  CreateMcpServerRequest,
  GetToolsResponse,
  LLMTool,
  LogPayload,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpServerWithStatus,
  ToolCall,
  ToolStep,
  UpdateMcpServerRequest,
} from '@big-ppt/shared'

/**
 * 契约编译守门：只要能编译 + 运行，就说明 @big-ppt/shared 的 workspace link 正确，
 * 且 creator 能拿到 shared 导出的类型签名。
 */
describe('@big-ppt/shared contract', () => {
  it('ChatMessage supports all four roles', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', content: 'result', tool_call_id: 'abc' },
    ]
    expect(messages).toHaveLength(4)
  })

  it('ToolCall has function shape', () => {
    const tc: ToolCall = {
      id: 't-1',
      type: 'function',
      function: { name: 'read_slides', arguments: '{}' },
    }
    expect(tc.type).toBe('function')
  })

  it('LLMTool parameters is an object schema', () => {
    const t: LLMTool = {
      type: 'function',
      function: {
        name: 'noop',
        description: 'does nothing',
        parameters: { type: 'object', properties: {} },
      },
    }
    expect(t.function.parameters.type).toBe('object')
  })

  it('AgentStatus union includes all known states', () => {
    const states: AgentStatus[] = [
      'idle',
      'thinking',
      'calling_tool',
      'streaming',
      'error',
      'cancelled',
    ]
    expect(states).toHaveLength(6)
  })

  it('ChatBubble / ToolStep / LogPayload compile and shape matches', () => {
    const step: ToolStep = { key: 'k', name: 'n', label: 'lbl', status: 'loading' }
    const bubble: ChatBubble = { role: 'assistant', content: 'hi', toolSteps: [step] }
    const payload: LogPayload = { kind: 'user_message', session: 's', text: 'x' }
    expect(bubble.toolSteps![0]!.status).toBe('loading')
    expect(payload.kind).toBe('user_message')
  })
})

test('McpServerWithStatus = McpServerConfig & { status }', () => {
  const x: McpServerWithStatus = {
    id: 'demo',
    displayName: 'Demo',
    description: '',
    url: 'https://example.com',
    headers: {},
    enabled: false,
    preset: false,
    status: { state: 'disabled' },
  }
  expectTypeOf(x).toMatchTypeOf<McpServerConfig>()
  expectTypeOf(x.status).toEqualTypeOf<McpServerStatus>()
})

test('CreateMcpServerRequest 的 headers/description/badge 可选', () => {
  const minimal: CreateMcpServerRequest = {
    id: 'x',
    displayName: 'X',
    url: 'https://x',
  }
  expectTypeOf(minimal).toMatchTypeOf<CreateMcpServerRequest>()
})

test('UpdateMcpServerRequest 所有字段可选', () => {
  const empty: UpdateMcpServerRequest = {}
  expectTypeOf(empty).toMatchTypeOf<UpdateMcpServerRequest>()
})

test('CallToolResponse.result 是字符串', () => {
  const r: CallToolResponse = { success: true, result: 'ok' }
  expectTypeOf(r.result).toEqualTypeOf<string | undefined>()
})

test('McpServerState 是 4 个字面量的联合', () => {
  expectTypeOf<McpServerState>().toEqualTypeOf<'disabled' | 'connecting' | 'ok' | 'error'>()
})

test('GetToolsResponse.tools 是 LLMTool[]', () => {
  expectTypeOf<GetToolsResponse['tools']>().toEqualTypeOf<LLMTool[] | undefined>()
})
